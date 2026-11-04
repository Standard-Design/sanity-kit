/**
 * Remember the exact operation we sent, not a permission to send it again.
 * Session storage survives Studio reloads in this tab. The memory copy keeps
 * recovery available during navigation when browser storage is unavailable.
 */
import type {
	UrlPublicationResult,
	UrlPublicationReview,
} from './publication.js'
import { pagePathname } from '../../url/registry.js'
import { REDIRECT_PUBLICATION_MAX_UPDATES } from './publication-plan.js'

export interface PendingUrlPublication {
	readonly receipt: Record<string, unknown>
	readonly review: UrlPublicationReview
	/** Shared with already-mounted recovery readers; never trusted from storage. */
	result?: Exclude<UrlPublicationResult, { readonly status: 'unknown' }>
}
export interface PublicationScope {
	readonly projectId: string
	readonly dataset: string
	readonly documentId: string
}
const memory = new Map<string, PendingUrlPublication>()
const keyFor = (scope: PublicationScope) =>
	`sanity-kit.url-publication:${JSON.stringify([
		scope.projectId,
		scope.dataset,
		scope.documentId.replace(/^drafts\./u, ''),
	])}`

export function readPendingPublication(
	scope: PublicationScope,
): PendingUrlPublication | undefined {
	const key = keyFor(scope)
	const cached = memory.get(key)
	if (cached) return cached
	let saved: string | null
	try {
		saved = globalThis.sessionStorage?.getItem(key) ?? null
	} catch {
		return undefined
	}
	if (!saved) return undefined
	// A corrupt recovery record must not silently enable another publication.
	// The caller can report the read failure; an administrator must inspect it.
	if (saved.length > 2_097_152)
		throw new Error('The saved publication result exceeds the recovery limit.')
	const value = JSON.parse(saved) as PendingUrlPublication
	// Only a live server response or verified receipt may supply this field.
	if (value && typeof value === 'object') delete value.result
	const receipt = value?.receipt
	const review = value?.review
	const uuid = (item: unknown): item is string =>
		typeof item === 'string' &&
		/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(item)
	const revision = (item: unknown): item is string =>
		typeof item === 'string' && item.length > 0 && item.length <= 128
	const pathname = (item: unknown): item is string =>
		typeof item === 'string' && pagePathname(item) === item
	if (
		!receipt ||
		!review ||
		review.documentId !== scope.documentId.replace(/^drafts\./u, '') ||
		receipt.documentId !== review.documentId ||
		receipt._type !== 'sanityKitUrlPublication' ||
		!uuid(receipt.operationId) ||
		receipt._id !== `sanityKit.urlPublication.${receipt.operationId}` ||
		typeof receipt.createRedirect !== 'boolean' ||
		(receipt.createRedirect
			? !uuid(receipt.redirectId)
			: receipt.redirectId !== null) ||
		!revision(review.draftRevision) ||
		!revision(review.publishedRevision) ||
		!pathname(review.oldPathname) ||
		!pathname(review.newPathname) ||
		review.oldPathname === review.newPathname ||
		receipt.oldPathname !== review.oldPathname ||
		receipt.newPathname !== review.newPathname ||
		receipt.draftRevision !== review.draftRevision ||
		receipt.publishedRevision !== review.publishedRevision ||
		typeof receipt.redirectUpdates !== 'string' ||
		!Array.isArray(review.affectedRedirects) ||
		review.affectedRedirects.length > REDIRECT_PUBLICATION_MAX_UPDATES
	)
		throw new Error('The saved publication result could not be read safely.')
	const updates: unknown = JSON.parse(receipt.redirectUpdates)
	if (
		!Array.isArray(updates) ||
		updates.length !== review.affectedRedirects.length ||
		!updates.every((update: unknown, index) => {
			if (!update || typeof update !== 'object') return false
			const item = update as Record<string, unknown>
			const shown = review.affectedRedirects[index]
			return (
				shown &&
				typeof item.id === 'string' &&
				item.id.length > 0 &&
				revision(item.revision) &&
				pathname(item.source) &&
				pathname(item.oldDestination) &&
				item.newDestination === review.newPathname &&
				(item.status === 301 || item.status === 302) &&
				['id', 'source', 'oldDestination', 'newDestination', 'status'].every(
					(field) =>
						item[field] ===
						(shown as unknown as Record<string, unknown>)[field],
				)
			)
		})
	)
		throw new Error('The saved redirect review could not be read safely.')
	memory.set(key, value)
	return value
}

export function rememberPendingPublication(
	scope: PublicationScope,
	value: PendingUrlPublication,
): void {
	const key = keyFor(scope)
	memory.set(key, value)
	try {
		globalThis.sessionStorage?.setItem(key, JSON.stringify(value))
	} catch {
		// Keep the in-memory recovery even when storage is disabled or full.
	}
}

export function forgetPendingPublication(scope: PublicationScope): void {
	const key = keyFor(scope)
	memory.delete(key)
	try {
		globalThis.sessionStorage?.removeItem(key)
	} catch {
		// A stale saved record can only require another receipt check, not a write.
	}
}

/**
 * Readers that already captured this operation can observe its definite result
 * even after it leaves the shared pending slot. Never clear a newer operation.
 */
export function settlePendingPublication(
	scope: PublicationScope,
	operation: PendingUrlPublication,
	result: NonNullable<PendingUrlPublication['result']>,
): void {
	operation.result = result
	const key = keyFor(scope)
	const saved = memory.get(key)
	if (saved?.receipt.operationId !== operation.receipt.operationId) return
	memory.delete(key)
	try {
		const stored = globalThis.sessionStorage?.getItem(key)
		if (!stored) return
		const value = JSON.parse(stored) as PendingUrlPublication
		if (value.receipt?.operationId === operation.receipt.operationId)
			globalThis.sessionStorage.removeItem(key)
	} catch {
		// Leave unreadable or independently replaced storage for a future review.
	}
}
