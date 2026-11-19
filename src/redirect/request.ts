/**
 * Request-specific redirects and failure handling. Studio publication retains
 * separate global checks. See docs/redirects.md for the consumer cache contract.
 * This is plain HTTP handling, not a React Router data-request adapter.
 */
import type { ClientConfig } from '@sanity/client'
import {
	captureRedirectPolicy,
	REDIRECT_API_VERSION,
	type RedirectReadClient,
} from './load.js'
import {
	loadRedirectLookup,
	validateLookup,
	type LookupFailure,
} from './lookup.js'
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
	readonly queryVersion: 2
	/** SHA-256 identity covers all fields above and the captured validation policy. */
	readonly key: string
}

export interface RedirectCacheLoadOptions {
	/** Invalidation removes every pathname in this namespace, including in-flight loads. */
	readonly namespace: string
	readonly freshForMs: number
	/** Maximum total age from successful validation, including outage fallback. */
	readonly maxAgeMs: number
}

export interface RedirectCache {
	/** Optional partition/bypass hook. Returning null skips this adapter entirely. */
	key?(context: RedirectCacheContext): string | null
	/**
	 * Return a fresh entry or run load(previous) with the retained previous entry.
	 * Deduplicate by key. Store successful returns only. Use validatedAt, never
	 * the time a fallback is returned, to calculate age. Refresh is independent
	 * of any one waiting request's cancellation. See the adapter example in docs.
	 */
	getOrLoad: (
		key: string,
		load: (previous?: unknown) => Promise<RedirectCacheEntry>,
		options: RedirectCacheLoadOptions,
	) => Promise<unknown>
	/** Fence older loads and clear ALL pathname entries in this namespace. */
	invalidate: (namespace: string) => Promise<void>
}

/** JSON only; data is revalidated on every hit. Never store an error as a miss. */
export interface RedirectCacheEntry {
	readonly namespace: string
	readonly pathname: string
	readonly validatedAt: number
	readonly data: unknown
}

export interface RedirectDiagnostic {
	readonly pathname: string
	readonly reason: LookupFailure['reason'] | 'cache-failed' | 'invalid-cache'
	readonly snapshotReason?: RedirectSnapshotReason
	readonly recordId?: string
	/** 'application' leaves the caller to apply its continue/strict response policy. */
	readonly fallback: 'origin' | 'stale' | 'application'
}

export type RedirectFailurePolicy = 'continue' | 'strict'

export interface RedirectRequestOptions extends RedirectSnapshotOptions {
	/** Trusted app preview/session decision; never inferred from a URL parameter. */
	readonly preview: boolean
	readonly cache?: RedirectCache
	/** Defaults: fresh for 60 seconds, last good match usable for 5 minutes total. */
	readonly freshForMs?: number
	readonly maxAgeMs?: number
	/** Operational diagnostics only; thrown/rejected handlers never affect routing. */
	readonly onDiagnostic?: (
		diagnostic: RedirectDiagnostic,
	) => void | Promise<void>
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
		queryVersion: 2 as const,
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
	return Object.freeze({ ...fields, key: `sanity-kit.redirects.v2.${digest}` })
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

class OriginFailure extends Error {
	constructor(readonly result: LookupFailure) {
		super(result.reason)
	}
}

function lifetime(options: RedirectRequestOptions) {
	const freshForMs = options.freshForMs ?? 60_000
	const maxAgeMs = options.maxAgeMs ?? 300_000
	if (
		![freshForMs, maxAgeMs].every(
			(value) => Number.isSafeInteger(value) && value >= 0,
		) ||
		maxAgeMs < freshForMs
	)
		throw new Error(
			'Redirect cache ages must be nonnegative safe integers; maxAgeMs must be at least freshForMs',
		)
	return { freshForMs, maxAgeMs }
}

function cachedEntry(
	value: unknown,
	namespace: string,
	pathname: string,
	policy: RedirectSnapshotOptions,
): RedirectCacheEntry | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		return undefined
	const entry = value as RedirectCacheEntry
	if (
		Object.keys(entry).length !== 4 ||
		!['namespace', 'pathname', 'validatedAt', 'data'].every((key) =>
			Object.hasOwn(entry, key),
		) ||
		entry.namespace !== namespace ||
		entry.pathname !== pathname ||
		!Number.isSafeInteger(entry.validatedAt) ||
		entry.validatedAt < 0 ||
		entry.validatedAt > Date.now() ||
		validateLookup(entry.data, pathname, policy).kind === 'error'
	)
		return undefined
	return entry
}

function diagnose(
	options: RedirectRequestOptions,
	diagnostic: RedirectDiagnostic,
) {
	try {
		void Promise.resolve(
			options.onDiagnostic?.(Object.freeze(diagnostic)),
		).catch(() => undefined)
	} catch {
		/* Diagnostics must not change routing. */
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
	const ages = lifetime(options)
	const { cache } = options
	const pathname = url.pathname
	let namespace: string | null = null
	let context: RedirectCacheContext | undefined
	let result: Awaited<ReturnType<typeof loadRedirectLookup>> | undefined
	let entry: RedirectCacheEntry | undefined
	let loadedEntry: RedirectCacheEntry | undefined
	const report = ({
		reason,
		snapshotReason,
		recordId,
		fallback,
	}: Omit<RedirectDiagnostic, 'pathname'>) =>
		diagnose(options, {
			pathname,
			reason,
			fallback,
			...(snapshotReason ? { snapshotReason } : {}),
			...(recordId ? { recordId } : {}),
		})
	// Capture the cache tenant before awaiting a consumer's partition hook.
	if (cache) {
		context = await cacheContext(client, policy)
		try {
			namespace = adapterKey(cache, context)
		} catch {
			report({ reason: 'cache-failed', fallback: 'origin' })
		}
	}
	const readClient = context
		? {
				withConfig: (config: Parameters<RedirectReadClient['withConfig']>[0]) =>
					client.withConfig({
						...config,
						projectId: context.projectId,
						dataset: context.dataset,
					}),
			}
		: client
	let attemptedOrigin = false
	const load = async (previous?: unknown): Promise<RedirectCacheEntry> => {
		attemptedOrigin = true
		const loaded = await loadRedirectLookup(
			readClient,
			pathname,
			policy,
			namespace === null ? request.signal : undefined,
		)
		result = loaded
		if (loaded.result.kind === 'error') {
			const prior =
				namespace === null
					? undefined
					: cachedEntry(previous, namespace, pathname, policy)
			if (
				loaded.result.reason === 'request-failed' &&
				prior &&
				Date.now() - prior.validatedAt < ages.maxAgeMs &&
				validateLookup(prior.data, pathname, policy).kind === 'redirect'
			) {
				report({ ...loaded.result, fallback: 'stale' })
				loadedEntry = prior
				return prior
			}
			// An authoritative bad response supersedes old entries. Never resurrect
			// a previously valid rule on a later outage after this known failure.
			if (
				loaded.result.reason !== 'request-failed' &&
				loaded.result.reason !== 'aborted' &&
				cache &&
				namespace !== null
			) {
				try {
					await cache.invalidate(namespace)
				} catch {
					report({ reason: 'cache-failed', fallback: 'application' })
				}
			}
			throw new OriginFailure(loaded.result)
		}
		loadedEntry = {
			namespace: namespace ?? '',
			pathname,
			validatedAt: Date.now(),
			data: loaded.rows,
		}
		return loadedEntry
	}
	const operation = async () => {
		if (cache && namespace !== null) {
			try {
				const pathHash = await crypto.subtle.digest(
					'SHA-256',
					new TextEncoder().encode(pathname),
				)
				const digest = [...new Uint8Array(pathHash)]
					.map((value) => value.toString(16).padStart(2, '0'))
					.join('')
				const raw = await cache.getOrLoad(`${namespace}.${digest}`, load, {
					namespace,
					...ages,
				})
				// A backend must not hide an authoritative rejection by returning its
				// previous hit after load() throws. Prefer the result just checked.
				if (result?.result.kind === 'error' && !loadedEntry)
					return result.result
				entry = cachedEntry(raw, namespace, pathname, policy)
				if (!entry) report({ reason: 'invalid-cache', fallback: 'origin' })
				if (loadedEntry) entry = loadedEntry
				// Enforce freshness even if an adapter mistakenly returns an expired hit.
				if (
					entry &&
					Date.now() - entry.validatedAt >= ages.freshForMs &&
					!attemptedOrigin
				)
					entry = await load(entry)
				if (entry) return validateLookup(entry.data, pathname, policy)
			} catch (error) {
				if (error instanceof OriginFailure) return error.result
				report({ reason: 'cache-failed', fallback: 'origin' })
				if (result && namespace !== null) {
					// A failed cache write must not leave an older match available for
					// outage fallback after an authoritative miss or correction.
					try {
						await cache.invalidate(namespace)
					} catch {
						report({ reason: 'cache-failed', fallback: 'origin' })
					}
				}
				// A successful read still counts if only the cache write failed.
				if (loadedEntry)
					return validateLookup(loadedEntry.data, pathname, policy)
				if (result) return result.result
			}
		}
		try {
			entry = await load()
			return validateLookup(entry.data, pathname, policy)
		} catch (error) {
			if (error instanceof OriginFailure) return error.result
			throw error
		}
	}
	let match = await waitForRequest(operation(), request.signal)
	if (match === 'aborted' || request.signal.aborted)
		return { kind: 'error', reason: 'aborted' }
	// Cache write/read latency must not extend the permitted outage window.
	if (
		match.kind === 'redirect' &&
		result?.result.kind === 'error' &&
		loadedEntry &&
		Date.now() - loadedEntry.validatedAt >= ages.maxAgeMs
	)
		match = result.result
	if (match.kind === 'error') {
		if (match.reason !== 'aborted')
			report({ ...match, fallback: 'application' })
		return match
	}
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
 * Optional plain-HTTP conversion. Failures continue application routing by
 * default; strict mode returns a non-cacheable 503. Invalid paths return 400.
 * Framework adapters must use their own redirect/data-response conventions.
 */
export function redirectResponse(
	result: RedirectRequestResult,
	failurePolicy: RedirectFailurePolicy = 'continue',
): Response | undefined {
	if (failurePolicy !== 'continue' && failurePolicy !== 'strict')
		throw new Error('Invalid redirect failure policy')
	if (
		result.kind === 'error' &&
		(failurePolicy === 'continue' || result.reason === 'aborted')
	)
		return undefined
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
