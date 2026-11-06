/**
 * Plan every live URL move against one redirect graph. Checking moves one at a
 * time can miss conflicts introduced by another move in the same review. This
 * module returns review data only, never IDs for creation or executable writes.
 * See docs/folders.md for the separate transaction and recovery gates.
 */
import {
	compileRedirectSnapshot,
	REDIRECT_MAX_BYTES,
	REDIRECT_MAX_RECORDS,
	type RedirectSnapshotReason,
	type RedirectSnapshotOptions,
} from '../../redirect/snapshot.js'
import { pagePathname } from '../../url/registry.js'
import { isReservedPath } from '../../url/reservations.js'
import { measureRedirectInventory } from '../url/publication-limits.js'
import { safeRedirectRecordId } from '../url/publication-diagnostics.js'
import {
	REDIRECT_PUBLICATION_METADATA_HEADROOM_BYTES,
	type RedirectPublicationCreate,
	type RedirectPublicationUpdate,
} from '../url/publication-plan.js'

export interface BulkRedirectMove {
	readonly oldPathname: string
	readonly newPathname: string
}
export interface BulkRedirectRequest {
	readonly moves: readonly BulkRedirectMove[]
	/** Draft targets reserve URLs, but do not create or retarget live redirects. */
	readonly draftDestinations?: readonly string[]
	readonly createRedirects: boolean
	readonly inventory: {
		readonly perspective: 'raw'
		readonly complete: boolean
		readonly records: readonly unknown[]
	}
	readonly occupiedPathsBefore: readonly string[]
	readonly occupiedPathsAfter: readonly string[]
	readonly destinationsBefore: RedirectSnapshotOptions['destinations']
	readonly destinationsAfter: RedirectSnapshotOptions['destinations']
	readonly reservedPaths?: readonly string[]
	readonly reservedPathPrefixes?: readonly string[]
}
export interface BulkRedirectPlan {
	readonly creates: readonly RedirectPublicationCreate[]
	readonly updates: readonly RedirectPublicationUpdate[]
}
export type BulkRedirectResult =
	| { readonly ok: true; readonly value: BulkRedirectPlan }
	| {
			readonly ok: false
			readonly reason:
				| 'invalid-moves'
				| 'incomplete-inventory'
				| 'invalid-inventory'
				| 'limit-exceeded'
				| 'invalid-before-snapshot'
				| 'invalid-after-snapshot'
				| 'pending-redirect-change'
				| 'target-is-redirect'
				| 'target-is-reserved'
				| 'source-is-reserved'
			readonly recordId?: string
			readonly snapshotReason?: RedirectSnapshotReason
	  }

export const BULK_REDIRECT_MAX_CHANGES = 100
const record = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value)
const isArray = (value: unknown): boolean => Array.isArray(value)
const pending = (id: string) =>
	id.startsWith('drafts.') || id.startsWith('versions.')
const baseId = (id: string) =>
	id.startsWith('drafts.')
		? id.slice(7)
		: id.startsWith('versions.')
			? id.split('.').slice(2).join('.')
			: id
const canonical = (value: unknown): value is string =>
	typeof value === 'string' &&
	value.length <= 2048 &&
	pagePathname(value) === value &&
	(value === '/' || (!value.endsWith('/') && !value.includes('//')))

/** Existing aliases follow the move even when editors opt out of new aliases. */
export function planBulkRedirects(
	request: BulkRedirectRequest,
): BulkRedirectResult {
	const fail = (
		reason: Extract<BulkRedirectResult, { ok: false }>['reason'],
	): BulkRedirectResult => ({ ok: false, reason })
	if (!isArray(request.moves) || typeof request.createRedirects !== 'boolean')
		return fail('invalid-moves')
	const moves = new Map<string, string>()
	const destinations = new Set<string>()
	for (const move of request.moves) {
		if (
			!canonical(move.oldPathname) ||
			!canonical(move.newPathname) ||
			move.oldPathname === move.newPathname ||
			moves.has(move.oldPathname) ||
			destinations.has(move.newPathname)
		)
			return fail('invalid-moves')
		moves.set(move.oldPathname, move.newPathname)
		destinations.add(move.newPathname)
	}
	// Source/destination overlap needs a separate URL-swap policy; this first bulk plan
	// never swaps occupied URLs or turns a retained page into a redirect source.
	for (const [oldPath, newPath] of moves) {
		if (
			isReservedPath(
				oldPath,
				request.reservedPaths,
				request.reservedPathPrefixes,
			)
		)
			return fail('source-is-reserved')
		if (
			moves.has(newPath) ||
			!request.occupiedPathsBefore.includes(oldPath) ||
			!request.occupiedPathsAfter.includes(newPath) ||
			request.occupiedPathsAfter.includes(oldPath)
		)
			return fail('invalid-moves')
		if (
			isReservedPath(
				newPath,
				request.reservedPaths,
				request.reservedPathPrefixes,
			)
		)
			return fail('target-is-reserved')
	}
	if (
		request.draftDestinations !== undefined &&
		!Array.isArray(request.draftDestinations)
	)
		return fail('invalid-moves')
	for (const path of request.draftDestinations ?? []) {
		if (!canonical(path)) return fail('invalid-moves')
		if (
			isReservedPath(path, request.reservedPaths, request.reservedPathPrefixes)
		)
			return fail('target-is-reserved')
		destinations.add(path)
	}
	const inventory = request.inventory
	if (
		!inventory ||
		inventory.perspective !== 'raw' ||
		inventory.complete !== true ||
		!Array.isArray(inventory.records)
	)
		return fail('incomplete-inventory')
	if (inventory.records.length > REDIRECT_MAX_RECORDS)
		return fail('limit-exceeded')
	const rows: (Record<string, unknown> & {
		_id: string
		_rev: string
		enabled: boolean
	})[] = []
	const ids = new Set<string>()
	for (const value of inventory.records) {
		if (
			!record(value) ||
			!safeRedirectRecordId(value) ||
			typeof value._id !== 'string' ||
			typeof value._rev !== 'string' ||
			!value._rev ||
			typeof value.enabled !== 'boolean' ||
			ids.has(value._id)
		)
			return fail('invalid-inventory')
		ids.add(value._id)
		rows.push(value as (typeof rows)[number])
	}
	const measured = measureRedirectInventory(rows, REDIRECT_MAX_BYTES)
	if (!measured) return fail('invalid-inventory')
	if (measured.actual > REDIRECT_MAX_BYTES) return fail('limit-exceeded')
	const published = rows.filter((row) => !pending(row._id))
	const envelope = (records: readonly unknown[]) => ({
		perspective: 'published',
		complete: true,
		records,
	})
	const options = {
		...(request.reservedPaths ? { reservedPaths: request.reservedPaths } : {}),
		...(request.reservedPathPrefixes
			? { reservedPathPrefixes: request.reservedPathPrefixes }
			: {}),
	}
	const before = compileRedirectSnapshot(envelope(published), {
		...options,
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
	const aliases = published.filter(
		(row) =>
			row.enabled &&
			typeof row.destination === 'string' &&
			moves.has(row.destination),
	)
	const affected = new Set(aliases.map((row) => row._id))
	for (const row of rows) {
		if (
			pending(row._id) &&
			(affected.has(baseId(row._id)) ||
				[row.source, row.destination].some(
					(path) =>
						typeof path === 'string' &&
						(moves.has(path) || destinations.has(path)),
				))
		)
			return { ok: false, reason: 'pending-redirect-change', recordId: row._id }
	}
	const target = published.find(
		(row) =>
			row.enabled &&
			typeof row.source === 'string' &&
			destinations.has(row.source),
	)
	if (target)
		return { ok: false, reason: 'target-is-redirect', recordId: target._id }
	const updates: RedirectPublicationUpdate[] = aliases.map((row) => ({
		id: row._id,
		revision: row._rev,
		source: row.source as string,
		oldDestination: row.destination as string,
		newDestination: moves.get(row.destination as string)!,
		status: row.status as 301 | 302,
	}))
	const creates: RedirectPublicationCreate[] = request.createRedirects
		? [...moves].map(([source, destination]) => ({
				_type: 'sanityKitRedirect',
				source,
				destination,
				status: 301,
				enabled: true,
				origin: 'url-change',
			}))
		: []
	if (
		creates.length + updates.length > BULK_REDIRECT_MAX_CHANGES ||
		rows.length + creates.length > REDIRECT_MAX_RECORDS
	)
		return fail('limit-exceeded')
	const revised = rows.map((row) =>
		affected.has(row._id)
			? { ...row, destination: moves.get(row.destination as string)! }
			: row,
	)
	// Temporary identities exist only to compile the proposed graph. The future
	// writer must generate opaque IDs once and include them in its durable receipt.
	let next = 0
	const proposed = creates.map((value) => {
		let id: string
		do {
			id = `proposed-bulk-redirect-${next++}`
		} while (ids.has(id))
		ids.add(id)
		return { ...value, _id: id }
	})
	const bytes =
		new TextEncoder().encode(
			JSON.stringify(envelope([...revised, ...proposed])),
		).byteLength +
		(creates.length + updates.length) *
			REDIRECT_PUBLICATION_METADATA_HEADROOM_BYTES
	if (bytes > REDIRECT_MAX_BYTES) return fail('limit-exceeded')
	const after = compileRedirectSnapshot(
		envelope([...revised.filter((row) => !pending(row._id)), ...proposed]),
		{
			...options,
			occupiedPaths: request.occupiedPathsAfter,
			destinations: request.destinationsAfter,
		},
	)
	if (!after.ok)
		return {
			ok: false,
			reason: 'invalid-after-snapshot',
			snapshotReason: after.reason,
			...(after.recordId && !proposed.some((row) => row._id === after.recordId)
				? { recordId: after.recordId }
				: {}),
		}
	return { ok: true, value: { creates, updates } }
}
