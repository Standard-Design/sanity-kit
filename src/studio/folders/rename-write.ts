/**
 * Apply one reviewed folder rename with URL-only patches and an atomic receipt.
 * This private service has no UI and does not replace native field autosave.
 * Fresh queries and existing-record revision guards cannot prevent a newly
 * inserted page or release racing the write. See docs/folders.md for the exact
 * guarantees, permission adapter requirements, and live-acceptance gate.
 */
import type { PagesRouteConfig } from '../../url/registry.js'
import { REDIRECT_MAX_RECORDS } from '../../redirect/snapshot.js'
import { checkUrlReadAccess, type UrlAccessIssue } from '../url/access.js'
import { createFolderLoader, type FolderReadClient } from './load.js'
import {
	createFolderRenamePlanner,
	type FolderRenamePlan,
	type FolderRenameResult,
} from './rename.js'
import {
	readPendingFolderRename,
	rememberPendingFolderRename,
	settlePendingFolderRename,
	type FolderRenameReceipt,
	type FolderRenameRecoveryStorage,
	type FolderRenameSettlement,
	type PendingFolderRename,
} from './rename-pending.js'

export const FOLDER_RENAME_MAX_REQUEST_BYTES = 1_048_576
export type FolderRenameMutation =
	| {
			readonly patch: {
				readonly id: string
				readonly ifRevisionID: string
				readonly set: Readonly<Record<string, string>>
			}
	  }
	| { readonly create: Readonly<Record<string, unknown>> }
interface RenameRequestOptions {
	readonly url: string
	readonly method?: 'POST'
	readonly query?: {
		readonly visibility: 'sync'
		readonly returnDocuments: 'false'
		readonly returnIds: 'true'
		readonly autoGenerateArrayKeys: 'false'
	}
	readonly body?: {
		readonly mutations: readonly FolderRenameMutation[]
		readonly transactionId: string
	}
	readonly maxRetries: 0
	readonly fetch: { readonly cache: 'no-store'; readonly next: undefined }
	readonly tag: string
	readonly signal?: AbortSignal
}
export interface FolderRenameClient {
	withConfig(config: Parameters<FolderReadClient['withConfig']>[0]): ReturnType<
		FolderReadClient['withConfig']
	> & {
		config(): { projectId?: string; dataset?: string }
		request(options: RenameRequestOptions): Promise<unknown>
		getDocument(id: string): Promise<unknown>
	}
}
/**
 * The Studio adapter must evaluate actual mutation permissions and conditional
 * document/field readOnly rules. Native Publish eligibility alone is insufficient.
 * Target fields are proposed changes, not a complete document for evaluating rules.
 */
export interface FolderRenameWriteTarget {
	readonly id: string
	readonly schemaType: string
	readonly operation: 'update' | 'create'
	readonly fields: readonly string[]
	readonly revision?: string
	readonly attributes?: Readonly<Record<string, unknown>>
}
export type FolderRenameAuthorization =
	| { readonly ok: true }
	| {
			readonly ok: false
			readonly reason: 'protected' | 'missing' | 'unverified'
			readonly documentId?: string
	  }
export interface FolderRenameReview {
	readonly operationId: string
	readonly createRedirects: boolean
	readonly plan: FolderRenamePlan
}
interface RenameChoice {
	readonly pathname: string
	readonly newName: string
	readonly createRedirects: boolean
}
interface Blocked {
	readonly status: 'blocked'
	readonly reason: string
	readonly planFailure?: Extract<FolderRenameResult, { ok: false }>
	readonly accessIssues?: readonly UrlAccessIssue[]
	readonly documentId?: string
}
export type FolderRenameWriteResult =
	| FolderRenameSettlement
	| Blocked
	| { readonly status: 'unknown'; readonly operationId: string }
export type FolderRenameReviewResult =
	{ readonly status: 'ready'; readonly review: FolderRenameReview } | Blocked
interface Evidence {
	readonly plan: FolderRenamePlan
	readonly fingerprint: string
}
interface Prepared {
	readonly choice: RenameChoice
	readonly snapshot: Evidence
	readonly receipt: FolderRenameReceipt
	readonly mutations: readonly FolderRenameMutation[]
	readonly targets: readonly FolderRenameWriteTarget[]
}
const record = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value)
const blocked = (reason: string): Blocked => ({ status: 'blocked', reason })
const rawOptions = {
	perspective: 'raw',
	useCdn: false,
	stega: false,
	filterResponse: true,
	cache: 'no-store',
	tag: 'sanity-kit.folder-rename',
} as const
function freeze<T>(value: T): T {
	if (value && typeof value === 'object') {
		for (const item of Object.values(value)) freeze(item)
		Object.freeze(value)
	}
	return value
}

export function createFolderRenameController(
	options: {
		readonly routes: PagesRouteConfig
		readonly authorize: (request: {
			readonly targets: readonly FolderRenameWriteTarget[]
			readonly signal?: AbortSignal
		}) => Promise<FolderRenameAuthorization>
		/** Defaults to sessionStorage; a supplied adapter must persist across reloads. */
		readonly recoveryStorage?: FolderRenameRecoveryStorage
	},
	client: FolderRenameClient,
) {
	if (typeof options.authorize !== 'function')
		throw new Error(
			'Folder rename requires an explicit write authorization adapter.',
		)
	const routes = structuredClone(options.routes)
	const planner = createFolderRenamePlanner({ routes })
	const load = createFolderLoader({ routes }, client)
	const source = client.withConfig({
		apiVersion: '2026-10-01',
		perspective: 'raw',
		useCdn: false,
		stega: false,
	})
	const { projectId, dataset } = source.config()
	if (
		!projectId ||
		!/^[a-z0-9]+$/u.test(projectId) ||
		!dataset ||
		!/^[a-z0-9_][a-z0-9_-]*$/u.test(dataset)
	)
		throw new Error('Folder rename needs a concrete project and dataset.')
	const scope = { projectId, dataset }
	const proofs = new WeakMap<FolderRenameReview, Prepared>()
	let busy = false
	let captured: PendingFolderRename | undefined
	const storage = options.recoveryStorage
	const redirectQuery = `*[_type == "sanityKitRedirect"] | order(_id asc)[0...${REDIRECT_MAX_RECORDS + 1}] {_id, _type, _rev, _createdAt, _updatedAt, source, destination, status, enabled, origin}`

	function getPending(): FolderRenameReceipt | null {
		const value = readPendingFolderRename(scope, storage)
		if (value) captured = value
		return value?.receipt ?? null
	}
	function pendingBlock(): Blocked | undefined {
		try {
			return getPending() ? blocked('outcome-unknown') : undefined
		} catch {
			return blocked('recovery-invalid')
		}
	}
	async function evidence(
		choice: RenameChoice,
		signal?: AbortSignal,
	): Promise<Evidence | Blocked> {
		if (signal?.aborted) return blocked('aborted')
		try {
			const acl = await source.request({
				url: `/projects/${projectId}/datasets/${dataset}/acl`,
				maxRetries: 0,
				fetch: { cache: 'no-store', next: undefined },
				tag: rawOptions.tag,
				...(signal ? { signal } : {}),
			})
			const access = checkUrlReadAccess(routes, acl, 'folder-rename')
			if (!access.ok)
				return {
					...blocked('unknown-read-access'),
					accessIssues: access.issues,
				}
			const [loaded, redirects] = await Promise.all([
				load({ readAccess: 'all-registered-versions' }, signal),
				source.fetch(
					redirectQuery,
					{},
					{ ...rawOptions, ...(signal ? { signal } : {}) },
				),
			])
			if (signal?.aborted) return blocked('aborted')
			if (loaded.status !== 'loaded')
				return blocked(`inventory-${loaded.reason}`)
			if (!Array.isArray(redirects))
				return blocked('redirect-inventory-invalid')
			// Provisional eligibility lets the pure planner produce exact write targets.
			// Nothing may be sent until the required authorization adapter approves them.
			const ids = [
				...loaded.snapshot.inventory.documents,
				...(redirects as unknown[]),
			].flatMap((row) =>
				record(row) && typeof row._id === 'string' ? [row._id] : [],
			)
			const result = planner.plan({
				...choice,
				registry: loaded.snapshot.registry,
				inventory: {
					...loaded.snapshot.inventory,
					readAccess: 'all-required-versions',
					redirects,
				},
				writableDocumentIds: ['sanityKit.folders', ...ids],
				protectedDocumentIds: [],
			})
			if (!result.ok) return { ...blocked(result.reason), planFailure: result }
			return {
				plan: result.value,
				fingerprint: JSON.stringify([loaded.snapshot, redirects]),
			}
		} catch {
			return blocked(signal?.aborted ? 'aborted' : 'request-failed')
		}
	}
	function prepare(
		choice: RenameChoice,
		snapshot: Evidence,
		operationId: string,
	): Prepared {
		const { plan } = snapshot
		const folderGuard = plan.guards.find(
			(guard) => guard.id === 'sanityKit.folders',
		)!
		const mutations: FolderRenameMutation[] = [
			{
				patch: {
					id: folderGuard.id,
					ifRevisionID: folderGuard.revision,
					set: Object.fromEntries(
						plan.folderChanges.map((change) => [
							`folders[_key==${JSON.stringify(change.key)}].pathname`,
							change.newPathname,
						]),
					),
				},
			},
		]
		const targets: FolderRenameWriteTarget[] = [
			{
				id: folderGuard.id,
				schemaType: 'sanityKitFolderRegistry',
				operation: 'update',
				revision: folderGuard.revision,
				fields: plan.folderChanges.map(
					(change) => `folders[_key==${JSON.stringify(change.key)}].pathname`,
				),
			},
		]
		for (const change of plan.pageChanges) {
			mutations.push({
				patch: {
					id: change.id,
					ifRevisionID: change.revision,
					set: { [change.pathField]: change.newPathname },
				},
			})
			targets.push({
				id: change.id,
				schemaType: change.schemaType,
				operation: 'update',
				revision: change.revision,
				fields: [change.pathField],
			})
		}
		for (const update of plan.redirects.updates) {
			mutations.push({
				patch: {
					id: update.id,
					ifRevisionID: update.revision,
					set: { destination: update.newDestination },
				},
			})
			targets.push({
				id: update.id,
				schemaType: 'sanityKitRedirect',
				operation: 'update',
				revision: update.revision,
				fields: ['destination'],
			})
		}
		const creates = plan.redirects.creates.map((value) => ({
			...value,
			_id: crypto.randomUUID(),
		}))
		for (const value of creates) {
			mutations.push({ create: value })
			targets.push({
				id: value._id,
				schemaType: value._type,
				operation: 'create',
				fields: Object.keys(value),
				attributes: value,
			})
		}
		const receipt: FolderRenameReceipt = {
			_id: `sanityKit.folderRename.${operationId}`,
			_type: 'sanityKitFolderRename',
			operationId,
			oldPathname: plan.oldPathname,
			newPathname: plan.newPathname,
			createRedirects: choice.createRedirects,
			evidence: JSON.stringify({
				plan,
				redirectIds: creates.map((value) => value._id),
			}),
		}
		mutations.push({ create: { ...receipt } })
		targets.push({
			id: receipt._id,
			schemaType: receipt._type,
			operation: 'create',
			fields: Object.keys(receipt),
			attributes: { ...receipt },
		})
		return freeze({ choice, snapshot, receipt, mutations, targets })
	}
	async function authorize(
		prepared: Prepared,
		signal?: AbortSignal,
	): Promise<Blocked | undefined> {
		try {
			const result = await options.authorize({
				targets: prepared.targets,
				...(signal ? { signal } : {}),
			})
			if (signal?.aborted) return blocked('aborted')
			if (!result || result.ok !== true)
				return {
					...blocked(
						result?.ok === false
							? `write-access-${result.reason}`
							: 'write-access-unverified',
					),
					...(result?.ok === false && result.documentId
						? { documentId: result.documentId }
						: {}),
				}
		} catch {
			return blocked(signal?.aborted ? 'aborted' : 'write-access-unverified')
		}
	}
	async function review(
		choice: RenameChoice,
		signal?: AbortSignal,
	): Promise<FolderRenameReviewResult> {
		if (busy) return blocked('busy')
		const pending = pendingBlock()
		if (pending) return pending
		choice = { ...choice }
		const current = await evidence(choice, signal)
		if ('status' in current) return current
		const prepared = prepare({ ...choice }, current, crypto.randomUUID())
		if (
			new TextEncoder().encode(
				JSON.stringify({
					mutations: prepared.mutations,
					transactionId: prepared.receipt.operationId,
				}),
			).byteLength > FOLDER_RENAME_MAX_REQUEST_BYTES
		)
			return blocked('request-size-limit')
		const denied = await authorize(prepared, signal)
		if (denied) return denied
		const review = freeze({
			operationId: prepared.receipt.operationId,
			createRedirects: choice.createRedirects,
			plan: current.plan,
		})
		proofs.set(review, prepared)
		return { status: 'ready', review }
	}
	async function reconcile(): Promise<FolderRenameWriteResult> {
		let pending: PendingFolderRename | undefined
		try {
			pending = captured ?? readPendingFolderRename(scope, storage)
		} catch {
			return blocked('recovery-invalid')
		}
		if (!pending) return blocked('no-pending-rename')
		captured = pending
		if (pending.result) return pending.result
		try {
			// The Doc API reads the durable record directly; a GROQ miss is unsuitable.
			// Use request directly because getDocument cannot override inherited caching.
			const response = await source.request({
				url: `/data/doc/${dataset}/${pending.receipt._id}`,
				maxRetries: 0,
				fetch: { cache: 'no-store', next: undefined },
				tag: rawOptions.tag,
			})
			const receipt =
				record(response) &&
				Array.isArray(response.documents) &&
				response.documents.length === 1
					? (response.documents[0] as unknown)
					: undefined
			if (
				record(receipt) &&
				Object.entries(pending.receipt).every(
					([key, value]) => receipt[key] === value,
				)
			) {
				const result = {
					status: 'renamed',
					operationId: pending.receipt.operationId,
				} as const
				settlePendingFolderRename(scope, pending, result, storage)
				return result
			}
		} catch {
			/* Missing or unreadable evidence remains uncertain. */
		}
		return (
			pending.result ?? {
				status: 'unknown',
				operationId: pending.receipt.operationId,
			}
		)
	}
	async function apply(
		reviewed: FolderRenameReview,
		choice: {
			readonly isCurrent: () => boolean
			readonly signal?: AbortSignal
		},
	): Promise<FolderRenameWriteResult> {
		if (busy) return blocked('busy')
		const pending = pendingBlock()
		if (pending) return pending
		const prepared = proofs.get(reviewed)
		if (!prepared) return blocked('invalid-review')
		busy = true
		try {
			const fresh = await evidence(prepared.choice, choice.signal)
			if ('status' in fresh) return fresh
			if (
				fresh.fingerprint !== prepared.snapshot.fingerprint ||
				JSON.stringify(fresh.plan) !== JSON.stringify(prepared.snapshot.plan)
			)
				return blocked('review-stale')
			const denied = await authorize(prepared, choice.signal)
			if (denied) return denied
			try {
				if (!choice.isCurrent()) return blocked('review-stale')
			} catch {
				return blocked('review-stale')
			}
			if (choice.signal?.aborted) return blocked('aborted')
			const waiting = pendingBlock()
			if (waiting) return waiting
			const operation = { receipt: prepared.receipt }
			try {
				rememberPendingFolderRename(scope, operation, storage)
			} catch {
				return blocked('recovery-unavailable')
			}
			captured = operation
			proofs.delete(reviewed)
			let response: unknown
			try {
				response = await source.request({
					url: `/data/mutate/${dataset}`,
					method: 'POST',
					query: {
						visibility: 'sync',
						returnDocuments: 'false',
						returnIds: 'true',
						autoGenerateArrayKeys: 'false',
					},
					body: {
						mutations: prepared.mutations,
						transactionId: reviewed.operationId,
					},
					maxRetries: 0,
					fetch: { cache: 'no-store', next: undefined },
					tag: rawOptions.tag,
					...(choice.signal ? { signal: choice.signal } : {}),
				})
			} catch (error) {
				const status = record(error) ? error.statusCode : undefined
				if (
					typeof status === 'number' &&
					[400, 401, 403, 404, 409, 413, 422, 429].includes(status)
				) {
					const result: FolderRenameSettlement = {
						status: 'rejected',
						operationId: reviewed.operationId,
						reason:
							status === 409
								? 'conflict'
								: status === 401 || status === 403
									? 'permission-denied'
									: 'request-rejected',
					}
					settlePendingFolderRename(scope, operation, result, storage)
					return result
				}
				return reconcile()
			}
			const expected = prepared.mutations.map((mutation) =>
				'patch' in mutation
					? { id: mutation.patch.id, operation: 'update' }
					: { id: mutation.create._id, operation: 'create' },
			)
			if (
				record(response) &&
				response.transactionId === reviewed.operationId &&
				Array.isArray(response.results) &&
				response.results.length === expected.length &&
				response.results.every(
					(row: unknown, index) =>
						record(row) &&
						(row.id ?? row.documentId) === expected[index]!.id &&
						row.operation === expected[index]!.operation,
				)
			) {
				const result = {
					status: 'renamed',
					operationId: reviewed.operationId,
				} as const
				settlePendingFolderRename(scope, operation, result, storage)
				return result
			}
			return reconcile()
		} finally {
			busy = false
		}
	}
	return Object.freeze({ review, apply, reconcile, getPending })
}
