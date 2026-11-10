/**
 * Publish one reviewed collection settings draft and its redirect changes in a
 * single Actions API transaction. Item documents never enter the write batch.
 * This private core is not installed as a Studio action: a native schema/write
 * adapter and editor review must be supplied before enabling that workflow.
 * @see docs/collection-prefix-publication.md
 */
import type { Action } from '@sanity/client'
import type { CollectionRoutingConfig } from '../../url/settings/resolve.js'
import {
	createCollectionPrefixReviewer,
	type CollectionPrefixReview,
	type CollectionPrefixReviewClient,
	type CollectionPrefixReviewResult,
	type CollectionPrefixReadAccessRequest,
} from './prefix-review.js'
import type { CollectionPrefixAccessDecision } from './prefix-access.js'
import type { CollectionPrefixChoice } from './prefix-plan.js'
import {
	readPendingCollectionPrefix,
	rememberPendingCollectionPrefix,
	settlePendingCollectionPrefix,
	type CollectionPrefixReceipt,
	type CollectionPrefixRecoveryStorage,
	type CollectionPrefixSettlement,
	type PendingCollectionPrefix,
} from './prefix-pending.js'

export const COLLECTION_PREFIX_MAX_REQUEST_BYTES = 1_048_576
export const COLLECTION_PREFIX_MAX_SETTINGS_BYTES = 1_048_576
export interface CollectionPrefixRequest {
	readonly url: string
	readonly method?: 'POST'
	readonly body?: {
		readonly actions: readonly Action[]
		readonly transactionId: string
	}
	readonly maxRetries: 0
	readonly fetch: { readonly cache: 'no-store'; readonly next: undefined }
	readonly tag: string
	readonly signal?: AbortSignal
}
export interface CollectionPrefixWriteClient {
	withConfig(
		options: Parameters<CollectionPrefixReviewClient['withConfig']>[0],
	): ReturnType<CollectionPrefixReviewClient['withConfig']> & {
		request(options: CollectionPrefixRequest): Promise<unknown>
	}
}
/**
 * Each target describes a whole action sequence, not merely the final patch.
 * The native adapter must authorize creating/removing drafts and publishing as
 * well as the proposed fields. It must validate the complete settings draft and
 * conditional schema readOnly rules. A successful read check grants none of this.
 */
export type CollectionPrefixWriteTarget =
	| {
			readonly key: string
			readonly kind: 'publish-settings'
			readonly published: Readonly<Record<string, unknown>>
			readonly draft: Readonly<Record<string, unknown>>
	  }
	| {
			readonly key: string
			readonly kind: 'retarget-redirect'
			readonly publishedId: string
			readonly publishedRevision: string
			readonly draftId: string
			readonly destination: string
	  }
	| {
			readonly key: string
			readonly kind: 'create-and-publish'
			readonly publishedId: string
			readonly draft: Readonly<Record<string, unknown>>
	  }
export interface CollectionPrefixWriteAccessRequest {
	readonly projectId: string
	readonly dataset: string
	readonly targets: readonly CollectionPrefixWriteTarget[]
	/** Prove exact published and draft receipt visibility even before they exist. */
	readonly receiptReadId: string
	readonly signal?: AbortSignal
}
export interface CollectionPrefixWriteAccessAnswer {
	readonly targets: readonly {
		readonly key: string
		readonly status: 'granted' | 'missing' | 'unverified' | 'protected'
	}[]
	readonly receiptRead: 'granted' | 'missing' | 'unverified'
}
export interface CollectionPrefixPublishReview extends CollectionPrefixReview {
	readonly operationId: string
	readonly createRedirects: boolean
	/** Normal Publish includes these settings edits, including display name changes. */
	readonly settings: {
		readonly published: Readonly<Record<string, unknown>>
		readonly draft: Readonly<Record<string, unknown>>
	}
}
type Blocked = Extract<CollectionPrefixReviewResult, { status: 'blocked' }> & {
	readonly targetKey?: string
}
export type CollectionPrefixPublishResult =
	| Blocked
	| CollectionPrefixSettlement
	| { readonly status: 'unknown'; readonly operationId: string }
export type CollectionPrefixPublishReviewResult =
	| Blocked
	| { readonly status: 'ready'; readonly review: CollectionPrefixPublishReview }
interface Prepared {
	readonly evidence: CollectionPrefixReview
	readonly actions: readonly Action[]
	readonly targets: readonly CollectionPrefixWriteTarget[]
	readonly receipt: CollectionPrefixReceipt
}
const record = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value)
const blocked = (reason: string): Blocked => ({ status: 'blocked', reason })
const bytes = (value: unknown) =>
	new TextEncoder().encode(JSON.stringify(value)).byteLength
function freeze<T>(value: T): T {
	if (value && typeof value === 'object') {
		for (const item of Object.values(value)) freeze(item)
		Object.freeze(value)
	}
	return value
}

export function createCollectionPrefixController(
	options: {
		readonly configuration: CollectionRoutingConfig
		readonly confirmReadAccess: (
			request: CollectionPrefixReadAccessRequest,
			signal?: AbortSignal,
		) => Promise<readonly CollectionPrefixAccessDecision[]>
		readonly authorize: (
			request: CollectionPrefixWriteAccessRequest,
		) => Promise<CollectionPrefixWriteAccessAnswer>
		/** Must persist through a reload; defaults to this tab's sessionStorage. */
		readonly recoveryStorage?: CollectionPrefixRecoveryStorage
	},
	client: CollectionPrefixWriteClient,
) {
	if (typeof options.authorize !== 'function')
		throw new Error(
			'Collection prefix publishing requires a native schema/write authorization adapter.',
		)
	const reviewer = createCollectionPrefixReviewer(
		options.configuration,
		client,
		options,
	)
	const source = client.withConfig({
		apiVersion: '2026-10-01',
		perspective: 'raw',
		useCdn: false,
		stega: false,
		maxRetries: 0,
	})
	const { projectId, dataset } = source.config()
	// The reviewer validates the concrete scope before any request is possible.
	const scope = { projectId: projectId!, dataset: dataset! }
	const transport = {
		maxRetries: 0,
		fetch: { cache: 'no-store', next: undefined },
		tag: 'sanity-kit.collection-prefix-write',
	} as const
	const proofs = new WeakMap<CollectionPrefixPublishReview, Prepared>()
	const storage = options.recoveryStorage
	let busy = false
	let captured: PendingCollectionPrefix | undefined

	function getPending(): CollectionPrefixReceipt | null {
		const value = readPendingCollectionPrefix(scope, storage)
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
	// The planner intentionally reads compact projections. Schema validation and
	// the editor review need the complete settings draft that Publish will apply.
	async function fullSettings(
		evidence: CollectionPrefixReview,
		signal?: AbortSignal,
	) {
		const setting = evidence.plan.settings
		const ids = [setting.documentId, `drafts.${setting.documentId}`]
		const response = await source.request({
			...transport,
			url: `/data/doc/${scope.dataset}/${ids.map(encodeURIComponent).join(',')}`,
			...(signal ? { signal } : {}),
		})
		if (signal?.aborted) return blocked('aborted')
		if (
			!record(response) ||
			!Array.isArray(response.documents) ||
			response.documents.length !== 2
		)
			return blocked('settings-unavailable')
		const documents: unknown[] = response.documents
		const published = documents.find((row) => record(row) && row._id === ids[0])
		const draft = documents.find((row) => record(row) && row._id === ids[1])
		if (
			!record(published) ||
			!record(draft) ||
			published._type !== 'sanityKitCollectionRoute' ||
			draft._type !== published._type ||
			published._rev !== setting.publishedRevision ||
			draft._rev !== setting.draftRevision
		)
			return blocked('review-stale')
		if (bytes([published, draft]) > COLLECTION_PREFIX_MAX_SETTINGS_BYTES)
			return blocked('settings-size-limit')
		return freeze({
			published: structuredClone(published),
			draft: structuredClone(draft),
		})
	}
	function prepare(
		evidence: CollectionPrefixReview,
		settings: CollectionPrefixPublishReview['settings'],
		createRedirects: boolean,
	): Prepared {
		const operationId = crypto.randomUUID()
		const actions: Action[] = []
		const targets: CollectionPrefixWriteTarget[] = []
		for (const update of evidence.plan.redirects.updates) {
			const draftId = `drafts.${update.id}`
			// A fresh draft copied by the server preserves unknown fields and fails
			// if another editor created a draft after review. Never reuse that draft.
			actions.push(
				{
					actionType: 'sanity.action.document.version.create',
					publishedId: update.id,
					baseId: update.id,
					versionId: draftId,
					ifBaseRevisionId: update.revision,
				},
				{
					actionType: 'sanity.action.document.edit',
					publishedId: update.id,
					draftId,
					patch: { set: { destination: update.newDestination } },
				},
				{
					actionType: 'sanity.action.document.publish',
					publishedId: update.id,
					draftId,
					ifPublishedRevisionId: update.revision,
				},
			)
			targets.push({
				key: `retarget:${update.id}`,
				kind: 'retarget-redirect',
				publishedId: update.id,
				publishedRevision: update.revision,
				draftId,
				destination: update.newDestination,
			})
		}
		const redirectIds: string[] = []
		function createAndPublish(
			publishedId: string,
			attributes: Record<string, unknown>,
		) {
			const draft = { ...attributes, _id: `drafts.${publishedId}` }
			actions.push(
				{
					actionType: 'sanity.action.document.create',
					publishedId,
					attributes: draft as { _id: string; _type: string },
					ifExists: 'fail',
				},
				{
					actionType: 'sanity.action.document.publish',
					publishedId,
					draftId: draft._id,
				},
			)
			targets.push({
				key: `create:${publishedId}`,
				kind: 'create-and-publish',
				publishedId,
				draft,
			})
		}
		for (const redirect of evidence.plan.redirects.creates) {
			const id = crypto.randomUUID()
			redirectIds.push(id)
			createAndPublish(id, { ...redirect })
		}
		const setting = evidence.plan.settings
		actions.push({
			actionType: 'sanity.action.document.publish',
			publishedId: setting.documentId,
			draftId: `drafts.${setting.documentId}`,
			ifPublishedRevisionId: setting.publishedRevision,
			ifDraftRevisionId: setting.draftRevision,
		})
		targets.push({
			key: `settings:${setting.documentId}`,
			kind: 'publish-settings',
			...settings,
		})
		const receipt: CollectionPrefixReceipt = {
			_id: `sanityKit.collectionPrefixPublication.${operationId}`,
			_type: 'sanityKitCollectionPrefixPublication',
			operationId,
			oldPrefix: setting.oldPrefix,
			newPrefix: setting.newPrefix,
			createRedirects,
			evidence: JSON.stringify({ plan: evidence.plan, redirectIds }),
		}
		createAndPublish(receipt._id, { ...receipt })
		return freeze({ evidence, actions, targets, receipt })
	}
	async function authorize(
		prepared: Prepared,
		signal?: AbortSignal,
	): Promise<Blocked | undefined> {
		try {
			const answer: unknown = await options.authorize({
				...scope,
				targets: prepared.targets,
				receiptReadId: prepared.receipt._id,
				...(signal ? { signal } : {}),
			})
			if (signal?.aborted) return blocked('aborted')
			if (!record(answer) || answer.receiptRead !== 'granted')
				return blocked('receipt-read-unverified')
			if (
				!Array.isArray(answer.targets) ||
				answer.targets.length !== prepared.targets.length
			)
				return blocked('write-access-unverified')
			const answers: unknown[] = answer.targets
			for (const target of prepared.targets) {
				const matches = answers.filter(
					(row) => record(row) && row.key === target.key,
				)
				if (matches.length !== 1 || !record(matches[0]))
					return blocked('write-access-unverified')
				if (matches[0].status !== 'granted')
					return {
						...blocked(
							['missing', 'protected'].includes(String(matches[0].status))
								? `write-access-${String(matches[0].status)}`
								: 'write-access-unverified',
						),
						targetKey: target.key,
					}
			}
		} catch {
			return blocked(signal?.aborted ? 'aborted' : 'write-access-unverified')
		}
	}
	async function review(
		choice: CollectionPrefixChoice,
		signal?: AbortSignal,
	): Promise<CollectionPrefixPublishReviewResult> {
		if (busy) return blocked('busy')
		const pending = pendingBlock()
		if (pending) return pending
		const capturedChoice = { ...choice }
		try {
			const found = await reviewer.review(capturedChoice, signal)
			if (found.status === 'blocked') return found
			const settings = await fullSettings(found.review, signal)
			if ('status' in settings) return settings
			const prepared = prepare(
				found.review,
				settings,
				capturedChoice.createRedirects,
			)
			if (
				bytes({
					actions: prepared.actions,
					transactionId: prepared.receipt.operationId,
				}) > COLLECTION_PREFIX_MAX_REQUEST_BYTES
			)
				return blocked('request-size-limit')
			const denied = await authorize(prepared, signal)
			if (denied) return denied
			const review = freeze({
				...found.review,
				operationId: prepared.receipt.operationId,
				createRedirects: capturedChoice.createRedirects,
				settings,
			})
			proofs.set(review, prepared)
			return { status: 'ready', review }
		} catch {
			return blocked(signal?.aborted ? 'aborted' : 'request-failed')
		}
	}
	async function reconcile(): Promise<CollectionPrefixPublishResult> {
		let pending: PendingCollectionPrefix | undefined
		try {
			pending = readPendingCollectionPrefix(scope, storage) ?? captured
		} catch {
			return blocked('recovery-invalid')
		}
		if (!pending) return blocked('no-pending-publish')
		captured = pending
		if (pending.result) return pending.result
		try {
			const response = await source.request({
				...transport,
				url: `/data/doc/${scope.dataset}/${pending.receipt._id}`,
			})
			const row: unknown =
				record(response) &&
				Array.isArray(response.documents) &&
				response.documents.length === 1
					? response.documents[0]
					: undefined
			if (
				record(row) &&
				Object.entries(pending.receipt).every(
					([key, value]) => row[key] === value,
				)
			) {
				const result = {
					status: 'published',
					operationId: pending.receipt.operationId,
				} as const
				settlePendingCollectionPrefix(scope, pending, result, storage)
				return result
			}
		} catch {
			/* A missing or unreadable receipt does not prove rejection. */
		}
		return (
			pending.result ?? {
				status: 'unknown',
				operationId: pending.receipt.operationId,
			}
		)
	}
	async function publish(
		reviewed: CollectionPrefixPublishReview,
		choice: {
			readonly isCurrent: () => boolean
			readonly signal?: AbortSignal
		},
	): Promise<CollectionPrefixPublishResult> {
		if (busy) return blocked('busy')
		const waiting = pendingBlock()
		if (waiting) return waiting
		const prepared = proofs.get(reviewed)
		if (!prepared) return blocked('invalid-review')
		busy = true
		try {
			const current = await reviewer.recheck(prepared.evidence, choice.signal)
			if (current.status === 'blocked') return current
			const denied = await authorize(prepared, choice.signal)
			if (denied) return denied
			try {
				if (!choice.isCurrent()) return blocked('review-stale')
			} catch {
				return blocked('review-stale')
			}
			if (choice.signal?.aborted) return blocked('aborted')
			const pending = pendingBlock()
			if (pending) return pending
			// Persist before dispatch: aborting or losing the response after this point
			// cannot tell us whether the server committed the transaction.
			const operation = { receipt: prepared.receipt }
			try {
				rememberPendingCollectionPrefix(scope, operation, storage)
			} catch {
				return blocked('recovery-unavailable')
			}
			captured = operation
			proofs.delete(reviewed)
			try {
				const response = await source.request({
					...transport,
					url: `/data/actions/${scope.dataset}`,
					method: 'POST',
					body: {
						actions: prepared.actions,
						transactionId: prepared.receipt.operationId,
					},
					...(choice.signal ? { signal: choice.signal } : {}),
				})
				if (
					record(response) &&
					response.transactionId === prepared.receipt.operationId
				) {
					const result = {
						status: 'published',
						operationId: prepared.receipt.operationId,
					} as const
					settlePendingCollectionPrefix(scope, operation, result, storage)
					return result
				}
			} catch (error) {
				const status = record(error) ? error.statusCode : undefined
				if (
					typeof status === 'number' &&
					[400, 401, 403, 404, 409, 413, 422, 429].includes(status)
				) {
					const result: CollectionPrefixSettlement = {
						status: 'rejected',
						operationId: prepared.receipt.operationId,
						reason:
							status === 409
								? 'conflict'
								: status === 401 || status === 403
									? 'permission-denied'
									: 'request-rejected',
					}
					settlePendingCollectionPrefix(scope, operation, result, storage)
					return result
				}
			}
			return reconcile()
		} finally {
			busy = false
		}
	}
	return Object.freeze({ review, publish, getPending, reconcile })
}
