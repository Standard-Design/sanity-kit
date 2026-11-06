/**
 * Publish one reviewed draft and its optional redirect in one Actions API call.
 * Field autosave never calls this service. The document action supplies native
 * validation/sync readiness; this boundary checks fresh URLs, access, revisions,
 * redirect rules, and uncertain outcomes. See docs/url-field.md.
 */
import {
	safeRedirectRecordId,
	redirectRowDetails,
	redirectFieldIssues,
	relatedRedirectDetails,
	type RedirectFieldIssue,
} from './publication-diagnostics.js'
import type { UrlPublicationLimit } from './publication-limits.js'
import type { Action } from '@sanity/client'
import { checkUrlReadAccess, type UrlAccessIssue } from './access.js'
import { getPublishedId } from 'sanity'
import {
	readPendingPublication,
	rememberPendingPublication,
	settlePendingPublication,
	type PendingUrlPublication,
} from './publication-pending.js'
import { REDIRECT_MAX_RECORDS } from '../../redirect/snapshot.js'
import { createSanityUrlResolver } from '../../url/resolve.js'
import {
	createPagesRegistry,
	type PagesRouteConfig,
} from '../../url/registry.js'
import { createFolderLoader, type FolderReadClient } from '../folders/load.js'
import { fieldExpression } from '../pages/resolvers.js'
import type { PagesClient } from '../pages/data-source.js'
import {
	planSinglePageRedirect,
	type RedirectPublicationUpdate,
} from './publication-plan.js'

export type UrlPublicationAffectedRedirect = Omit<
	RedirectPublicationUpdate,
	'revision'
>

/** Conservative kit payload budget, below Sanity's 4 MB mutation-body limit. */
export const URL_PUBLICATION_MAX_ACTION_BYTES = 1_048_576

export interface UrlPublicationReview {
	readonly documentId: string
	readonly draftRevision: string
	readonly publishedRevision: string
	readonly oldPathname: string
	readonly newPathname: string
	readonly affectedRedirects: readonly UrlPublicationAffectedRedirect[]
}
/** Editorial context for a blocked review; never used to authorize a write. */
export interface UrlPublicationConflict {
	readonly kind: 'page' | 'redirect' | 'reserved'
	readonly pathname: string
	readonly documentId?: string
	readonly schemaType?: string
	readonly title?: string
	readonly destination?: string
	readonly fieldIssues?: readonly RedirectFieldIssue[]
	readonly relatedPages?: readonly {
		readonly documentId: string
		readonly pathname: string
		readonly schemaType: string
		readonly title?: string
	}[]
	readonly finalDestination?: string
	/** Other active rules involved in the issue; only from the checked inventory. */
	readonly relatedRedirects?: readonly {
		readonly documentId: string
		readonly pathname: string
		readonly destination?: string
	}[]
}
interface UrlPublicationBlocked {
	readonly status: 'blocked'
	readonly reason: string
	readonly conflict?: UrlPublicationConflict
	readonly accessIssues?: readonly UrlAccessIssue[]
	readonly limit?: UrlPublicationLimit
	readonly redirectIssue?: string
}
export type UrlPublicationResult =
	| { readonly status: 'published' }
	| UrlPublicationBlocked
	| { readonly status: 'unknown'; readonly reason: string }
export type UrlPublicationReviewResult =
	| { readonly status: 'ready'; readonly review: UrlPublicationReview }
	| UrlPublicationBlocked
export interface UrlPublicationOptions {
	readonly reservedPaths?: readonly string[]
}
interface ReviewRequest {
	readonly documentId: string
	readonly draftRevision: string
	readonly publishedRevision: string
}
interface Evidence {
	readonly review: UrlPublicationReview
	readonly fingerprint: string
	readonly redirects: readonly unknown[]
	readonly documents: readonly Record<string, unknown>[]
	readonly before: readonly string[]
	readonly after: readonly string[]
}
const record = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value)
const blocked = (
	reason: string,
	conflict?: UrlPublicationConflict,
): UrlPublicationBlocked => ({
	status: 'blocked',
	reason,
	...(conflict ? { conflict } : {}),
})
const rawOptions = {
	perspective: 'raw' as const,
	useCdn: false as const,
	stega: false as const,
	filterResponse: true as const,
	cache: 'no-store' as const,
	tag: 'sanity-kit.url-publication',
}

/**
 * Internal opt-in integration, not a general replacement for Sanity publishing.
 * Ordinary document creation remains native. IDs below identify generated
 * redirect/operation records needed within a single atomic action request.
 */
export function createUrlPublicationController(
	routes: PagesRouteConfig,
	client: PagesClient,
	options: UrlPublicationOptions = {},
) {
	const registry = createPagesRegistry(routes)
	const resolve = createSanityUrlResolver(routes)
	const load = createFolderLoader({ routes }, client)
	const source = client.withConfig({
		apiVersion: '2026-10-01',
		perspective: 'raw',
		useCdn: false,
		stega: false,
		maxRetries: 0,
	})
	const { projectId, dataset } = source.config()
	if (
		!projectId ||
		!/^[a-z0-9]+$/u.test(projectId) ||
		!dataset ||
		!/^[a-z0-9_][a-z0-9_-]*$/u.test(dataset)
	)
		throw new Error('URL publication needs a concrete project and dataset.')
	const reserved = [
		...new Set([...registry.excludePaths, ...(options.reservedPaths ?? [])]),
	]
	const proofs = new WeakMap<UrlPublicationReview, Evidence>()
	let busy = false
	let lastDocumentId: string | undefined
	const captured = new Map<string, PendingUrlPublication>()
	const scope = (documentId: string) => ({ projectId, dataset, documentId })
	/** Resume a receipt check after navigation or reload, without rebuilding a write. */
	function getPending(
		documentId: string,
	): (UrlPublicationReview & { readonly createRedirect: boolean }) | null {
		const pending = readPendingPublication(scope(documentId))
		if (pending) captured.set(documentId, pending)
		return pending
			? {
					...pending.review,
					createRedirect: pending.receipt.createRedirect === true,
				}
			: null
	}
	const redirectQuery = `*[_type == "sanityKitRedirect"] | order(_id asc)[0...${REDIRECT_MAX_RECORDS + 1}] {_id, _type, _rev, _createdAt, _updatedAt, source, destination, status, enabled, origin}`

	async function pageConflict(
		document: Record<string, unknown>,
		pathname: string,
		signal?: AbortSignal,
	): Promise<UrlPublicationConflict> {
		const type = registry.types.find(
			(type) => type.schemaType === document._type,
		)!
		// The inventory deliberately reads URL fields only. Fetch a small display
		// label for this blocker, at its reviewed revision. A missing title or a
		// failed label lookup must never make the occupied URL appear available.
		let title: string | undefined
		try {
			const labelReader: FolderReadClient = source
			const label: unknown = await labelReader
				.withConfig({
					apiVersion: '2026-10-01',
					perspective: 'raw',
					useCdn: false,
					stega: false,
				})
				.fetch(
					`*[_id == $id && _rev == $revision][0]{"title": ${fieldExpression(type.titleField)}}`,
					{ id: document._id, revision: document._rev },
					{ ...rawOptions, ...(signal ? { signal } : {}) },
				)
			if (
				record(label) &&
				typeof label.title === 'string' &&
				label.title.trim()
			)
				title = label.title.trim().slice(0, 200)
		} catch {
			/* Keep the document identity if its label cannot be loaded. */
		}
		return {
			kind: 'page',
			pathname,
			documentId: document._id as string,
			schemaType: type.schemaType,
			...(title ? { title } : {}),
		}
	}

	async function evidence(
		request: ReviewRequest,
		signal?: AbortSignal,
	): Promise<Evidence | ReturnType<typeof blocked>> {
		if (signal?.aborted) return blocked('aborted')
		if (
			!/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,127}$/u.test(request.documentId) ||
			request.documentId.startsWith('-') ||
			request.documentId.includes('..') ||
			request.documentId.endsWith('.') ||
			getPublishedId(request.documentId) !== request.documentId
		)
			return blocked('invalid-document-id')
		try {
			const accessOptions = {
				url: `/projects/${projectId}/datasets/${dataset}/acl`,
				tag: rawOptions.tag,
				fetch: { cache: 'no-store', next: undefined },
				...(signal ? { signal } : {}),
			} as const
			const grants: unknown = await source.request(accessOptions)
			const access = checkUrlReadAccess(routes, grants, 'publish')
			if (!access.ok)
				return {
					...blocked('unknown-read-access'),
					accessIssues: access.issues,
				}
			const loaded = await load(
				{ readAccess: 'all-registered-versions' },
				signal,
			)
			if (loaded.status !== 'loaded')
				return blocked(`inventory-${loaded.reason}`)
			const documents = loaded.snapshot.inventory.documents.filter(record)
			const published = documents.find((row) => row._id === request.documentId)
			const draft = documents.find(
				(row) => row._id === `drafts.${request.documentId}`,
			)
			if (!published || !draft) return blocked('versions-changed')
			if (
				documents.some(
					(row) =>
						typeof row._id === 'string' &&
						row._id.startsWith('versions.') &&
						getPublishedId(row._id) === request.documentId,
				)
			)
				return blocked('release-version')
			if (
				published._rev !== request.publishedRevision ||
				draft._rev !== request.draftRevision ||
				published._type !== draft._type
			)
				return blocked('review-stale')
			const oldUrl = resolve(published)
			const newUrl = resolve(draft)
			if (!oldUrl.ok || !newUrl.ok) return blocked('invalid-url')
			if (oldUrl.value.pathname === newUrl.value.pathname)
				return blocked('url-unchanged')
			const before: string[] = []
			const after: string[] = []
			for (const document of documents) {
				const url = resolve(document)
				if (!url.ok) continue
				const id = document._id as string
				if (
					getPublishedId(id) !== request.documentId &&
					url.value.pathname === newUrl.value.pathname
				)
					return blocked(
						'url-conflict',
						await pageConflict(document, newUrl.value.pathname, signal),
					)
				if (!id.startsWith('drafts.') && !id.startsWith('versions.')) {
					before.push(url.value.pathname)
					after.push(
						id === request.documentId
							? newUrl.value.pathname
							: url.value.pathname,
					)
				}
			}
			const reader: FolderReadClient = source
			const redirects: unknown = await reader
				.withConfig({
					apiVersion: '2026-10-01',
					perspective: 'raw',
					useCdn: false,
					stega: false,
				})
				.fetch(
					redirectQuery,
					{},
					{ ...rawOptions, ...(signal ? { signal } : {}) },
				)
			if (signal?.aborted) return blocked('aborted')
			if (!Array.isArray(redirects))
				return {
					...blocked('redirect-inventory-invalid'),
					redirectIssue: 'invalid-envelope',
				}
			if (redirects.length > REDIRECT_MAX_RECORDS)
				return {
					...blocked('inventory-limit'),
					limit: {
						kind: 'redirect-records',
						actual: redirects.length,
						maximum: REDIRECT_MAX_RECORDS,
						measurement: 'at-least',
						phase: 'current',
					},
				}
			return {
				review: Object.freeze({
					documentId: request.documentId,
					draftRevision: request.draftRevision,
					publishedRevision: request.publishedRevision,
					oldPathname: oldUrl.value.pathname,
					newPathname: newUrl.value.pathname,
					affectedRedirects: [],
				}),
				fingerprint: JSON.stringify([documents, redirects]),
				redirects,
				documents,
				before,
				after,
			}
		} catch {
			return blocked(signal?.aborted ? 'aborted' : 'request-failed')
		}
	}
	function plan(snapshot: Evidence, createRedirect: boolean) {
		return planSinglePageRedirect({
			oldPathname: snapshot.review.oldPathname,
			newPathname: snapshot.review.newPathname,
			createRedirect,
			inventory: {
				perspective: 'raw',
				complete: true,
				records: snapshot.redirects,
			},
			occupiedPathsBefore: snapshot.before,
			occupiedPathsAfter: snapshot.after,
			reservedPaths: reserved,
			reservedPathPrefixes: registry.reservedPathPrefixes,
			// Other app-owned destinations may exist outside the registered pages.
			// This acknowledgment never relaxes cycle/source/occupancy checks.
			destinationsBefore: 'unverified',
			destinationsAfter: 'unverified',
		})
	}
	async function planBlocked(
		snapshot: Evidence,
		failure: Extract<ReturnType<typeof plan>, { ok: false }>,
		signal?: AbortSignal,
	): Promise<UrlPublicationBlocked> {
		const details = {
			...(failure.limit ? { limit: failure.limit } : {}),
			...(failure.snapshotReason
				? { redirectIssue: failure.snapshotReason }
				: {}),
		}
		if (failure.reason === 'target-is-reserved')
			return blocked(failure.reason, {
				kind: 'reserved',
				pathname: snapshot.review.newPathname,
			})
		const redirect = failure.recordId
			? snapshot.redirects.find(
					(row) => record(row) && row._id === failure.recordId,
				)
			: undefined
		if (record(redirect) && safeRedirectRecordId(redirect)) {
			const fields = redirectFieldIssues(redirect, failure.snapshotReason)
			const relatedPages: NonNullable<
				UrlPublicationConflict['relatedPages']
			>[number][] = []
			if (failure.snapshotReason === 'occupied-source') {
				for (const document of snapshot.documents) {
					if (signal?.aborted) return blocked('aborted')
					if (
						typeof document._id !== 'string' ||
						getPublishedId(document._id) !== document._id
					)
						continue
					const url = resolve(document)
					if (!url.ok || url.value.pathname !== redirect.source) continue
					const owner = await pageConflict(document, url.value.pathname, signal)
					relatedPages.push({
						documentId: owner.documentId!,
						pathname: owner.pathname,
						schemaType: owner.schemaType!,
						...(owner.title ? { title: owner.title } : {}),
					})
				}
			}
			if (signal?.aborted) return blocked('aborted')
			return {
				...blocked(failure.reason, {
					kind: 'redirect',
					...redirectRowDetails(redirect),
					schemaType: 'sanityKitRedirect',
					...relatedRedirectDetails(
						snapshot.redirects,
						redirect,
						failure.snapshotReason,
					),
					...(fields.length ? { fieldIssues: fields } : {}),
					...(relatedPages.length ? { relatedPages } : {}),
				}),
				...details,
			}
		}
		return { ...blocked(failure.reason), ...details }
	}

	async function review(
		request: ReviewRequest,
		signal?: AbortSignal,
	): Promise<UrlPublicationReviewResult> {
		if (busy) return blocked('busy')
		if (getPending(request.documentId)) return blocked('outcome-unknown')
		const snapshot = await evidence(request, signal)
		if ('status' in snapshot) return snapshot
		// Review existing aliases even when the editor later skips creating a new
		// redirect. Skipping the new rule must not leave old aliases broken.
		const planned = plan(snapshot, false)
		if (!planned.ok) return planBlocked(snapshot, planned, signal)
		const reviewed = Object.freeze({
			...snapshot.review,
			affectedRedirects: Object.freeze(
				planned.value.updates.map((update) =>
					Object.freeze({
						id: update.id,
						source: update.source,
						oldDestination: update.oldDestination,
						newDestination: update.newDestination,
						status: update.status,
					}),
				),
			),
		})
		proofs.set(reviewed, snapshot)
		return { status: 'ready', review: reviewed }
	}
	async function reconcile(
		documentId = lastDocumentId,
	): Promise<UrlPublicationResult> {
		try {
			if (!documentId) return blocked('no-pending-publication')
			// Prefer the operation this action actually displayed. Another action may
			// have finished it and even started a newer one while this view was away.
			const pending =
				captured.get(documentId) ?? readPendingPublication(scope(documentId))
			if (!pending) return blocked('no-pending-publication')
			captured.set(documentId, pending)
			if (pending.result) {
				captured.delete(documentId)
				return pending.result
			}
			const uncertain = pending.receipt
			// Read the Doc API directly: getDocument cannot override inherited caching.
			const receiptRequest = {
				url: `/data/doc/${dataset}/${String(uncertain._id)}`,
				maxRetries: 0,
				fetch: { cache: 'no-store', next: undefined },
				tag: rawOptions.tag,
			}
			const response: unknown = await source.request(receiptRequest)
			const receipt =
				record(response) &&
				Array.isArray(response.documents) &&
				response.documents.length === 1
					? (response.documents[0] as unknown)
					: undefined
			if (
				record(receipt) &&
				Object.entries(uncertain).every(
					([key, value]) => receipt[key] === value,
				)
			) {
				settlePendingPublication(scope(documentId), pending, {
					status: 'published',
				})
				captured.delete(documentId)
				return { status: 'published' }
			}
			// A known rejection may arrive while the receipt request is in flight.
			if (pending.result) {
				captured.delete(documentId)
				return pending.result
			}
		} catch {
			/* An absent/unreadable receipt is not proof of a failed write. */
		}
		return { status: 'unknown', reason: 'publication-outcome-unknown' }
	}
	async function publish(
		reviewed: UrlPublicationReview,
		choice: {
			readonly createRedirect: boolean
			readonly isCurrent: () => boolean
		},
	): Promise<UrlPublicationResult> {
		if (busy) return blocked('busy')
		if (getPending(reviewed.documentId)) return blocked('outcome-unknown')
		const original = proofs.get(reviewed)
		if (!original) return blocked('invalid-review')
		busy = true
		try {
			const fresh = await evidence(reviewed)
			if ('status' in fresh) return fresh
			if (fresh.fingerprint !== original.fingerprint)
				return blocked('review-stale')
			const planned = plan(fresh, choice.createRedirect)
			if (!planned.ok) return planBlocked(fresh, planned)
			if (!choice.isCurrent()) return blocked('review-stale')
			const operationId = crypto.randomUUID()
			const receiptId = `sanityKit.urlPublication.${operationId}`
			const redirectId = planned.value.create ? crypto.randomUUID() : null
			const receipt = {
				_id: receiptId,
				_type: 'sanityKitUrlPublication',
				operationId,
				documentId: reviewed.documentId,
				draftRevision: reviewed.draftRevision,
				publishedRevision: reviewed.publishedRevision,
				oldPathname: reviewed.oldPathname,
				newPathname: reviewed.newPathname,
				createRedirect: choice.createRedirect,
				redirectId,
				// Serialized for stable exact receipt comparison after a lost response.
				redirectUpdates: JSON.stringify(planned.value.updates),
			}
			const actions: Action[] = []
			for (const update of planned.value.updates) {
				// First create a draft from the guarded published base. This fails if
				// another editor created a draft after review; edit alone would reuse
				// that draft and risk publishing unrelated changes. The server copies
				// every field, including values absent from our small read projection.
				actions.push(
					{
						actionType: 'sanity.action.document.version.create',
						publishedId: update.id,
						baseId: update.id,
						versionId: `drafts.${update.id}`,
						ifBaseRevisionId: update.revision,
					},
					{
						actionType: 'sanity.action.document.edit',
						publishedId: update.id,
						draftId: `drafts.${update.id}`,
						patch: { set: { destination: update.newDestination } },
					},
					{
						actionType: 'sanity.action.document.publish',
						publishedId: update.id,
						draftId: `drafts.${update.id}`,
						ifPublishedRevisionId: update.revision,
					},
				)
			}
			if (planned.value.create && redirectId)
				actions.push(
					{
						actionType: 'sanity.action.document.create',
						publishedId: redirectId,
						attributes: {
							_id: `drafts.${redirectId}`,
							...planned.value.create,
						},
						ifExists: 'fail',
					},
					{
						actionType: 'sanity.action.document.publish',
						publishedId: redirectId,
						draftId: `drafts.${redirectId}`,
					},
				)
			actions.push(
				{
					actionType: 'sanity.action.document.publish',
					publishedId: reviewed.documentId,
					draftId: `drafts.${reviewed.documentId}`,
					ifDraftRevisionId: reviewed.draftRevision,
					ifPublishedRevisionId: reviewed.publishedRevision,
				},
				{
					actionType: 'sanity.action.document.create',
					publishedId: receiptId,
					attributes: { ...receipt, _id: `drafts.${receiptId}` },
					ifExists: 'fail',
				},
				{
					actionType: 'sanity.action.document.publish',
					publishedId: receiptId,
					draftId: `drafts.${receiptId}`,
				},
			)
			const actionBytes = new TextEncoder().encode(
				JSON.stringify({ actions, transactionId: operationId }),
			).length
			if (actionBytes > URL_PUBLICATION_MAX_ACTION_BYTES)
				return {
					...blocked('publication-operation-limit'),
					limit: {
						kind: 'publication-bytes',
						actual: actionBytes,
						maximum: URL_PUBLICATION_MAX_ACTION_BYTES,
						measurement: 'exact',
						phase: 'proposed',
					},
				}

			// Keep the exact receipt before dispatch: even a rejected promise can
			// mean the server committed but its response was lost.
			// Another mounted action may have sent a request during our evidence read.
			if (getPending(reviewed.documentId)) return blocked('outcome-unknown')
			lastDocumentId = reviewed.documentId
			const pending = { receipt, review: reviewed }
			captured.set(reviewed.documentId, pending)
			rememberPendingPublication(scope(reviewed.documentId), pending)
			try {
				await source.action(actions, {
					transactionId: operationId,
					tag: rawOptions.tag,
				})
				settlePendingPublication(scope(reviewed.documentId), pending, {
					status: 'published',
				})
				captured.delete(reviewed.documentId)
				proofs.delete(reviewed)
				return { status: 'published' }
			} catch (error) {
				const status = record(error) ? error.statusCode : undefined
				if (
					status === 400 ||
					status === 401 ||
					status === 403 ||
					status === 404 ||
					status === 409
				) {
					const result = blocked(
						status === 409 ? 'review-stale' : 'publication-rejected',
					)
					settlePendingPublication(scope(reviewed.documentId), pending, result)
					captured.delete(reviewed.documentId)
					proofs.delete(reviewed)
					return result
				}
				return reconcile()
			}
		} finally {
			busy = false
		}
	}
	return { review, publish, reconcile, getPending }
}
