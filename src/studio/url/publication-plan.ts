/**
 * Private, pure redirect planning for one page's publication. The caller reads
 * complete data, checks page ownership, and later coordinates the actual write.
 * This plan neither publishes content nor promises database-wide uniqueness.
 * See docs/redirects-design.md for the publication and redirect boundaries.
 */
import {
	compileRedirectSnapshot,
	REDIRECT_MAX_BYTES,
	REDIRECT_MAX_RECORDS,
	type RedirectSnapshotOptions,
	type RedirectSnapshotReason,
} from '../../redirect/snapshot.js'
import {
	measureRedirectInventory,
	type UrlPublicationLimit,
} from './publication-limits.js'
import { safeRedirectRecordId } from './publication-diagnostics.js'
import { pagePathname } from '../../url/registry.js'
import { isReservedPath } from '../../url/reservations.js'

export interface RedirectPublicationRequest {
	readonly oldPathname: string
	readonly newPathname: string
	readonly createRedirect: boolean
	/** Completeness is a caller assertion; raw does not bypass Sanity permissions. */
	readonly inventory: {
		readonly perspective: 'raw'
		readonly complete: boolean
		readonly records: readonly unknown[]
	}
	readonly reservedPaths?: readonly string[]
	readonly reservedPathPrefixes?: readonly string[]
	readonly occupiedPathsBefore: readonly string[]
	readonly occupiedPathsAfter: readonly string[]
	readonly destinationsBefore: RedirectSnapshotOptions['destinations']
	readonly destinationsAfter: RedirectSnapshotOptions['destinations']
}

/**
 * No path-derived identity. The publication service supplies a fresh opaque ID
 * when coordinating creation and publication in the same Actions API batch.
 */
export interface RedirectPublicationCreate {
	readonly _type: 'sanityKitRedirect'
	readonly source: string
	readonly destination: string
	readonly status: 301
	readonly enabled: true
	readonly origin: 'url-change'
}

/** Reviewable destination-only change; other saved redirect fields stay intact. */
export interface RedirectPublicationUpdate {
	readonly id: string
	readonly revision: string
	readonly source: string
	readonly oldDestination: string
	readonly newDestination: string
	readonly status: 301 | 302
}

/** A kit review/transaction bound, not a claimed Sanity API action-count limit. */
export const REDIRECT_PUBLICATION_MAX_UPDATES = 100

/**
 * Operational headroom per changed rule for a real generated ID and Sanity's
 * revision/timestamp fields. This is deliberately conservative, not a promise
 * about a maximum metadata size imposed by the Content Lake API.
 */
export const REDIRECT_PUBLICATION_METADATA_HEADROOM_BYTES = 1024

export type RedirectPublicationReason =
	| 'invalid-path'
	| 'unchanged-path'
	| 'invalid-inventory'
	| 'incomplete-inventory'
	| 'inventory-limit'
	| 'invalid-before-snapshot'
	| 'invalid-after-snapshot'
	| 'pending-redirect-change'
	| 'target-is-redirect'
	| 'too-many-redirect-updates'
	| 'target-is-reserved'
	| 'source-not-occupied'
	| 'target-not-occupied'
	| 'source-still-occupied'

export type RedirectPublicationResult =
	| {
			readonly ok: true
			readonly value: {
				readonly create?: RedirectPublicationCreate
				readonly updates: readonly RedirectPublicationUpdate[]
			}
	  }
	| {
			readonly ok: false
			readonly reason: RedirectPublicationReason
			readonly recordId?: string
			readonly snapshotReason?: RedirectSnapshotReason
			readonly limit?: UrlPublicationLimit
	  }

type Row = Record<string, unknown> & {
	_id: string
	_rev: string
	enabled: boolean
}
const record = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value)

function canonical(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		value.length <= REDIRECT_MAX_BYTES &&
		pagePathname(value) === value &&
		(value === '/' || (!value.endsWith('/') && !value.includes('//')))
	)
}

function identity(id: unknown): { base: string; pending: boolean } | undefined {
	if (
		typeof id !== 'string' ||
		!/^[A-Za-z0-9_.-]{1,128}$/u.test(id) ||
		id.startsWith('-') ||
		id.includes('..')
	)
		return undefined
	const pending = id.startsWith('drafts.') || id.startsWith('versions.')
	const base = id.startsWith('drafts.')
		? id.slice('drafts.'.length)
		: id.startsWith('versions.')
			? id.split('.').slice(2).join('.')
			: id
	if (
		!base ||
		base.startsWith('-') ||
		base.startsWith('drafts.') ||
		base.split('.').includes('versions')
	)
		return undefined
	return { base, pending }
}

/**
 * Existing active aliases are explicitly listed for review and retargeted to
 * the new page URL. Both permanent and temporary rules retain their status and
 * origin; the writer changes only destination. Opting out skips the new rule,
 * not these reviewed updates or path, occupancy, and existing-rule checks.
 */
export function planSinglePageRedirect(
	request: RedirectPublicationRequest,
): RedirectPublicationResult {
	const { oldPathname, newPathname, inventory } = request
	if (!canonical(oldPathname) || !canonical(newPathname))
		return { ok: false, reason: 'invalid-path' }
	if (oldPathname === newPathname)
		return { ok: false, reason: 'unchanged-path' }
	if (!record(inventory) || !Array.isArray(inventory.records))
		return {
			ok: false,
			reason: 'invalid-inventory',
			snapshotReason: 'invalid-envelope',
		}
	if (inventory.perspective !== 'raw')
		return {
			ok: false,
			reason: 'incomplete-inventory',
			snapshotReason: 'wrong-perspective',
		}
	if (inventory.complete !== true)
		return {
			ok: false,
			reason: 'incomplete-inventory',
			snapshotReason: 'incomplete-snapshot',
		}
	if (inventory.records.length > REDIRECT_MAX_RECORDS)
		return {
			ok: false,
			reason: 'inventory-limit',
			limit: {
				kind: 'redirect-records',
				actual: inventory.records.length,
				maximum: REDIRECT_MAX_RECORDS,
				measurement: 'exact',
				phase: 'current',
			},
		}
	const rows: Row[] = []
	const seen = new Set<string>()
	for (const value of inventory.records) {
		if (
			!record(value) ||
			!['_id', '_type', '_rev', 'enabled'].every((key) =>
				Object.hasOwn(value, key),
			) ||
			value._type !== 'sanityKitRedirect' ||
			!safeRedirectRecordId(value) ||
			typeof value._id !== 'string' ||
			typeof value._rev !== 'string' ||
			!value._rev ||
			typeof value.enabled !== 'boolean' ||
			seen.has(value._id)
		)
			return {
				ok: false,
				reason: 'invalid-inventory',
				snapshotReason:
					record(value) && typeof value._id === 'string' && seen.has(value._id)
						? 'duplicate-id'
						: 'invalid-record',
				...(safeRedirectRecordId(value)
					? { recordId: safeRedirectRecordId(value)! }
					: {}),
			}
		seen.add(value._id)
		rows.push(value as Row)
	}
	const envelope = (records: readonly unknown[]) => ({
		perspective: 'published',
		complete: true,
		records,
	})
	const measured = measureRedirectInventory(rows, REDIRECT_MAX_BYTES)
	if (!measured) {
		const malformed = rows.find(
			(row) => !measureRedirectInventory([row], REDIRECT_MAX_BYTES),
		)
		const recordId = safeRedirectRecordId(malformed)
		return {
			ok: false,
			reason: 'invalid-inventory',
			snapshotReason: 'invalid-record',
			...(recordId ? { recordId } : {}),
		}
	}
	if (measured.actual > REDIRECT_MAX_BYTES)
		return {
			ok: false,
			reason: 'inventory-limit',
			limit: {
				kind: 'redirect-bytes',
				...measured,
				maximum: REDIRECT_MAX_BYTES,
				phase: 'current',
			},
		}
	// The scalar measurement validates the projected shape for every version,
	// including disabled history. Active published rules are compiled below.
	const published = rows.filter((row) => !identity(row._id)!.pending)
	const before = compileRedirectSnapshot(envelope(published), {
		...(request.reservedPaths ? { reservedPaths: request.reservedPaths } : {}),
		...(request.reservedPathPrefixes
			? { reservedPathPrefixes: request.reservedPathPrefixes }
			: {}),
		occupiedPaths: request.occupiedPathsBefore,
		destinations: request.destinationsBefore,
	})
	if (!before.ok)
		return {
			ok: false,
			reason: 'invalid-before-snapshot',
			snapshotReason: before.reason,
			...(before.recordId ? { recordId: before.recordId } : {}),
		}
	const affected = new Set(
		published
			.filter(
				(row) =>
					row.enabled &&
					(row.source === oldPathname ||
						row.source === newPathname ||
						row.destination === oldPathname),
			)
			.map((row) => row._id),
	)
	for (const row of rows) {
		const id = identity(row._id)!
		if (
			id.pending &&
			(affected.has(id.base) ||
				row.source === oldPathname ||
				row.source === newPathname ||
				row.destination === oldPathname ||
				row.destination === newPathname)
		)
			return {
				ok: false,
				reason: 'pending-redirect-change',
				recordId: row._id,
			}
	}
	const target = published.find(
		(row) => row.enabled && row.source === newPathname,
	)
	if (target)
		return { ok: false, reason: 'target-is-redirect', recordId: target._id }
	const aliases = published.filter(
		(row) => row.enabled && row.destination === oldPathname,
	)
	if (aliases.length > REDIRECT_PUBLICATION_MAX_UPDATES)
		return {
			ok: false,
			reason: 'too-many-redirect-updates',
			limit: {
				kind: 'redirect-updates',
				actual: aliases.length,
				maximum: REDIRECT_PUBLICATION_MAX_UPDATES,
				measurement: 'exact',
				phase: 'proposed',
			},
		}
	const updates: RedirectPublicationUpdate[] = aliases.map((row) => ({
		id: row._id,
		revision: row._rev,
		// The compiled before-snapshot has validated active rule paths/statuses.
		source: row.source as string,
		oldDestination: oldPathname,
		newDestination: newPathname,
		status: row.status as 301 | 302,
	}))
	if (
		isReservedPath(
			newPathname,
			request.reservedPaths,
			request.reservedPathPrefixes,
		)
	)
		return { ok: false, reason: 'target-is-reserved' }
	if (!request.occupiedPathsBefore.includes(oldPathname))
		return { ok: false, reason: 'source-not-occupied' }
	if (!request.occupiedPathsAfter.includes(newPathname))
		return { ok: false, reason: 'target-not-occupied' }
	if (request.occupiedPathsAfter.includes(oldPathname))
		return { ok: false, reason: 'source-still-occupied' }
	const create: RedirectPublicationCreate | undefined = request.createRedirect
		? {
				_type: 'sanityKitRedirect',
				source: oldPathname,
				destination: newPathname,
				status: 301,
				enabled: true,
				origin: 'url-change',
			}
		: undefined
	// Include pending versions and disabled history, just as the raw loader does.
	// A successful operation must not put its next read beyond the same bound.
	if (rows.length + (create ? 1 : 0) > REDIRECT_MAX_RECORDS)
		return {
			ok: false,
			reason: 'inventory-limit',
			limit: {
				kind: 'redirect-records',
				actual: rows.length + (create ? 1 : 0),
				maximum: REDIRECT_MAX_RECORDS,
				measurement: 'exact',
				phase: 'proposed',
			},
		}
	let proposedIndex = 0
	let proposedId = `proposed-redirect-${proposedIndex}`
	while (seen.has(proposedId))
		proposedId = `proposed-redirect-${++proposedIndex}`
	const revisedRows = rows.map((row) =>
		aliases.includes(row) ? { ...row, destination: newPathname } : row,
	)
	const metadataHeadroom =
		(updates.length + (create ? 1 : 0)) *
		REDIRECT_PUBLICATION_METADATA_HEADROOM_BYTES
	const proposedBytes =
		new TextEncoder().encode(
			JSON.stringify(
				envelope([
					...revisedRows,
					...(create ? [{ ...create, _id: proposedId }] : []),
				]),
			),
		).length + metadataHeadroom
	if (proposedBytes > REDIRECT_MAX_BYTES)
		return {
			ok: false,
			reason: 'inventory-limit',
			limit: {
				kind: 'redirect-bytes',
				actual: proposedBytes,
				maximum: REDIRECT_MAX_BYTES,
				measurement: 'estimated',
				phase: 'proposed',
			},
		}
	const after = compileRedirectSnapshot(
		envelope([
			...revisedRows.filter((row) => !identity(row._id)!.pending),
			...(create ? [{ ...create, _id: proposedId }] : []),
		]),
		{
			...(request.reservedPaths
				? { reservedPaths: request.reservedPaths }
				: {}),
			...(request.reservedPathPrefixes
				? { reservedPathPrefixes: request.reservedPathPrefixes }
				: {}),
			occupiedPaths: request.occupiedPathsAfter,
			destinations: request.destinationsAfter,
		},
	)
	if (!after.ok)
		return {
			ok: false,
			reason: 'invalid-after-snapshot',
			snapshotReason: after.reason,
			...(after.recordId && after.recordId !== proposedId
				? { recordId: after.recordId }
				: {}),
		}
	return { ok: true, value: { ...(create ? { create } : {}), updates } }
}
