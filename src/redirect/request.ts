/**
 * Private request boundary for the redirect subsystem. snapshot.ts decides
 * whether data is safe; load.ts supplies published data; this module decides
 * whether a request may use it. See docs/redirects.md for the cache contract.
 * This is plain HTTP handling, not a React Router data-request adapter.
 */
import type { ClientConfig } from '@sanity/client'
import {
	captureRedirectPolicy,
	loadRedirectData,
	REDIRECT_API_VERSION,
	type RedirectLoadFailure,
	type RedirectReadClient,
	type RedirectSnapshotData,
} from './load.js'
import {
	compileRedirectSnapshot,
	type RedirectMatch,
	type RedirectSnapshotOptions,
	type RedirectSnapshotReason,
} from './snapshot.js'

export interface RedirectRequestClient extends RedirectReadClient {
	config(): Pick<ClientConfig, 'projectId' | 'dataset'>
	withConfig(
		config: Parameters<RedirectReadClient['withConfig']>[0] &
			Pick<ClientConfig, 'projectId' | 'dataset'>,
	): ReturnType<RedirectReadClient['withConfig']>
}

/** No token, cookie, request query, or user identity belongs in this context. */
export interface RedirectCacheContext {
	readonly projectId: string
	readonly dataset: string
	readonly apiVersion: string
	readonly schemaVersion: 1
	readonly queryVersion: 1
	/** SHA-256 identity covers all fields above and the captured validation policy. */
	readonly key: string
}

export interface RedirectCache {
	/** Optional partition/bypass hook. Returning null skips this adapter entirely. */
	key?(context: RedirectCacheContext): string | null
	/**
	 * Store only the callback's returned JSON value, with a finite lifetime.
	 * This callback is deliberately independent of any one HTTP request's abort
	 * signal: deduplicated callers must not cancel each other's shared refresh.
	 */
	getOrLoad: (key: string, load: () => Promise<unknown>) => Promise<unknown>
	/** Must prevent an older in-flight load from repopulating the invalidated key. */
	invalidate: (key: string) => Promise<void>
}

export interface RedirectRequestOptions extends RedirectSnapshotOptions {
	/** Trusted app preview/session decision; never inferred from a URL parameter. */
	readonly preview: boolean
	readonly cache?: RedirectCache
	/** Explicit safe names only. Empty/omitted drops all incoming query parameters. */
	readonly queryParameterAllowlist?: readonly string[]
}

export type RedirectRequestResult =
	| RedirectMatch
	| { readonly kind: 'bypass'; readonly reason: 'method' | 'preview' }
	| {
			readonly kind: 'error'
			readonly reason:
				| 'aborted'
				| 'request-failed'
				| 'invalid-response'
				| 'invalid-snapshot'
				| 'cache-failed'
				| 'invalid-cache'
			readonly snapshotReason?: RedirectSnapshotReason
			readonly recordId?: string
	  }

// This is defense in depth, not an exhaustive classifier of private query data.
// Consumers must only allow names whose values are safe to expose in a Location.
const sensitiveName =
	/(?:sanity|preview|token|secret|password|credential|session|auth|cookie|signature)|^(?:code|state|key|api[-_]?key|jwt|sig)$/iu

function queryNames(input: readonly string[] = []): ReadonlySet<string> {
	for (const name of input) {
		if (
			typeof name !== 'string' ||
			!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u.test(name) ||
			sensitiveName.test(name)
		)
			throw new Error(
				'Redirect query allowlist must contain safe, non-sensitive parameter names',
			)
	}
	return new Set(input)
}

function emptyLookup(policy: RedirectSnapshotOptions) {
	const result = compileRedirectSnapshot(
		{ perspective: 'published', complete: true, records: [] },
		policy,
	)
	if (!result.ok) throw new Error('Empty redirect policy could not be compiled')
	return result.value
}

function failure(result: RedirectLoadFailure): RedirectRequestResult {
	const { ok: _ok, ...details } = result
	void _ok
	return { kind: 'error', ...details }
}

/** Stable policy identity: ordering/duplicates of set-like lists do not matter. */
async function cacheContext(
	client: RedirectRequestClient,
	policy: RedirectSnapshotOptions,
): Promise<RedirectCacheContext> {
	const { projectId, dataset } = client.config()
	if (
		typeof projectId !== 'string' ||
		!/^[a-z0-9]+$/u.test(projectId) ||
		typeof dataset !== 'string' ||
		!/^[a-z0-9_][a-z0-9_-]{0,63}$/u.test(dataset)
	)
		throw new Error(
			'Redirect caching requires a configured Sanity project and dataset',
		)
	const fields = {
		projectId,
		dataset,
		apiVersion: REDIRECT_API_VERSION,
		schemaVersion: 1 as const,
		queryVersion: 1 as const,
	}
	const sorted = (values: readonly string[] = []) => [...new Set(values)].sort()
	const identity = JSON.stringify({
		...fields,
		destinations:
			policy.destinations === 'unverified'
				? 'unverified'
				: sorted(policy.destinations),
		occupiedPaths: sorted(policy.occupiedPaths),
		reservedPaths: sorted(policy.reservedPaths),
		reservedPathPrefixes: sorted(policy.reservedPathPrefixes),
	})
	const hash = await crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(identity),
	)
	const digest = [...new Uint8Array(hash)]
		.map((value) => value.toString(16).padStart(2, '0'))
		.join('')
	return Object.freeze({ ...fields, key: `sanity-kit.redirects.v1.${digest}` })
}

function adapterKey(
	cache: RedirectCache,
	context: RedirectCacheContext,
): string | null {
	const partition = cache.key ? cache.key(context) : ''
	if (partition === null) return null
	if (
		typeof partition !== 'string' ||
		partition.length > 256 ||
		/\p{Cc}/u.test(partition)
	)
		throw new Error('Invalid redirect cache partition key')
	// A custom key cannot remove project/dataset or policy isolation.
	return partition
		? `${context.key}.${encodeURIComponent(partition)}`
		: context.key
}

interface CacheEntry {
	readonly scope: string
	readonly snapshot: RedirectSnapshotData
}
class OriginFailure extends Error {
	constructor(readonly result: RedirectLoadFailure) {
		super(result.reason)
	}
}

/** Stop waiting promptly even when a custom cache/transport ignores cancellation. */
async function waitForRequest<T>(
	operation: Promise<T>,
	signal: AbortSignal,
): Promise<T | 'aborted'> {
	if (signal.aborted) {
		void operation.catch(() => undefined)
		return 'aborted'
	}
	let abort: () => void = () => undefined
	const cancelled = new Promise<'aborted'>((resolve) => {
		abort = () => resolve('aborted')
		signal.addEventListener('abort', abort, { once: true })
	})
	try {
		return await Promise.race([operation, cancelled])
	} finally {
		signal.removeEventListener('abort', abort)
	}
}

/**
 * Resolve a logical page Request. Bypasses never touch Sanity or the cache.
 * The caller owns route placement and preview detection. Pass the actual page
 * URL, not framework transport URLs such as React Router's .data endpoint.
 */
export async function resolveRedirectRequest(
	client: RedirectRequestClient,
	request: Request,
	options: RedirectRequestOptions,
): Promise<RedirectRequestResult> {
	if (request.method !== 'GET' && request.method !== 'HEAD')
		return { kind: 'bypass', reason: 'method' }
	if (options.preview) return { kind: 'bypass', reason: 'preview' }
	const policy = captureRedirectPolicy(options)
	const names = queryNames(options.queryParameterAllowlist)
	const url = new URL(request.url)
	const preliminary = emptyLookup(policy).match(url.pathname)
	if (preliminary.kind !== 'none') return preliminary
	if (request.signal.aborted) return { kind: 'error', reason: 'aborted' }
	const { cache } = options
	let raw: unknown
	let usedCache = false
	if (cache) {
		const context = await cacheContext(client, policy)
		if (request.signal.aborted) return { kind: 'error', reason: 'aborted' }
		try {
			const key = adapterKey(cache, context)
			if (key !== null) {
				usedCache = true
				const entry = await waitForRequest(
					cache.getOrLoad(key, async (): Promise<CacheEntry> => {
						// Shared refresh lives independently of the first waiting request. The
						// loader still checks every rule before this callback permits storage.
						const loaded = await loadRedirectData(
							{
								withConfig: (config) =>
									client.withConfig({
										...config,
										projectId: context.projectId,
										dataset: context.dataset,
									}),
							},
							policy,
						)
						if (!loaded.ok) throw new OriginFailure(loaded)
						return { scope: context.key, snapshot: loaded.value }
					}),
					request.signal,
				)
				if (entry === 'aborted' || request.signal.aborted)
					return { kind: 'error', reason: 'aborted' }
				if (
					!entry ||
					typeof entry !== 'object' ||
					Array.isArray(entry) ||
					Object.keys(entry).length !== 2 ||
					!Object.hasOwn(entry, 'scope') ||
					!Object.hasOwn(entry, 'snapshot') ||
					(entry as CacheEntry).scope !== context.key
				)
					return { kind: 'error', reason: 'invalid-cache' }
				raw = (entry as CacheEntry).snapshot
			}
		} catch (error) {
			if (request.signal.aborted) return { kind: 'error', reason: 'aborted' }
			if (error instanceof OriginFailure) return failure(error.result)
			return { kind: 'error', reason: 'cache-failed' }
		}
	}
	if (!usedCache) {
		const result = await waitForRequest(
			loadRedirectData(client, { ...policy, signal: request.signal }),
			request.signal,
		)
		if (result === 'aborted' || request.signal.aborted)
			return { kind: 'error', reason: 'aborted' }
		if (!result.ok) return failure(result)
		raw = result.value
	}
	// Storage is untrusted: even a hit must pass current graph/path/size policy.
	const compiled = compileRedirectSnapshot(raw, policy)
	if (!compiled.ok)
		return {
			kind: 'error',
			reason: 'invalid-cache',
			snapshotReason: compiled.reason,
			...(compiled.recordId ? { recordId: compiled.recordId } : {}),
		}
	const match = compiled.value.match(url.pathname)
	if (match.kind !== 'redirect') return match
	const query = new URLSearchParams()
	for (const [name, value] of url.searchParams)
		if (names.has(name)) query.append(name, value)
	return {
		...match,
		location: match.location + (query.size ? `?${query.toString()}` : ''),
	}
}

/**
 * Optional plain-HTTP conversion. Errors remain visible as a non-cacheable 503
 * (400 for invalid paths); bypass/miss leaves routing to the application.
 * Framework adapters must use their own redirect/data-response conventions.
 */
export function redirectResponse(
	result: RedirectRequestResult,
): Response | undefined {
	if (result.kind === 'none' || result.kind === 'bypass') return undefined
	if (result.kind === 'error' || result.kind === 'invalid-path')
		return new Response(
			result.kind === 'invalid-path'
				? 'Invalid URL'
				: 'Redirects are temporarily unavailable',
			{
				status: result.kind === 'invalid-path' ? 400 : 503,
				headers: { 'Cache-Control': 'no-store' },
			},
		)
	// Defend the HTTP boundary as well as the compiler: never emit a supplied
	// external origin, fragment, control character, or unsafe path as Location.
	const path = result.location.split('?')[0]
	if (
		(result.status !== 301 && result.status !== 302) ||
		/[#\p{Cc}]/u.test(result.location) ||
		emptyLookup({ destinations: 'unverified' }).match(path).kind ===
			'invalid-path'
	)
		throw new Error('Unsafe redirect response')
	return new Response(null, {
		status: result.status,
		headers: { Location: result.location, 'Cache-Control': 'no-store' },
	})
}

/** Invoke from an authenticated consumer-owned change hook, not from a draft save. */
export async function invalidateRedirectCache(
	client: RedirectRequestClient,
	options: RedirectSnapshotOptions,
	cache: RedirectCache,
): Promise<
	| { readonly ok: true }
	| { readonly ok: false; readonly reason: 'cache-failed' }
> {
	const context = await cacheContext(client, captureRedirectPolicy(options))
	try {
		const key = adapterKey(cache, context)
		if (key !== null) await cache.invalidate(key)
		return { ok: true }
	} catch {
		return { ok: false, reason: 'cache-failed' }
	}
}
