/**
 * Private Sanity read boundary for redirects. The pure snapshot compiler decides
 * whether rules are usable; this module supplies published data from the app's
 * configured project and dataset. See docs/redirects.md for visibility limits.
 */
import type { ClientConfig, FilteredResponseQueryOptions } from '@sanity/client'
import { defineQuery } from 'groq'
import {
	compileRedirectSnapshot,
	REDIRECT_MAX_RECORDS,
	type RedirectSnapshot,
	type RedirectSnapshotOptions,
	type RedirectSnapshotReason,
} from './snapshot.js'

export interface RedirectLoadOptions extends RedirectSnapshotOptions {
	readonly signal?: AbortSignal
}

/** Structural boundary also accepts a Studio client from another SDK instance. */
export interface RedirectReadClient {
	withConfig(
		config: Pick<
			ClientConfig,
			'apiVersion' | 'perspective' | 'useCdn' | 'stega'
		>,
	): {
		fetch(
			query: string,
			params: Record<string, unknown>,
			options: FilteredResponseQueryOptions,
		): Promise<unknown>
	}
}

export type RedirectLoadResult =
	| { readonly ok: true; readonly value: RedirectSnapshot }
	| {
			readonly ok: false
			readonly reason: 'aborted' | 'request-failed' | 'invalid-response'
	  }
	| {
			readonly ok: false
			readonly reason: 'invalid-snapshot'
			readonly snapshotReason: RedirectSnapshotReason
			readonly recordId?: string
	  }

// Include disabled history in the same bound as the compiler. Fetch one extra
// row so an oversized dataset cannot become an apparently complete small snapshot.
// The app's project and dataset define the boundary: one website per dataset.
// Explicit version exclusions reinforce the published perspective.
const redirectQuery = defineQuery(/* groq */ `
	*[_type == "sanityKitRedirect"
		&& !(_id in path("drafts.**"))
		&& !(_id in path("versions.**"))
	] | order(_id asc)[0...${REDIRECT_MAX_RECORDS + 1}] {
		_id, _type, _rev, _createdAt, _updatedAt,
		source, destination, status, enabled, origin
	}
`)

/**
 * Read and validate once; no cache or shared in-flight request survives the call.
 * Invalid trusted configuration throws before any request. Fetch failures and
 * malformed fetched data return distinct failures, never an empty success.
 */
export async function loadRedirectSnapshot(
	client: RedirectReadClient,
	options: RedirectLoadOptions,
): Promise<RedirectLoadResult> {
	// Reuse the compiler's configuration checks before copying caller arrays.
	// The empty input is only validation; it is never returned as a fallback.
	compileRedirectSnapshot(
		{
			perspective: 'published',
			complete: true,
			records: [],
		},
		options,
	)
	const policy: RedirectSnapshotOptions = {
		destinations:
			options.destinations === 'unverified'
				? 'unverified'
				: [...options.destinations],
		...(options.reservedPaths
			? { reservedPaths: [...options.reservedPaths] }
			: {}),
		...(options.occupiedPaths
			? { occupiedPaths: [...options.occupiedPaths] }
			: {}),
	}
	const { signal } = options
	if (signal?.aborted) return { ok: false, reason: 'aborted' }
	// withConfig clones the SDK client: the app retains its own preview settings,
	// credentials, project and dataset. This loader never chooses a tenant for it.
	const source = client.withConfig({
		apiVersion: '2026-10-01',
		perspective: 'published',
		useCdn: false,
		stega: false,
	})
	let rows: unknown
	// SDK declarations expose cache only with Next's RequestInit augmentation,
	// but its shared transport forwards it to fetch in every environment. Keep
	// that verified type boundary here; no Next dependency or global type patch.
	const fetchOptions = {
		perspective: 'published',
		useCdn: false,
		stega: false,
		filterResponse: true,
		resultSourceMap: false,
		cache: 'no-store',
		tag: 'sanity-kit.redirects',
		...(signal ? { signal } : {}),
	} as FilteredResponseQueryOptions
	try {
		rows = await source.fetch(redirectQuery, {}, fetchOptions)
	} catch {
		return { ok: false, reason: signal?.aborted ? 'aborted' : 'request-failed' }
	}
	// A custom transport can ignore cancellation and settle late. Do not expose
	// that response as current data to the caller that cancelled its operation.
	if (signal?.aborted) return { ok: false, reason: 'aborted' }
	if (!Array.isArray(rows) || rows.length > REDIRECT_MAX_RECORDS + 1)
		return { ok: false, reason: 'invalid-response' }
	const result = compileRedirectSnapshot(
		{
			perspective: 'published',
			complete: true,
			records: rows,
		},
		policy,
	)
	if (result.ok) return result
	return {
		ok: false,
		reason: 'invalid-snapshot',
		snapshotReason: result.reason,
		...(result.recordId === undefined ? {} : { recordId: result.recordId }),
	}
}
