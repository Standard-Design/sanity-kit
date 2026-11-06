/** Durable receipt recovery; a saved attempt never authorizes another write. */
import { pagePathname } from '../../url/registry.js'
import type {
	RedirectPublishResult,
	RedirectPublishReview,
} from './publication.js'
export interface RedirectReceipt {
	readonly _id: string
	readonly _type: string
	readonly operationId: string
	readonly documentId: string
	readonly draftRevision: string
	readonly publishedRevision: string | null
	readonly change: string
}
export interface PendingRedirect {
	readonly receipt: RedirectReceipt
	readonly review: RedirectPublishReview
	result?: Exclude<RedirectPublishResult, { status: 'unknown' }>
}
export interface RedirectScope {
	readonly projectId: string
	readonly dataset: string
	readonly documentId: string
}
const memory = new Map<string, PendingRedirect>()
const keyFor = (scope: RedirectScope) =>
	`sanity-kit.redirect-publication:${JSON.stringify([scope.projectId, scope.dataset, scope.documentId])}`
export function readPendingRedirect(
	scope: RedirectScope,
): PendingRedirect | undefined {
	const key = keyFor(scope),
		cached = memory.get(key)
	if (cached) return cached
	let saved: string | null
	try {
		saved = globalThis.sessionStorage?.getItem(key) ?? null
	} catch {
		throw new Error('Saved redirect publication is unavailable.')
	}
	if (!saved) return undefined
	const value = decodePendingRedirect(saved, scope)
	memory.set(key, value)
	return value
}
function decodePendingRedirect(
	saved: string,
	scope: RedirectScope,
): PendingRedirect {
	if (saved.length > 2_097_152)
		throw new Error('Saved redirect publication exceeds recovery limit.')
	const value = JSON.parse(saved) as PendingRedirect
	const revision = (item: unknown) =>
		typeof item === 'string' && item.length > 0 && item.length <= 128
	const path = (item: unknown) =>
		typeof item === 'string' &&
		item.length <= 1_048_576 &&
		pagePathname(item) === item &&
		(item === '/' || (!item.endsWith('/') && !item.includes('//')))
	const receipt = value?.receipt,
		review = value?.review
	if (
		!receipt ||
		!review ||
		!revision(review.draftRevision) ||
		(review.publishedRevision !== null &&
			!revision(review.publishedRevision)) ||
		!review.after ||
		!path(review.after.source) ||
		!path(review.after.destination) ||
		typeof review.after.enabled !== 'boolean' ||
		![301, 302].includes(review.after.status) ||
		(review.before !== null &&
			(typeof review.before !== 'object' || Array.isArray(review.before))) ||
		receipt.documentId !== scope.documentId ||
		review.documentId !== scope.documentId ||
		receipt._type !== 'sanityKitRedirectPublication' ||
		!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(
			receipt.operationId,
		) ||
		receipt._id !== `sanityKit.redirectPublication.${receipt.operationId}` ||
		receipt.draftRevision !== review.draftRevision ||
		receipt.publishedRevision !== review.publishedRevision ||
		receipt.change !== JSON.stringify(review.after)
	)
		throw new Error('Saved redirect publication could not be read safely.')
	delete value.result
	return value
}
export function rememberPendingRedirect(
	scope: RedirectScope,
	value: PendingRedirect,
): boolean {
	const key = keyFor(scope)
	try {
		if (!globalThis.sessionStorage) return false
		const serialized = JSON.stringify(value)
		decodePendingRedirect(serialized, scope)
		globalThis.sessionStorage.setItem(key, serialized)
		if (globalThis.sessionStorage.getItem(key) !== serialized) return false
		memory.set(key, value)
		return true
	} catch {
		return false
	}
}
export function settlePendingRedirect(
	scope: RedirectScope,
	value: PendingRedirect,
	result: NonNullable<PendingRedirect['result']>,
): void {
	value.result = result
	const key = keyFor(scope)
	if (memory.get(key)?.receipt.operationId !== value.receipt.operationId) return
	memory.delete(key)
	try {
		const saved = globalThis.sessionStorage?.getItem(key)
		if (
			saved &&
			(JSON.parse(saved) as PendingRedirect).receipt?.operationId ===
				value.receipt.operationId
		)
			globalThis.sessionStorage.removeItem(key)
	} catch {
		/* Leave unreadable or newer recovery information intact. */
	}
}
