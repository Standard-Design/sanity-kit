/**
 * Keep the exact receipt identity before a collection-prefix change is sent.
 * Session storage survives reloads; shared memory coordinates mounted views.
 * Neither a saved record nor an absent receipt is permission to repeat a write.
 */
import { pagePathname } from '../../url/registry.js'

export interface CollectionPrefixReceipt {
	readonly _id: string
	readonly _type: 'sanityKitCollectionPrefixPublication'
	readonly operationId: string
	readonly oldPrefix: string
	readonly newPrefix: string
	readonly createRedirects: boolean
	/** Serialized review and generated redirect IDs, compared exactly on recovery. */
	readonly evidence: string
}
export interface CollectionPrefixSettlement {
	readonly status: 'published' | 'rejected'
	readonly operationId: string
	readonly reason?: 'conflict' | 'permission-denied' | 'request-rejected'
}
export interface PendingCollectionPrefix {
	readonly receipt: CollectionPrefixReceipt
	/** Only a confirmed server response or exact receipt match may set this. */
	result?: CollectionPrefixSettlement
}
export interface CollectionPrefixScope {
	readonly projectId: string
	readonly dataset: string
}
export interface CollectionPrefixRecoveryStorage {
	getItem(key: string): string | null
	setItem(key: string, value: string): void
	removeItem(key: string): void
}
const pending = new Map<string, PendingCollectionPrefix>()
const keyFor = (scope: CollectionPrefixScope) =>
	`sanity-kit.collection-prefix:${JSON.stringify([scope.projectId, scope.dataset])}`
const MAX_RECOVERY_BYTES = 2_097_152

function storageOrDefault(storage?: CollectionPrefixRecoveryStorage) {
	return storage ?? globalThis.sessionStorage
}
function parseReceipt(text: string): CollectionPrefixReceipt {
	if (text.length > MAX_RECOVERY_BYTES)
		throw new Error('Collection-prefix change recovery exceeds its size limit.')
	const value: unknown = JSON.parse(text)
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new Error('Collection-prefix change recovery is invalid.')
	const row = value as Record<string, unknown>
	const fields = [
		'_id',
		'_type',
		'operationId',
		'oldPrefix',
		'newPrefix',
		'createRedirects',
		'evidence',
	]
	if (
		Object.keys(row).length !== fields.length ||
		!fields.every((key) => Object.hasOwn(row, key)) ||
		row._type !== 'sanityKitCollectionPrefixPublication' ||
		typeof row.operationId !== 'string' ||
		!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(
			row.operationId,
		) ||
		row._id !== `sanityKit.collectionPrefixPublication.${row.operationId}` ||
		typeof row.oldPrefix !== 'string' ||
		pagePathname(row.oldPrefix) !== row.oldPrefix ||
		typeof row.newPrefix !== 'string' ||
		pagePathname(row.newPrefix) !== row.newPrefix ||
		row.oldPrefix === row.newPrefix ||
		typeof row.createRedirects !== 'boolean' ||
		typeof row.evidence !== 'string'
	)
		throw new Error('Collection-prefix change recovery is invalid.')
	return Object.freeze(row as unknown as CollectionPrefixReceipt)
}

export function readPendingCollectionPrefix(
	scope: CollectionPrefixScope,
	storage?: CollectionPrefixRecoveryStorage,
): PendingCollectionPrefix | undefined {
	const key = keyFor(scope)
	const memory = pending.get(key)
	if (memory) return memory
	const text = storageOrDefault(storage)?.getItem(key)
	if (!text) return undefined
	const value = { receipt: parseReceipt(text) }
	pending.set(key, value)
	return value
}

/** Refuse dispatch if recovery cannot survive a same-tab reload. */
export function rememberPendingCollectionPrefix(
	scope: CollectionPrefixScope,
	value: PendingCollectionPrefix,
	storage?: CollectionPrefixRecoveryStorage,
): void {
	const key = keyFor(scope)
	if (readPendingCollectionPrefix(scope, storage))
		throw new Error('Collection-prefix change is already pending.')
	const target = storageOrDefault(storage)
	if (!target)
		throw new Error('Collection-prefix change recovery storage is unavailable.')
	const text = JSON.stringify(value.receipt)
	parseReceipt(text)
	target.setItem(key, text)
	if (target.getItem(key) !== text)
		throw new Error('Collection-prefix change recovery could not be persisted.')
	pending.set(key, value)
}

/** Never clear a newer operation recorded by another mounted view. */
export function settlePendingCollectionPrefix(
	scope: CollectionPrefixScope,
	value: PendingCollectionPrefix,
	result: CollectionPrefixSettlement,
	storage?: CollectionPrefixRecoveryStorage,
): void {
	value.result = result
	const key = keyFor(scope)
	if (pending.get(key)?.receipt.operationId !== value.receipt.operationId)
		return
	pending.delete(key)
	try {
		const target = storageOrDefault(storage)
		const text = target?.getItem(key)
		if (text && parseReceipt(text).operationId === value.receipt.operationId)
			target?.removeItem(key)
	} catch {
		// Keeping an unreadable/stale slot asks for recovery; it never repeats a write.
	}
}
