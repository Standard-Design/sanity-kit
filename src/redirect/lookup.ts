/** Private, bounded published lookup. Studio keeps its separate global checks. */
import type { FilteredResponseQueryOptions } from '@sanity/client'
import { defineQuery } from 'groq'
import { REDIRECT_API_VERSION, type RedirectReadClient } from './load.js'
import {
	compileRedirectSnapshot,
	type RedirectMatch,
	type RedirectSnapshotOptions,
	type RedirectSnapshotReason,
} from './snapshot.js'

const published = /* groq */ `_type == "sanityKitRedirect"
	&& !(_id in path("drafts.**")) && !(_id in path("versions.**"))
	&& enabled != false`
// Content Lake equality cannot compare strings longer than 1,024 characters.
// Length plus one complete split is exact, including for those long values.
// Ordinary paths retain the indexed equality filter. The long-path fallback
// scans the redirect type on the server, but still returns at most two rows.
const longSource = /* groq */ `length(source) == length($pathname)
	&& count(string::split(source, $pathname)) == 2`
const projection = /* groq */ `{
	_id, _type, _rev, _createdAt, _updatedAt,
	source, destination, status, enabled, origin,
	"destinationIsRedirect": select(
		length(destination) > 1024 => count(*[${published}
			&& length(source) == length(^.destination)
			&& count(string::split(source, ^.destination)) == 2][0...1]) > 0,
		count(*[${published} && source == ^.destination][0...1]) > 0
	)
}`
const query = defineQuery(
	/* groq */ `*[${published} && source == $pathname][0...2] ${projection}`,
)
const longQuery = defineQuery(
	/* groq */ `*[${published} && ${longSource}][0...2] ${projection}`,
)

export type LookupFailure = {
	readonly kind: 'error'
	readonly reason:
		'aborted' | 'request-failed' | 'invalid-response' | 'invalid-snapshot'
	readonly snapshotReason?: RedirectSnapshotReason
	readonly recordId?: string
}
export type LookupMatch = Extract<RedirectMatch, { kind: 'redirect' | 'none' }>
export type LookupResult = LookupMatch | LookupFailure

/** Validate the bounded wire/cache value under the current policy. */
export function validateLookup(
	rows: unknown,
	pathname: string,
	policy: RedirectSnapshotOptions,
): LookupResult {
	if (!Array.isArray(rows) || rows.length > 2)
		return { kind: 'error', reason: 'invalid-response' }
	const records: Record<string, unknown>[] = []
	for (const row of rows as unknown[]) {
		if (!row || typeof row !== 'object' || Array.isArray(row))
			return { kind: 'error', reason: 'invalid-response' }
		const { destinationIsRedirect, ...record } = row as Record<string, unknown>
		if (
			typeof destinationIsRedirect !== 'boolean' ||
			record.source !== pathname ||
			record.enabled === false
		)
			return { kind: 'error', reason: 'invalid-response' }
		records.push(record)
	}
	const compiled = compileRedirectSnapshot(
		{ perspective: 'published', complete: true, records },
		policy,
	)
	if (!compiled.ok)
		return {
			kind: 'error',
			reason: 'invalid-snapshot',
			snapshotReason: compiled.reason,
			...(compiled.recordId ? { recordId: compiled.recordId } : {}),
		}
	if (
		rows.some(
			(row: { destinationIsRedirect: boolean }) => row.destinationIsRedirect,
		)
	)
		return {
			kind: 'error',
			reason: 'invalid-snapshot',
			snapshotReason: 'redirect-chain',
			...(records[0] ? { recordId: records[0]._id as string } : {}),
		}
	const match = compiled.value.match(pathname)
	return match.kind === 'redirect' || match.kind === 'none'
		? match
		: { kind: 'error', reason: 'invalid-response' }
}

export async function loadRedirectLookup(
	client: RedirectReadClient,
	pathname: string,
	policy: RedirectSnapshotOptions,
	signal?: AbortSignal,
): Promise<{ readonly rows: unknown; readonly result: LookupResult }> {
	if (signal?.aborted)
		return { rows: undefined, result: { kind: 'error', reason: 'aborted' } }
	let rows: unknown
	try {
		rows = await client
			.withConfig({
				apiVersion: REDIRECT_API_VERSION,
				perspective: 'published',
				useCdn: false,
				stega: false,
			})
			.fetch(pathname.length > 1024 ? longQuery : query, { pathname }, {
				perspective: 'published',
				useCdn: false,
				stega: false,
				filterResponse: true,
				resultSourceMap: false,
				cache: 'no-store',
				tag: 'sanity-kit.redirect-lookup',
				...(signal ? { signal } : {}),
			} as FilteredResponseQueryOptions)
	} catch {
		return {
			rows: undefined,
			result: {
				kind: 'error',
				reason: signal?.aborted ? 'aborted' : 'request-failed',
			},
		}
	}
	const result: LookupResult = signal?.aborted
		? { kind: 'error', reason: 'aborted' }
		: validateLookup(rows, pathname, policy)
	return {
		// Successful validation permits only the projected primitive record shape.
		// Detach cache payloads from mutable SDK/transport objects.
		rows:
			result.kind === 'error'
				? undefined
				: (rows as Record<string, unknown>[]).map((row) => ({ ...row })),
		result,
	}
}
