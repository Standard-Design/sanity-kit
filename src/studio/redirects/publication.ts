/**
 * Guarded publishing for redirect drafts. Native fields save drafts normally;
 * this controller checks the complete routing inventory before making one draft
 * live. Retirement is the same operation with enabled=false, never deletion.
 *
 * A strict create protects first publishing from a newly created live version.
 * Revision checks protect existing versions. These checks do not lock the whole
 * URL namespace: external writers and concurrent new URLs still need coordination.
 */
import type { Mutation } from '@sanity/client'
import { getPublishedId } from 'sanity'
import {
	createPagesRegistry,
	type PagesRouteConfig,
} from '../../url/registry.js'
import { createSanityUrlResolver } from '../../url/resolve.js'
import { REDIRECT_MAX_RECORDS } from '../../redirect/snapshot.js'
import { createFolderLoader, type FolderReadClient } from '../folders/load.js'
import type { PagesClient } from '../pages/data-source.js'
import { checkUrlReadAccess, type UrlAccessIssue } from '../url/access.js'
import { safeRedirectRecordId } from '../url/publication-diagnostics.js'
import { reviewRedirectDraft, type RedirectDraftReview } from './review.js'
import {
	readPendingRedirect,
	rememberPendingRedirect,
	settlePendingRedirect,
	type PendingRedirect,
} from './publication-pending.js'

export const REDIRECT_PUBLISH_MAX_BYTES = 1_048_576
export interface RedirectValues {
	readonly source: string
	readonly destination: string
	readonly status: 301 | 302
	readonly enabled: boolean
}
export interface RedirectPublishRequest {
	readonly documentId: string
	readonly draftRevision: string
	readonly publishedRevision: string | null
}
export interface RedirectPublishReview extends RedirectPublishRequest {
	readonly before: Readonly<Record<keyof RedirectValues, unknown>> | null
	readonly after: RedirectValues
}
export type RedirectPublishBlocked = {
	readonly status: 'blocked'
	readonly reason: string
	readonly issues?: readonly UrlAccessIssue[]
	readonly diagnostic?: Extract<RedirectDraftReview, { ok: false }>
	readonly limit?: {
		readonly actual: number
		readonly maximum: number
		readonly unit: 'records' | 'bytes'
	}
}
export type RedirectPublishResult =
	| { readonly status: 'published' }
	| RedirectPublishBlocked
	| { readonly status: 'unknown' }
export type RedirectPublishReviewResult =
	| { readonly status: 'ready'; readonly review: RedirectPublishReview }
	| RedirectPublishBlocked
const record = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === 'object' && !Array.isArray(value)
const blocked = (reason: string): RedirectPublishBlocked => ({
	status: 'blocked',
	reason,
})
const revision = (value: unknown): value is string =>
	typeof value === 'string' && value.length > 0 && value.length <= 128
const values = (row: Record<string, unknown>): RedirectValues => ({
	source: row.source as string,
	destination: row.destination as string,
	status: row.status as 301 | 302,
	enabled: row.enabled as boolean,
})
const query = `*[_type == "sanityKitRedirect"] | order(_id asc)[0...${REDIRECT_MAX_RECORDS + 1}]{_id,_type,_rev,_createdAt,_updatedAt,source,destination,status,enabled,origin}`
const fetchOptions = {
	perspective: 'raw',
	useCdn: false,
	stega: false,
	filterResponse: true,
	cache: 'no-store',
	tag: 'sanity-kit.redirect-publication',
} as const
interface Evidence {
	readonly review: RedirectPublishReview
	readonly fingerprint: string
	readonly draft: Record<string, unknown>
}

/** Match Studio publication of custom reference fields without importing its private internals. */
function publishedCopy(
	draft: Record<string, unknown>,
): Record<string, unknown> {
	const copy = structuredClone(draft)
	const pending: unknown[] = [copy]
	while (pending.length) {
		const value = pending.pop()
		if (Array.isArray(value)) {
			pending.push(...(value as unknown[]))
			continue
		}
		if (!record(value)) continue
		if (typeof value._ref === 'string') {
			if (value._strengthenOnPublish) {
				const keepWeak =
					record(value._strengthenOnPublish) && value._strengthenOnPublish.weak
				delete value._strengthenOnPublish
				if (!keepWeak) delete value._weak
			}
		} else pending.push(...Object.values(value))
	}
	return copy
}

export function createRedirectPublicationController(
	routes: PagesRouteConfig,
	client: PagesClient,
	options: { readonly reservedPaths?: readonly string[] } = {},
) {
	const registry = createPagesRegistry(routes)
	const resolve = createSanityUrlResolver(routes)
	const source = client.withConfig({
		apiVersion: '2026-10-01',
		perspective: 'raw',
		useCdn: false,
		stega: false,
		maxRetries: 0,
	})
	const config = source.config()
	if (!config.projectId || !config.dataset)
		throw new Error('Redirect publication requires a project and dataset.')
	const projectId = config.projectId,
		dataset = config.dataset
	const scope = (documentId: string) => ({ projectId, dataset, documentId })
	const readDocument = async (
		id: string,
	): Promise<Record<string, unknown> | undefined> => {
		const request = {
			uri: `/data/doc/${dataset}/${encodeURIComponent(id)}`,
			tag: fetchOptions.tag,
			fetch: { cache: 'no-store', next: undefined },
		} as const
		const response: unknown = await source.request(request)
		if (!record(response) || !Array.isArray(response.documents))
			throw new Error('Invalid document response')
		if (response.documents.length === 0) return undefined
		if (
			response.documents.length !== 1 ||
			!record(response.documents[0]) ||
			response.documents[0]._id !== id
		)
			throw new Error('Unexpected document response')
		return response.documents[0]
	}
	const loader = createFolderLoader({ routes }, source)
	const proofs = new WeakMap<RedirectPublishReview, Evidence>()
	const captured = new Map<string, PendingRedirect>()
	let busy = false
	function getPending(documentId: string) {
		const pending = readPendingRedirect(scope(documentId))
		if (pending) captured.set(documentId, pending)
		return pending?.review ?? null
	}
	async function evidence(
		request: RedirectPublishRequest,
		signal?: AbortSignal,
	): Promise<Evidence | RedirectPublishBlocked> {
		if (
			!safeRedirectRecordId({
				_id: request.documentId,
				_type: 'sanityKitRedirect',
			}) ||
			getPublishedId(request.documentId) !== request.documentId ||
			!revision(request.draftRevision) ||
			(request.publishedRevision !== null &&
				!revision(request.publishedRevision))
		)
			return blocked('invalid-document')
		try {
			const accessOptions = {
				url: `/projects/${projectId}/datasets/${dataset}/acl`,
				fetch: { cache: 'no-store', next: undefined },
				tag: fetchOptions.tag,
				...(signal ? { signal } : {}),
			} as const
			const grants: unknown = await source.request(accessOptions)
			const access = checkUrlReadAccess(routes, grants, 'redirect-publish')
			if (!access.ok)
				return { ...blocked('unknown-read-access'), issues: access.issues }
			const loaded = await loader(
				{ readAccess: 'all-registered-versions' },
				signal,
			)
			if (loaded.status !== 'loaded')
				return blocked(`inventory-${loaded.reason}`)
			const reader: FolderReadClient = source
			const raw: unknown = await reader
				.withConfig({
					apiVersion: '2026-10-01',
					perspective: 'raw',
					useCdn: false,
					stega: false,
				})
				.fetch(query, {}, { ...fetchOptions, ...(signal ? { signal } : {}) })
			if (!Array.isArray(raw)) return blocked('invalid-inventory')
			if (raw.length > REDIRECT_MAX_RECORDS)
				return {
					...blocked('inventory-limit'),
					limit: {
						actual: raw.length,
						maximum: REDIRECT_MAX_RECORDS,
						unit: 'records',
					},
				}
			if (new TextEncoder().encode(JSON.stringify(raw)).length > 1_048_576)
				return {
					...blocked('inventory-size-limit'),
					limit: {
						actual: new TextEncoder().encode(JSON.stringify(raw)).length,
						maximum: 1_048_576,
						unit: 'bytes',
					},
				}
			const rows: Record<string, unknown>[] = []
			const ids = new Set<string>()
			for (const row of raw as unknown[]) {
				const id = safeRedirectRecordId(row)
				if (!record(row) || !id || !revision(row._rev) || ids.has(id))
					return blocked('invalid-inventory')
				ids.add(id)
				rows.push(row)
			}
			if (
				rows.some(
					(row) =>
						(row._id as string).startsWith('versions.') &&
						getPublishedId(row._id as string) === request.documentId,
				)
			)
				return blocked('release-version')
			const draft = rows.find(
				(row) => row._id === `drafts.${request.documentId}`,
			)
			const live = rows.find((row) => row._id === request.documentId)
			if (
				!draft ||
				draft._rev !== request.draftRevision ||
				(live?._rev ?? null) !== request.publishedRevision
			)
				return blocked('review-stale')
			const occupied: string[] = []
			for (const document of loaded.snapshot.inventory.documents) {
				const url = resolve(document)
				// Draft and release URLs reserve their destinations too: publishing a new
				// redirect should not silently take an editor's planned page address.
				if (url.ok) occupied.push(url.value.pathname)
				else if (url.reason !== 'missing-value')
					return blocked('page-url-unresolved')
			}
			const checked = reviewRedirectDraft(
				draft,
				{
					perspective: 'published',
					complete: true,
					records: rows.filter(
						(row) => getPublishedId(row._id as string) === row._id,
					),
				},
				{
					reservedPaths: [
						...registry.excludePaths,
						...(options.reservedPaths ?? []),
					],
					reservedPathPrefixes: registry.reservedPathPrefixes,
					occupiedPaths: occupied,
					destinations: 'unverified',
				},
			)
			if (!checked.ok)
				return { ...blocked('invalid-redirect'), diagnostic: checked }
			// The small inventory projection is evidence, not a replacement document.
			// Fetch the full draft and match its revision so custom fields survive publish.
			const complete = await readDocument(`drafts.${request.documentId}`)
			if (
				!complete ||
				complete._rev !== draft._rev ||
				complete._type !== 'sanityKitRedirect'
			)
				return blocked('review-stale')
			if (signal?.aborted) return blocked('aborted')
			const review = Object.freeze({
				...request,
				before: live
					? Object.freeze({
							source: live.source,
							destination: live.destination,
							status: live.status,
							enabled: live.enabled,
						})
					: null,
				after: Object.freeze(values(draft)),
			})
			return {
				review,
				draft: complete,
				fingerprint: JSON.stringify([
					loaded.snapshot.inventory.documents,
					raw,
					complete,
				]),
			}
		} catch {
			return blocked(signal?.aborted ? 'aborted' : 'request-failed')
		}
	}
	async function review(
		request: RedirectPublishRequest,
		signal?: AbortSignal,
	): Promise<RedirectPublishReviewResult> {
		if (busy) return blocked('busy')
		if (getPending(request.documentId)) return blocked('outcome-unknown')
		const found = await evidence(request, signal)
		if ('status' in found) return found
		proofs.set(found.review, found)
		return { status: 'ready', review: found.review }
	}
	async function reconcile(documentId: string): Promise<RedirectPublishResult> {
		try {
			const pending =
				captured.get(documentId) ?? readPendingRedirect(scope(documentId))
			if (!pending) return blocked('no-pending-publication')
			captured.set(documentId, pending)
			if (pending.result) return pending.result
			const receipt = await readDocument(pending.receipt._id)
			if (
				receipt &&
				Object.entries(pending.receipt).every(
					([key, value]) => receipt[key] === value,
				)
			) {
				const result = { status: 'published' } as const
				settlePendingRedirect(scope(documentId), pending, result)
				captured.delete(documentId)
				return result
			}
			if (pending.result) return pending.result
		} catch {
			/* A missing or unreadable receipt cannot prove failure. */
		}
		return { status: 'unknown' }
	}
	async function publish(
		reviewed: RedirectPublishReview,
		choice: { readonly isCurrent: () => boolean },
	): Promise<RedirectPublishResult> {
		if (busy) return blocked('busy')
		if (getPending(reviewed.documentId)) return blocked('outcome-unknown')
		const original = proofs.get(reviewed)
		if (!original) return blocked('invalid-review')
		busy = true
		try {
			const fresh = await evidence(reviewed)
			if ('status' in fresh) return fresh
			if (original.fingerprint !== fresh.fingerprint || !choice.isCurrent())
				return blocked('review-stale')
			const operationId = crypto.randomUUID()
			const receipt = {
				_id: `sanityKit.redirectPublication.${operationId}`,
				_type: 'sanityKitRedirectPublication',
				operationId,
				documentId: reviewed.documentId,
				draftRevision: reviewed.draftRevision,
				publishedRevision: reviewed.publishedRevision,
				change: JSON.stringify(reviewed.after),
			}
			const target: Record<string, unknown> = {
				...publishedCopy(fresh.draft),
				_id: reviewed.documentId,
			}
			delete target._rev
			delete target._updatedAt
			const mutations: Mutation[] = [
				{
					patch: {
						id: `drafts.${reviewed.documentId}`,
						ifRevisionID: reviewed.draftRevision,
						set: { _type: 'sanityKitRedirect' },
					},
				},
			]
			if (reviewed.publishedRevision)
				mutations.push(
					{
						patch: {
							id: reviewed.documentId,
							ifRevisionID: reviewed.publishedRevision,
							set: { _type: 'sanityKitRedirect' },
						},
					},
					{ createOrReplace: target as { _id: string; _type: string } },
				)
			else mutations.push({ create: target as { _id: string; _type: string } })
			mutations.push(
				{ delete: { id: `drafts.${reviewed.documentId}` } },
				{ create: receipt },
			)
			const bytes = new TextEncoder().encode(
				JSON.stringify({ mutations, transactionId: operationId }),
			).length
			if (bytes > REDIRECT_PUBLISH_MAX_BYTES)
				return {
					...blocked('request-limit'),
					limit: {
						actual: bytes,
						maximum: REDIRECT_PUBLISH_MAX_BYTES,
						unit: 'bytes',
					},
				}
			if (!choice.isCurrent()) return blocked('review-stale')
			if (getPending(reviewed.documentId)) return blocked('outcome-unknown')
			const pending: PendingRedirect = { receipt, review: reviewed }
			if (!rememberPendingRedirect(scope(reviewed.documentId), pending))
				return blocked('recovery-unavailable')
			captured.set(reviewed.documentId, pending)
			try {
				await source.mutate(mutations, {
					transactionId: operationId,
					visibility: 'sync',
					tag: fetchOptions.tag,
				})
				const result = { status: 'published' } as const
				settlePendingRedirect(scope(reviewed.documentId), pending, result)
				captured.delete(reviewed.documentId)
				proofs.delete(reviewed)
				return result
			} catch (error) {
				const status = record(error) ? error.statusCode : undefined
				if ([400, 401, 403, 404, 409].includes(status as number)) {
					const result = blocked(
						status === 409 ? 'review-stale' : 'publish-rejected',
					)
					settlePendingRedirect(scope(reviewed.documentId), pending, result)
					captured.delete(reviewed.documentId)
					proofs.delete(reviewed)
					return result
				}
				return reconcile(reviewed.documentId)
			}
		} finally {
			busy = false
		}
	}
	return { review, publish, reconcile, getPending }
}
