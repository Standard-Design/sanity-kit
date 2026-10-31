/**
 * Private, pure redirect foundation. A later loader will supply one complete
 * published snapshot; a later router adapter will decide when lookup is allowed.
 * This module validates and matches data only. See docs/redirects.md.
 */
import { pagePathname } from '../url/registry.js'

/** Proposed first-version bounds, not a claim that all sites fit one snapshot. */
export const REDIRECT_MAX_RECORDS = 1_000
export const REDIRECT_MAX_BYTES = 1_048_576

export interface RedirectSnapshotOptions {
	/** Exact app endpoints that redirects must never claim. Not route patterns. */
	readonly reservedPaths?: readonly string[]
	/** Current published page URLs, supplied by the application/publication review. */
	readonly occupiedPaths?: readonly string[]
	/** Acknowledge unknown destinations explicitly; never infer existence by fetching. */
	readonly destinations: readonly string[] | 'unverified'
}

export type RedirectMatch =
	| {
			readonly kind: 'redirect'
			readonly location: string
			readonly status: 301 | 302
	  }
	| { readonly kind: 'none' }
	| { readonly kind: 'bypass'; readonly reason: 'reserved-path' }
	| { readonly kind: 'invalid-path' }

export interface RedirectSnapshot {
	/** Enabled rules only; disabled history records do not enter the index. */
	readonly size: number
	/** Checked against the supplied path list, not against the running website. */
	readonly destinationsVerified: boolean
	readonly match: (pathname: unknown) => RedirectMatch
}

export type RedirectSnapshotReason =
	| 'invalid-envelope'
	| 'incomplete-snapshot'
	| 'wrong-perspective'
	| 'too-many-records'
	| 'payload-too-large'
	| 'invalid-record'
	| 'unpublished-record'
	| 'duplicate-id'
	| 'invalid-source'
	| 'invalid-destination'
	| 'unsupported-status'
	| 'duplicate-source'
	| 'self-redirect'
	| 'redirect-cycle'
	| 'redirect-chain'
	| 'reserved-source'
	| 'occupied-source'
	| 'unknown-destination'

export type RedirectSnapshotResult =
	| { readonly ok: true; readonly value: RedirectSnapshot }
	| {
			readonly ok: false
			readonly reason: RedirectSnapshotReason
			readonly recordId?: string
	  }

interface Rule {
	readonly id: string
	readonly destination: string
	readonly status: 301 | 302
}

const fields = new Set([
	'_id',
	'_type',
	'_rev',
	'_createdAt',
	'_updatedAt',
	'source',
	'destination',
	'status',
	'enabled',
	'origin',
])
const encoder = new TextEncoder()

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Shared safety rules, with no normalization (including no Stega repair). */
function canonical(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		value.length <= REDIRECT_MAX_BYTES &&
		pagePathname(value) === value &&
		(value === '/' || (!value.endsWith('/') && !value.includes('//')))
	)
}

function pathSet(
	paths: readonly string[] | undefined,
	label: string,
): Set<string> {
	if (paths === undefined) return new Set()
	if (!Array.isArray(paths) || paths.some((path) => !canonical(path)))
		throw new Error(`${label} must contain canonical root-relative pathnames.`)
	return new Set<string>(paths)
}

/**
 * Inspect only the small projected record shape, before serialization. Unknown
 * nested values are rejected rather than recursively walking arbitrary content.
 * The byte budget includes disabled records; they cannot hide an oversized load.
 */
function recordBytes(row: Record<string, unknown>): number | undefined {
	const keys = Object.keys(row)
	if (keys.length > fields.size || keys.some((key) => !fields.has(key)))
		return undefined
	let bytes = 2
	for (const key of keys) {
		const value = row[key]
		if (
			value !== null &&
			typeof value !== 'string' &&
			typeof value !== 'boolean' &&
			typeof value !== 'number'
		)
			return undefined
		if (typeof value === 'number' && !Number.isFinite(value)) return undefined
		// Every UTF-16 code unit needs at least one UTF-8 byte in JSON. Stop before
		// allocating a serialized copy of a maliciously large string.
		if (typeof value === 'string' && value.length > REDIRECT_MAX_BYTES)
			return REDIRECT_MAX_BYTES + 1
		bytes +=
			encoder.encode(JSON.stringify(key)).length +
			1 +
			encoder.encode(JSON.stringify(value)).length +
			1
		if (bytes > REDIRECT_MAX_BYTES) return bytes
	}
	return bytes - (keys.length ? 1 : 0)
}

/**
 * Refuse the whole snapshot on any active-rule ambiguity. The envelope's
 * complete/published labels are loader assertions, not proof of visibility,
 * freshness, or permissions. No cache, network, publication, or HTTP side effects.
 */
export function compileRedirectSnapshot(
	input: unknown,
	options: RedirectSnapshotOptions,
): RedirectSnapshotResult {
	const reserved = pathSet(options.reservedPaths, 'reservedPaths')
	const occupied = pathSet(options.occupiedPaths, 'occupiedPaths')
	if (
		options.destinations !== 'unverified' &&
		!Array.isArray(options.destinations)
	)
		throw new Error(
			'Supply known destinations or explicitly acknowledge unverified destinations.',
		)
	const destinations =
		options.destinations === 'unverified'
			? undefined
			: pathSet(options.destinations, 'destinations')
	if (
		!record(input) ||
		!['perspective', 'complete', 'records'].every((key) =>
			Object.hasOwn(input, key),
		) ||
		Object.keys(input).some(
			(key) => !['perspective', 'complete', 'records'].includes(key),
		) ||
		!Array.isArray(input.records)
	)
		return { ok: false, reason: 'invalid-envelope' }
	if (input.complete !== true)
		return { ok: false, reason: 'incomplete-snapshot' }
	if (input.perspective !== 'published')
		return { ok: false, reason: 'wrong-perspective' }
	if (input.records.length > REDIRECT_MAX_RECORDS)
		return { ok: false, reason: 'too-many-records' }
	let bytes = encoder.encode(
		JSON.stringify({
			perspective: 'published',
			complete: true,
			records: [],
		}),
	).length
	const rules = new Map<string, Rule>()
	const ids = new Set<string>()
	for (const row of input.records as unknown[]) {
		if (
			!record(row) ||
			!['_id', '_type', 'enabled'].every((key) => Object.hasOwn(row, key))
		)
			return { ok: false, reason: 'invalid-record' }
		const size = recordBytes(row)
		if (size === undefined) return { ok: false, reason: 'invalid-record' }
		bytes += size + (ids.size ? 1 : 0)
		if (bytes > REDIRECT_MAX_BYTES)
			return { ok: false, reason: 'payload-too-large' }
		const { _id, _type, enabled, source, destination, status } = row
		if (
			typeof _id !== 'string' ||
			!/^[A-Za-z0-9_.-]{1,128}$/u.test(_id) ||
			_id.startsWith('-') ||
			_id.includes('..') ||
			_id.split('.').slice(1).includes('versions') ||
			_type !== 'sanityKitRedirect' ||
			typeof enabled !== 'boolean'
		)
			return { ok: false, reason: 'invalid-record' }
		if (_id.startsWith('drafts.') || _id.startsWith('versions.'))
			return { ok: false, reason: 'unpublished-record', recordId: _id }
		if (ids.has(_id))
			return { ok: false, reason: 'duplicate-id', recordId: _id }
		ids.add(_id)
		// Disabled historical rules may retain obsolete paths/statuses. They must
		// still have a valid identity and fit the bounded projected shape.
		if (!enabled) continue
		if (
			!['source', 'destination', 'status'].every((key) =>
				Object.hasOwn(row, key),
			)
		)
			return { ok: false, reason: 'invalid-record', recordId: _id }
		if (!canonical(source))
			return { ok: false, reason: 'invalid-source', recordId: _id }
		if (!canonical(destination))
			return { ok: false, reason: 'invalid-destination', recordId: _id }
		if (status !== 301 && status !== 302)
			return { ok: false, reason: 'unsupported-status', recordId: _id }
		if (source === destination)
			return { ok: false, reason: 'self-redirect', recordId: _id }
		if (rules.has(source))
			return { ok: false, reason: 'duplicate-source', recordId: _id }
		if (reserved.has(source))
			return { ok: false, reason: 'reserved-source', recordId: _id }
		if (occupied.has(source))
			return { ok: false, reason: 'occupied-source', recordId: _id }
		if (destinations && !destinations.has(destination))
			return { ok: false, reason: 'unknown-destination', recordId: _id }
		rules.set(source, { id: _id, destination, status })
	}
	// Walk iteratively, not recursively: long imported graphs must not overflow
	// the call stack. Mark each visited source once, then reject ordinary chains.
	const state = new Map<string, 'visiting' | 'done'>()
	for (const source of rules.keys()) {
		let current = source
		const trail: string[] = []
		while (rules.has(current) && state.get(current) !== 'done') {
			if (state.get(current) === 'visiting')
				return {
					ok: false,
					reason: 'redirect-cycle',
					recordId: rules.get(current)!.id,
				}
			state.set(current, 'visiting')
			trail.push(current)
			current = rules.get(current)!.destination
		}
		for (const path of trail) state.set(path, 'done')
	}
	for (const rule of rules.values()) {
		if (rules.has(rule.destination))
			return { ok: false, reason: 'redirect-chain', recordId: rule.id }
	}
	return {
		ok: true,
		value: Object.freeze({
			size: rules.size,
			destinationsVerified: destinations !== undefined,
			match(pathname: unknown): RedirectMatch {
				if (!canonical(pathname)) return { kind: 'invalid-path' }
				if (reserved.has(pathname))
					return { kind: 'bypass', reason: 'reserved-path' }
				const rule = rules.get(pathname)
				return rule
					? {
							kind: 'redirect',
							location: rule.destination,
							status: rule.status,
						}
					: { kind: 'none' }
			},
		}),
	}
}
