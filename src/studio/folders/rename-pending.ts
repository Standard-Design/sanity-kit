/**
 * Keep the exact receipt identity before a folder rename is sent. Session storage
 * survives reloads in this tab; the shared memory slot coordinates mounted views.
 * Neither a saved record nor an absent receipt is permission to repeat a write.
 */
import { pagePathname } from '../../url/registry.js'

export interface FolderRenameReceipt {
	readonly _id: string
	readonly _type: 'sanityKitFolderRename'
	readonly operationId: string
	readonly oldPathname: string
	readonly newPathname: string
	readonly createRedirects: boolean
	/** Serialized review and generated redirect IDs, compared exactly on recovery. */
	readonly evidence: string
}
export interface FolderRenameSettlement {
	readonly status: 'renamed' | 'rejected'
	readonly operationId: string
	readonly reason?: 'conflict' | 'permission-denied' | 'request-rejected'
}
export interface PendingFolderRename {
	readonly receipt: FolderRenameReceipt
	/** Only a confirmed server response or exact receipt match may set this. */
	result?: FolderRenameSettlement
}
export interface FolderRenameScope {
	readonly projectId: string
	readonly dataset: string
}
export interface FolderRenameRecoveryStorage {
	getItem(key: string): string | null
	setItem(key: string, value: string): void
	removeItem(key: string): void
}
const pending = new Map<string, PendingFolderRename>()
const keyFor = (scope: FolderRenameScope) =>
	`sanity-kit.folder-rename:${JSON.stringify([scope.projectId, scope.dataset])}`
const MAX_RECOVERY_BYTES = 2_097_152

function storageOrDefault(storage?: FolderRenameRecoveryStorage) {
	return storage ?? globalThis.sessionStorage
}
function parseReceipt(text: string): FolderRenameReceipt {
	if (text.length > MAX_RECOVERY_BYTES)
		throw new Error('Folder rename recovery exceeds its size limit.')
	const value: unknown = JSON.parse(text)
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new Error('Folder rename recovery is invalid.')
	const row = value as Record<string, unknown>
	const fields = [
		'_id',
		'_type',
		'operationId',
		'oldPathname',
		'newPathname',
		'createRedirects',
		'evidence',
	]
	if (
		Object.keys(row).length !== fields.length ||
		!fields.every((key) => Object.hasOwn(row, key)) ||
		row._type !== 'sanityKitFolderRename' ||
		typeof row.operationId !== 'string' ||
		!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(
			row.operationId,
		) ||
		row._id !== `sanityKit.folderRename.${row.operationId}` ||
		typeof row.oldPathname !== 'string' ||
		pagePathname(row.oldPathname) !== row.oldPathname ||
		typeof row.newPathname !== 'string' ||
		pagePathname(row.newPathname) !== row.newPathname ||
		row.oldPathname === row.newPathname ||
		typeof row.createRedirects !== 'boolean' ||
		typeof row.evidence !== 'string'
	)
		throw new Error('Folder rename recovery is invalid.')
	return Object.freeze(row as unknown as FolderRenameReceipt)
}

export function readPendingFolderRename(
	scope: FolderRenameScope,
	storage?: FolderRenameRecoveryStorage,
): PendingFolderRename | undefined {
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
export function rememberPendingFolderRename(
	scope: FolderRenameScope,
	value: PendingFolderRename,
	storage?: FolderRenameRecoveryStorage,
): void {
	const key = keyFor(scope)
	if (readPendingFolderRename(scope, storage))
		throw new Error('Folder rename is already pending.')
	const target = storageOrDefault(storage)
	if (!target) throw new Error('Folder rename recovery storage is unavailable.')
	const text = JSON.stringify(value.receipt)
	parseReceipt(text)
	target.setItem(key, text)
	if (target.getItem(key) !== text)
		throw new Error('Folder rename recovery could not be persisted.')
	pending.set(key, value)
}

/** Never clear a newer operation recorded by another mounted view. */
export function settlePendingFolderRename(
	scope: FolderRenameScope,
	value: PendingFolderRename,
	result: FolderRenameSettlement,
	storage?: FolderRenameRecoveryStorage,
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
