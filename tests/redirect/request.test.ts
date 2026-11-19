import { createClient } from '@sanity/client'
import { build } from 'esbuild'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	invalidateRedirectCache,
	redirectResponse,
	resolveRedirectRequest,
	type RedirectCache,
	type RedirectCacheEntry,
	type RedirectRequestOptions,
} from '../../src/redirect/request.js'
import { redirectQuery } from './query-fixture.js'

const options: RedirectRequestOptions = {
	preview: false,
	destinations: ['/new'],
}
const rule = {
	_id: 'rule',
	_type: 'sanityKitRedirect',
	enabled: true,
	source: '/old',
	destination: '/new',
	status: 301,
}
const wire = { ...rule, destinationIsRedirect: false }
const request = (path = '/old', init?: RequestInit) =>
	new Request(`https://app.example${path}`, init)
function setup() {
	const scope = { projectId: 'project123', dataset: 'test' }
	let rows: unknown[] = [{ ...rule }]
	const fetch = vi.fn(
		(query: string, params: Record<string, unknown>): Promise<unknown> =>
			redirectQuery(query, params, rows),
	)
	const client = { config: () => scope, withConfig: vi.fn(() => ({ fetch })) }
	const entries = new Map<string, unknown>()
	// Reference semantics: freshness follows successful validation, not refresh time.
	// Namespace generations prevent pre-invalidation loads from being stored later.
	const generations = new Map<string, number>()
	const cache: RedirectCache = {
		getOrLoad: vi.fn<RedirectCache['getOrLoad']>(async (key, load, context) => {
			const generation = generations.get(context.namespace) ?? 0
			const prior = entries.get(key) as RedirectCacheEntry | undefined
			if (prior && Date.now() - prior.validatedAt < context.freshForMs)
				return prior
			const value = await load(prior)
			if ((generations.get(context.namespace) ?? 0) === generation)
				entries.set(key, value)
			return value
		}),
		invalidate: vi.fn<RedirectCache['invalidate']>((namespace) => {
			generations.set(namespace, (generations.get(namespace) ?? 0) + 1)
			for (const key of entries.keys())
				if (key.startsWith(`${namespace}.`)) entries.delete(key)
			return Promise.resolve()
		}),
	}
	return {
		scope,
		fetch,
		client,
		cache,
		entries,
		setRows: (value: unknown[]) => {
			rows = value
		},
	}
}
afterEach(() => vi.useRealTimers())

describe('request-specific published redirects', () => {
	it.each(['GET', 'HEAD'])(
		'resolves %s with bounded exact-source and dependency reads',
		async (method) => {
			const t = setup()
			const result = await resolveRedirectRequest(
				t.client,
				request('/old?token=private', { method }),
				options,
			)
			expect(result).toEqual({
				kind: 'redirect',
				location: '/new',
				status: 301,
			})
			expect(t.fetch).toHaveBeenCalledOnce()
			expect(t.fetch.mock.calls[0]![0]).toContain('source == $pathname][0...2]')
			expect(t.fetch.mock.calls[0]![1]).toEqual({ pathname: '/old' })
			expect(t.client.withConfig).toHaveBeenCalledWith(
				expect.objectContaining({
					perspective: 'published',
					useCdn: false,
					stega: false,
				}),
			)
			const response = redirectResponse(result)!
			expect(response.status).toBe(301)
			expect(response.headers.get('location')).toBe('/new')
			expect(response.headers.get('cache-control')).toBe('no-store')
			expect(await response.text()).toBe('')
		},
	)
	it.each(['/OLD', '/old.data', '/old/child', '/missing'])(
		'keeps %s distinct and caches a genuine miss',
		async (path) => {
			const t = setup()
			const config = { ...options, cache: t.cache }
			expect(
				await resolveRedirectRequest(t.client, request(path), config),
			).toEqual({ kind: 'none' })
			expect(
				await resolveRedirectRequest(t.client, request(path), config),
			).toEqual({ kind: 'none' })
			expect(t.fetch).toHaveBeenCalledOnce()
		},
	)
	it('ignores unrelated malformed rules and more than 1,000 unrelated records', async () => {
		const t = setup()
		t.setRows([
			rule,
			...Array.from({ length: 1200 }, (_, i) => ({
				...rule,
				_id: `r${i}`,
				source: `/other-${i}`,
				destination: 'bad',
			})),
		])
		expect(
			await resolveRedirectRequest(t.client, request(), options),
		).toMatchObject({ kind: 'redirect' })
	})
	it.each([
		{ extra: { ...rule, _id: 'duplicate' }, reason: 'duplicate-source' },
		{
			extra: { ...rule, _id: 'target', source: '/new', destination: '/final' },
			reason: 'redirect-chain',
		},
		{
			extra: { ...rule, _id: 'cycle', source: '/new', destination: '/old' },
			reason: 'redirect-chain',
		},
	])('refuses $reason affecting this request', async ({ extra, reason }) => {
		const t = setup()
		t.setRows([rule, extra])
		expect(
			await resolveRedirectRequest(t.client, request(), options),
		).toMatchObject({ kind: 'error', snapshotReason: reason })
	})
	it.each([
		{
			patch: { destination: 'https://evil.example' },
			reason: 'invalid-destination',
		},
		{ patch: { destination: '/old' }, reason: 'self-redirect' },
		{ patch: { status: 307 }, reason: 'unsupported-status' },
		{ patch: { enabled: 'yes' }, reason: 'invalid-record' },
	])('rejects matching malformed data: $reason', async ({ patch, reason }) => {
		const t = setup()
		t.setRows([{ ...rule, ...patch }])
		expect(
			await resolveRedirectRequest(t.client, request(), options),
		).toMatchObject({ kind: 'error', snapshotReason: reason })
	})
	it.each([
		{ config: { occupiedPaths: ['/old'] }, reason: 'occupied-source' },
		{ config: { destinations: ['/other'] }, reason: 'unknown-destination' },
	])('checks supplied $reason policy', async ({ config, reason }) => {
		const t = setup()
		expect(
			await resolveRedirectRequest(t.client, request(), {
				...options,
				...config,
			}),
		).toMatchObject({ kind: 'error', snapshotReason: reason })
	})
	it('ignores disabled, draft and release rules, including destination history', async () => {
		const t = setup()
		t.setRows([
			rule,
			{ ...rule, _id: 'drafts.other' },
			{ ...rule, _id: 'versions.release.other' },
			{ ...rule, _id: 'disabled', source: '/new', enabled: false },
		])
		expect(
			await resolveRedirectRequest(t.client, request(), options),
		).toMatchObject({ kind: 'redirect' })
		t.setRows([{ ...rule, enabled: false }])
		expect(await resolveRedirectRequest(t.client, request(), options)).toEqual({
			kind: 'none',
		})
	})
	it('supports exact long source and destination-dependency paths', async () => {
		const t = setup()
		const long = '/' + 'a'.repeat(1100)
		t.setRows([{ ...rule, source: long }])
		expect(
			await resolveRedirectRequest(t.client, request(long), options),
		).toMatchObject({ kind: 'redirect' })
		t.setRows([
			{ ...rule, destination: long },
			{ ...rule, _id: 'target', source: long },
		])
		expect(
			await resolveRedirectRequest(t.client, request(), {
				...options,
				destinations: 'unverified',
			}),
		).toMatchObject({ kind: 'error', snapshotReason: 'redirect-chain' })
	})
	it.each([
		{ path: '/old', init: { method: 'POST' }, config: {}, reason: 'method' },
		{ path: '/old', config: { preview: true }, reason: 'preview' },
		{
			path: '/account/me',
			config: { reservedPathPrefixes: ['/account'] },
			reason: 'reserved-path',
		},
		{
			path: '/old',
			config: { reservedPaths: ['/old'] },
			reason: 'reserved-path',
		},
	])('bypasses $reason without IO', async ({ path, init, config, reason }) => {
		const t = setup()
		expect(
			await resolveRedirectRequest(t.client, request(path, init), {
				...options,
				cache: t.cache,
				...config,
			}),
		).toEqual({ kind: 'bypass', reason })
		expect(t.fetch).not.toHaveBeenCalled()
		expect(t.cache.getOrLoad).not.toHaveBeenCalled()
	})
	it.each(['/old/', '/old//child', '/old%2fchild'])(
		'rejects noncanonical %s before IO',
		async (path) => {
			const t = setup()
			expect(
				await resolveRedirectRequest(t.client, request(path), options),
			).toEqual({ kind: 'invalid-path' })
			expect(t.fetch).not.toHaveBeenCalled()
		},
	)
	it('adds allowlisted query parameters after cache lookup and never leaks them across callers', async () => {
		const t = setup()
		const config = {
			...options,
			cache: t.cache,
			queryParameterAllowlist: ['lang'],
		}
		for (const lang of ['en', 'fr'])
			expect(
				await resolveRedirectRequest(
					t.client,
					request(`/old?lang=${lang}&token=private`),
					config,
				),
			).toMatchObject({ location: `/new?lang=${lang}` })
		expect(t.fetch).toHaveBeenCalledOnce()
		expect(JSON.stringify([...t.entries])).not.toContain('private')
	})
	it.each([
		'token',
		'AUTH',
		'sanity-preview-secret',
		'session',
		'code',
		'state',
		'api_key',
		'x signature',
	])('rejects unsafe query name %s', async (name) => {
		const t = setup()
		await expect(
			resolveRedirectRequest(t.client, request(), {
				...options,
				queryParameterAllowlist: [name],
			}),
		).rejects.toThrow('non-sensitive')
		expect(t.fetch).not.toHaveBeenCalled()
	})
	it('preserves the SDK client settings and uses a real published transport', async () => {
		const client = createClient({
			projectId: 'project123',
			dataset: 'test',
			apiVersion: '2025-01-01',
			perspective: 'drafts',
			useCdn: true,
			requestHandler: () => Promise.resolve({ result: [wire] }),
		})
		const before = client.config()
		expect(
			await resolveRedirectRequest(client, request(), options),
		).toMatchObject({ kind: 'redirect' })
		expect(client.config()).toEqual(before)
	})
})

describe('failure policy and diagnostics', () => {
	it('keeps errors distinct from misses, continues by default and offers strict 503', async () => {
		const t = setup()
		const onDiagnostic = vi.fn()
		t.fetch.mockRejectedValue(new Error('private credentials'))
		const result = await resolveRedirectRequest(t.client, request(), {
			...options,
			onDiagnostic,
		})
		expect(result).toEqual({ kind: 'error', reason: 'request-failed' })
		expect(redirectResponse(result)).toBeUndefined()
		const strict = redirectResponse(result, 'strict')!
		expect(strict.status).toBe(503)
		expect(strict.headers.get('cache-control')).toBe('no-store')
		expect(await strict.text()).not.toContain('private')
		expect(onDiagnostic).toHaveBeenCalledWith({
			pathname: '/old',
			reason: 'request-failed',
			fallback: 'application',
		})
	})
	it('reports malformed matching rules with document identity without caching them', async () => {
		const t = setup()
		t.setRows([{ ...rule, destination: '/old' }])
		const onDiagnostic = vi.fn()
		await resolveRedirectRequest(t.client, request(), {
			...options,
			cache: t.cache,
			onDiagnostic,
		})
		expect(t.entries.size).toBe(0)
		expect(onDiagnostic).toHaveBeenCalledWith(
			expect.objectContaining({
				pathname: '/old',
				snapshotReason: 'self-redirect',
				recordId: 'rule',
			}),
		)
	})
	it.each([
		() => {
			throw new Error('diagnostic handler')
		},
		() => Promise.reject(new Error('diagnostic handler')),
	])('isolates diagnostic failures', async (onDiagnostic) => {
		const t = setup()
		t.fetch.mockRejectedValue(new Error('offline'))
		expect(
			await resolveRedirectRequest(t.client, request(), {
				...options,
				onDiagnostic,
			}),
		).toMatchObject({ kind: 'error' })
	})
	it.each([
		null,
		{},
		[wire, wire, wire],
		[{ ...wire, destinationIsRedirect: undefined }],
		[{ ...wire, source: '/wrong' }],
	])('rejects incomplete or unexpected responses', async (value) => {
		const t = setup()
		t.fetch.mockResolvedValue(value)
		expect(
			await resolveRedirectRequest(t.client, request(), options),
		).toMatchObject({ kind: 'error', reason: 'invalid-response' })
	})
})

describe('pathname cache and bounded outage fallback', () => {
	it('isolates pathnames and invalidates the whole namespace', async () => {
		const t = setup()
		const config = { ...options, cache: t.cache }
		await resolveRedirectRequest(t.client, request(), config)
		await resolveRedirectRequest(t.client, request('/missing'), config)
		expect(t.entries.size).toBe(2)
		expect([...t.entries.values()][0]).toMatchObject({
			pathname: '/old',
			data: [wire],
		})
		expect(JSON.parse(JSON.stringify([...t.entries.values()]))).toEqual([
			...t.entries.values(),
		])
		expect(await invalidateRedirectCache(t.client, options, t.cache)).toEqual({
			ok: true,
		})
		expect(t.entries.size).toBe(0)
	})
	it('refreshes after 60 seconds, serves a last good match only until 5 minutes total, and does not renew its age', async () => {
		vi.useFakeTimers()
		vi.setSystemTime(1_000_000)
		const t = setup()
		const config = { ...options, cache: t.cache }
		const onDiagnostic = vi.fn()
		await resolveRedirectRequest(t.client, request(), config)
		vi.setSystemTime(1_059_999)
		await resolveRedirectRequest(t.client, request(), config)
		expect(t.fetch).toHaveBeenCalledOnce()
		t.fetch.mockRejectedValue(new Error('offline'))
		for (const time of [1_060_000, 1_240_000, 1_299_999]) {
			vi.setSystemTime(time)
			expect(
				await resolveRedirectRequest(t.client, request(), {
					...config,
					onDiagnostic,
				}),
			).toMatchObject({ kind: 'redirect' })
			expect([...t.entries.values()][0]).toMatchObject({
				validatedAt: 1_000_000,
			})
		}
		expect(onDiagnostic).toHaveBeenCalledWith(
			expect.objectContaining({ fallback: 'stale' }),
		)
		vi.setSystemTime(1_300_000)
		expect(await resolveRedirectRequest(t.client, request(), config)).toEqual({
			kind: 'error',
			reason: 'request-failed',
		})
	})
	it('does not extend fallback age while waiting for a slow cache write', async () => {
		vi.useFakeTimers()
		vi.setSystemTime(1000)
		const t = setup()
		const config = { ...options, cache: t.cache }
		await resolveRedirectRequest(t.client, request(), config)
		const prior = [...t.entries.values()][0]
		vi.setSystemTime(61_000)
		t.fetch.mockRejectedValue(new Error('offline'))
		t.cache.getOrLoad = async (_key, load) => {
			const value = await load(prior)
			vi.setSystemTime(301_000)
			return value
		}
		expect(await resolveRedirectRequest(t.client, request(), config)).toEqual({
			kind: 'error',
			reason: 'request-failed',
		})
	})

	it('does not use a stale miss to conceal a failed read', async () => {
		vi.useFakeTimers()
		vi.setSystemTime(1000)
		const t = setup()
		const config = { ...options, cache: t.cache }
		await resolveRedirectRequest(t.client, request('/missing'), config)
		vi.setSystemTime(61_000)
		t.fetch.mockRejectedValue(new Error('offline'))
		expect(
			await resolveRedirectRequest(t.client, request('/missing'), config),
		).toEqual({ kind: 'error', reason: 'request-failed' })
	})
	it.each(['retired', 'deleted', 'invalid', 'incomplete', 'invalidated'])(
		'never resurrects a rule after it was %s',
		async (state) => {
			vi.useFakeTimers()
			vi.setSystemTime(1000)
			const t = setup()
			const config = { ...options, cache: t.cache }
			await resolveRedirectRequest(t.client, request(), config)
			vi.setSystemTime(61_000)
			if (state === 'invalidated')
				await invalidateRedirectCache(t.client, options, t.cache)
			else {
				t.setRows(
					state === 'retired'
						? [{ ...rule, enabled: false }]
						: state === 'invalid'
							? [{ ...rule, destination: '/old' }]
							: [],
				)
				if (state === 'incomplete') t.fetch.mockResolvedValueOnce(null)
				await resolveRedirectRequest(t.client, request(), config)
			}
			vi.setSystemTime(121_000)
			t.fetch.mockRejectedValue(new Error('offline'))
			expect(
				await resolveRedirectRequest(t.client, request(), config),
			).toMatchObject({ kind: 'error', reason: 'request-failed' })
		},
	)
	it('falls back to Sanity on failed or corrupt cache access and diagnoses it', async () => {
		const t = setup()
		const onDiagnostic = vi.fn()
		t.cache.getOrLoad = () => Promise.reject(new Error('offline'))
		expect(
			await resolveRedirectRequest(t.client, request(), {
				...options,
				cache: t.cache,
				onDiagnostic,
			}),
		).toMatchObject({ kind: 'redirect' })
		expect(onDiagnostic).toHaveBeenCalledWith(
			expect.objectContaining({ reason: 'cache-failed', fallback: 'origin' }),
		)
		t.cache.getOrLoad = () => Promise.resolve({ namespace: 'wrong', data: [] })
		expect(
			await resolveRedirectRequest(t.client, request(), {
				...options,
				cache: t.cache,
				onDiagnostic,
			}),
		).toMatchObject({ kind: 'redirect' })
		expect(onDiagnostic).toHaveBeenCalledWith(
			expect.objectContaining({ reason: 'invalid-cache' }),
		)
	})
	it('retains a successful origin result when only the cache write fails', async () => {
		const t = setup()
		t.cache.getOrLoad = async (_key, load) => {
			await load()
			throw new Error('write failed')
		}
		expect(
			await resolveRedirectRequest(t.client, request(), {
				...options,
				cache: t.cache,
			}),
		).toMatchObject({ kind: 'redirect' })
		expect(t.fetch).toHaveBeenCalledOnce()
	})
	it('enforces age and revalidates data even for adapters that return stale or forged hits', async () => {
		vi.useFakeTimers()
		vi.setSystemTime(1000)
		const t = setup()
		const config = { ...options, cache: t.cache }
		await resolveRedirectRequest(t.client, request(), config)
		const prior = [...t.entries.values()][0]
		t.cache.getOrLoad = () => Promise.resolve(prior)
		vi.setSystemTime(61_000)
		t.fetch.mockRejectedValue(new Error('offline'))
		expect(
			await resolveRedirectRequest(t.client, request(), config),
		).toMatchObject({ kind: 'redirect' })
		vi.setSystemTime(301_000)
		expect(
			await resolveRedirectRequest(t.client, request(), config),
		).toMatchObject({ kind: 'error' })
	})
	it('isolates tenant, policy and custom partitions; captures the tenant before a custom hook mutates it', async () => {
		const t = setup()
		const config = { ...options, cache: t.cache }
		await resolveRedirectRequest(t.client, request(), config)
		t.scope.dataset = 'other'
		await resolveRedirectRequest(t.client, request(), config)
		t.scope.projectId = 'other123'
		await resolveRedirectRequest(t.client, request(), config)
		await resolveRedirectRequest(t.client, request(), {
			...config,
			reservedPaths: ['/api'],
		})
		t.cache.key = () => 'partition'
		await resolveRedirectRequest(t.client, request(), config)
		expect(t.entries.size).toBe(5)
		t.cache.key = () => {
			t.scope.dataset = 'mutated'
			return 'second'
		}
		await resolveRedirectRequest(t.client, request(), config)
		expect(t.client.withConfig).toHaveBeenLastCalledWith(
			expect.objectContaining({ dataset: 'other' }),
		)
	})
	it('uses deterministic policy identity and permits an explicit cache bypass', async () => {
		const t = setup()
		for (const reservedPaths of [
			['/a', '/b', '/a'],
			['/b', '/a'],
		])
			await resolveRedirectRequest(t.client, request(), {
				...options,
				cache: t.cache,
				reservedPaths,
			})
		expect(t.fetch).toHaveBeenCalledOnce()
		t.cache.key = () => null
		await resolveRedirectRequest(t.client, request(), {
			...options,
			cache: t.cache,
		})
		expect(t.fetch).toHaveBeenCalledTimes(2)
	})
	it('fences in-flight loads across namespace invalidation', async () => {
		const t = setup()
		const pending = Promise.withResolvers<unknown>()
		t.fetch.mockReturnValueOnce(pending.promise)
		const config = {
			...options,
			destinations: 'unverified' as const,
			cache: t.cache,
		}
		const old = resolveRedirectRequest(t.client, request(), config)
		await vi.waitFor(() => expect(t.fetch).toHaveBeenCalledOnce())
		await invalidateRedirectCache(t.client, options, t.cache) // different policy: must not clear this namespace
		await invalidateRedirectCache(t.client, config, t.cache)
		t.setRows([{ ...rule, destination: '/changed' }])
		expect(
			await resolveRedirectRequest(t.client, request(), config),
		).toMatchObject({ location: '/changed' })
		pending.resolve([wire])
		await old
		expect(
			await resolveRedirectRequest(t.client, request(), config),
		).toMatchObject({ location: '/changed' })
	})
	it('ignores an old entry if an adapter swallows an authoritative invalid-data failure', async () => {
		vi.useFakeTimers()
		vi.setSystemTime(1000)
		const t = setup()
		const config = { ...options, cache: t.cache }
		await resolveRedirectRequest(t.client, request(), config)
		const prior = [...t.entries.values()][0]
		vi.setSystemTime(61_000)
		t.setRows([{ ...rule, destination: '/old' }])
		t.cache.getOrLoad = async (_key, load) => {
			try {
				return await load(prior)
			} catch {
				return prior
			}
		}
		expect(
			await resolveRedirectRequest(t.client, request(), config),
		).toMatchObject({ kind: 'error', snapshotReason: 'self-redirect' })
	})
	it('clears an old rule when a confirmed miss cannot be saved to the cache', async () => {
		vi.useFakeTimers()
		vi.setSystemTime(1000)
		const t = setup()
		const config = { ...options, cache: t.cache }
		await resolveRedirectRequest(t.client, request(), config)
		const prior = [...t.entries.values()][0]
		vi.setSystemTime(61_000)
		t.setRows([])
		t.cache.getOrLoad = async (_key, load) => {
			await load(prior)
			throw new Error('write failed')
		}
		expect(await resolveRedirectRequest(t.client, request(), config)).toEqual({
			kind: 'none',
		})
		expect(t.entries.size).toBe(0)
	})
	it('does not use a retained entry from another namespace as outage fallback', async () => {
		const t = setup()
		const config = { ...options, cache: t.cache }
		await resolveRedirectRequest(t.client, request(), config)
		const prior = [...t.entries.values()][0]
		t.scope.dataset = 'another'
		t.cache.getOrLoad = (_key, load) => load(prior)
		t.fetch.mockRejectedValue(new Error('offline'))
		expect(await resolveRedirectRequest(t.client, request(), config)).toEqual({
			kind: 'error',
			reason: 'request-failed',
		})
	})

	it('reports failed invalidation explicitly', async () => {
		const t = setup()
		t.cache.invalidate = () => Promise.reject(new Error('offline'))
		expect(await invalidateRedirectCache(t.client, options, t.cache)).toEqual({
			ok: false,
			reason: 'cache-failed',
		})
	})
	it.each([
		{ freshForMs: -1 },
		{ freshForMs: 100, maxAgeMs: 99 },
		{ maxAgeMs: Infinity },
	])('rejects invalid age configuration', async (config) => {
		const t = setup()
		await expect(
			resolveRedirectRequest(t.client, request(), { ...options, ...config }),
		).rejects.toThrow('ages')
		expect(t.fetch).not.toHaveBeenCalled()
	})
})

describe('cancellation and safe HTTP boundary', () => {
	it('does no IO when already aborted and stops waiting for uncancellable work', async () => {
		const t = setup()
		const controller = new AbortController()
		controller.abort()
		expect(
			await resolveRedirectRequest(
				t.client,
				request('/old', { signal: controller.signal }),
				options,
			),
		).toEqual({ kind: 'error', reason: 'aborted' })
		expect(t.fetch).not.toHaveBeenCalled()
		const next = new AbortController()
		const pending = Promise.withResolvers<unknown>()
		t.fetch.mockReturnValue(pending.promise)
		const operation = resolveRedirectRequest(
			t.client,
			request('/old', { signal: next.signal }),
			options,
		)
		next.abort()
		expect(await operation).toEqual({ kind: 'error', reason: 'aborted' })
		pending.resolve([wire])
	})
	it('does not let a cancelled waiter cancel a shared cache refresh', async () => {
		const t = setup()
		let shared: Promise<unknown> | undefined
		t.cache.getOrLoad = (_key, load) => (shared ??= load())
		const pending = Promise.withResolvers<unknown>()
		t.fetch.mockReturnValue(pending.promise)
		const controller = new AbortController()
		const config = { ...options, cache: t.cache }
		const first = resolveRedirectRequest(
			t.client,
			request('/old', { signal: controller.signal }),
			config,
		)
		const second = resolveRedirectRequest(t.client, request(), config)
		await vi.waitFor(() => expect(t.fetch).toHaveBeenCalledOnce())
		controller.abort()
		expect(await first).toEqual({ kind: 'error', reason: 'aborted' })
		pending.resolve([wire])
		expect(await second).toMatchObject({ kind: 'redirect' })
	})
	it.each([
		'https://evil.example',
		'//evil.example',
		'/old#fragment',
		'/old\\path',
		'/old\nLocation: evil',
	])('rejects unsafe HTTP Location %s', (location) => {
		expect(() =>
			redirectResponse({ kind: 'redirect', location, status: 301 }),
		).toThrow('Unsafe')
	})
	it('keeps temporary status, invalid path and cancellation behavior explicit', () => {
		expect(
			redirectResponse({ kind: 'redirect', location: '/new', status: 302 })!
				.status,
		).toBe(302)
		expect(redirectResponse({ kind: 'invalid-path' })!.status).toBe(400)
		expect(
			redirectResponse({ kind: 'error', reason: 'aborted' }, 'strict'),
		).toBeUndefined()
	})
	it('keeps Studio, router and cache SDKs outside the generic dependency graph', async () => {
		const output = await build({
			entryPoints: ['src/redirect/request.ts'],
			bundle: true,
			write: false,
			platform: 'browser',
			format: 'esm',
			metafile: true,
		})
		for (const path of Object.keys(output.metafile.inputs)) {
			expect(path).not.toMatch(/src\/(?:studio|react-router)\//u)
			expect(path).not.toMatch(
				/node_modules\/(?:sanity|react|react-router|@sanity\/ui|cloudflare)\//u,
			)
		}
	})
})
