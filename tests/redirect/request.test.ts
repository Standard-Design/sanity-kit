import { createClient } from '@sanity/client'
import { build } from 'esbuild'
import { describe, expect, it, vi } from 'vitest'
import {
	invalidateRedirectCache,
	redirectResponse,
	resolveRedirectRequest,
	type RedirectCache,
	type RedirectRequestOptions,
} from '../../src/redirect/request.js'
import { REDIRECT_MAX_RECORDS } from '../../src/redirect/snapshot.js'

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
function setup() {
	const scope = { projectId: 'project123', dataset: 'test' }
	const fetch = vi.fn((): Promise<unknown> => Promise.resolve([{ ...rule }]))
	const client = { config: () => scope, withConfig: vi.fn(() => ({ fetch })) }
	const entries = new Map<string, unknown>()
	const cache: RedirectCache = {
		getOrLoad: vi.fn(async (key: string, load: () => Promise<unknown>) => {
			if (!entries.has(key)) entries.set(key, await load())
			return entries.get(key)
		}),
		invalidate: vi.fn((key: string) => {
			entries.delete(key)
			return Promise.resolve()
		}),
	}
	return { scope, fetch, client, cache, entries }
}
const request = (url = '/old', init?: RequestInit) =>
	new Request(`https://app.example${url}`, init)

describe('private frontend redirect requests', () => {
	it.each(['GET', 'HEAD'])(
		'resolves %s with a non-cacheable empty HTTP response',
		async (method) => {
			const io = setup()
			const result = await resolveRedirectRequest(
				io.client,
				request('/old?token=secret#fragment', { method }),
				options,
			)
			expect(result).toEqual({
				kind: 'redirect',
				location: '/new',
				status: 301,
			})
			const response = redirectResponse(result)!
			expect(response.status).toBe(301)
			expect(response.headers.get('location')).toBe('/new')
			expect(response.headers.get('cache-control')).toBe('no-store')
			expect(await response.text()).toBe('')
		},
	)

	it.each([
		{ method: 'POST', reason: 'method' },
		{ method: 'PUT', reason: 'method' },
		{ method: 'DELETE', reason: 'method' },
		{ method: 'GET', preview: true, reason: 'preview' },
		{ method: 'HEAD', preview: true, reason: 'preview' },
	])(
		'bypasses $reason before any load or cache access',
		async ({ method, preview = false, reason }) => {
			const io = setup()
			const config = vi.spyOn(io.client, 'config')
			const result = await resolveRedirectRequest(
				io.client,
				request('/old', { method }),
				{ ...options, preview, cache: io.cache },
			)
			expect(result).toEqual({ kind: 'bypass', reason })
			expect(config).not.toHaveBeenCalled()
			expect(io.client.withConfig).not.toHaveBeenCalled()
			expect(io.cache.getOrLoad).not.toHaveBeenCalled()
			expect(redirectResponse(result)).toBeUndefined()
		},
	)

	it.each(['/old', '/account', '/account/profile'])(
		'bypasses reserved %s before cache access',
		async (path) => {
			const io = setup()
			const result = await resolveRedirectRequest(io.client, request(path), {
				...options,
				cache: io.cache,
				reservedPaths: ['/old'],
				reservedPathPrefixes: ['/account'],
			})
			expect(result).toEqual({ kind: 'bypass', reason: 'reserved-path' })
			expect(io.cache.getOrLoad).not.toHaveBeenCalled()
			expect(io.fetch).not.toHaveBeenCalled()
		},
	)

	it('preserves exact matching and does not reinterpret data endpoint paths', async () => {
		const io = setup()
		for (const path of ['/OLD', '/old.data', '/old/child', '/accounting'])
			expect(
				await resolveRedirectRequest(io.client, request(path), {
					...options,
					reservedPathPrefixes: ['/account'],
				}),
			).toEqual({ kind: 'none' })
		expect(redirectResponse({ kind: 'none' })).toBeUndefined()
	})

	it.each(['/old/', '/old//child', '/old%2fchild'])(
		'rejects noncanonical %s without fetching',
		async (path) => {
			const io = setup()
			expect(
				await resolveRedirectRequest(io.client, request(path), options),
			).toEqual({ kind: 'invalid-path' })
			expect(io.fetch).not.toHaveBeenCalled()
		},
	)

	it('copies only explicitly allowed query values using safe URL encoding', async () => {
		const io = setup()
		expect(
			await resolveRedirectRequest(
				io.client,
				request(
					'/old?utm_source=one&token=secret&utm_source=two&lang=en%0D%0ALocation%3Aevil&other=hidden',
				),
				{ ...options, queryParameterAllowlist: ['utm_source', 'lang'] },
			),
		).toEqual({
			kind: 'redirect',
			location:
				'/new?utm_source=one&utm_source=two&lang=en%0D%0ALocation%3Aevil',
			status: 301,
		})
	})

	it.each([
		'token',
		'access_token',
		'AUTH',
		'sanity-preview-secret',
		'session',
		'code',
		'state',
		'api_key',
		'cookie',
		'x signature',
	])('rejects sensitive or malformed query policy %s', async (name) => {
		const io = setup()
		await expect(
			resolveRedirectRequest(io.client, request(), {
				...options,
				queryParameterAllowlist: [name],
			}),
		).rejects.toThrow('non-sensitive')
		expect(io.fetch).not.toHaveBeenCalled()
	})

	it('returns explicit origin failures and safe HTTP service errors', async () => {
		const io = setup()
		io.fetch.mockRejectedValue(
			new Error('private token and diagnostic details'),
		)
		const result = await resolveRedirectRequest(io.client, request(), options)
		expect(result).toEqual({ kind: 'error', reason: 'request-failed' })
		const response = redirectResponse(result)!
		expect(response.status).toBe(503)
		expect(response.headers.get('cache-control')).toBe('no-store')
		expect(await response.text()).not.toContain('private token')
	})

	it('supports the real client and preserves its inherited draft/CDN settings', async () => {
		const io = setup()
		const client = createClient({
			projectId: 'project123',
			dataset: 'test',
			apiVersion: '2025-01-01',
			perspective: 'drafts',
			useCdn: true,
			requestHandler: () => Promise.resolve({ result: [rule] }),
		})
		const config = client.config()
		expect(
			await resolveRedirectRequest(client, request(), {
				...options,
				cache: io.cache,
			}),
		).toMatchObject({ kind: 'redirect', location: '/new' })
		expect(client.config()).toEqual(config)
	})

	it('keeps the runtime dependency graph free of Studio/framework/cache SDKs', async () => {
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

describe('plain HTTP response boundary', () => {
	it('keeps temporary redirects temporary', () => {
		const response = redirectResponse({
			kind: 'redirect',
			location: '/new',
			status: 302,
		})!
		expect(response.status).toBe(302)
		expect(response.headers.get('cache-control')).toBe('no-store')
	})
	it.each([
		'https://evil.example',
		'//evil.example',
		'/old#fragment',
		'/old\\path',
		'/old\nLocation: https://evil.example',
	])('rejects a forged unsafe location %s', (location) => {
		expect(() =>
			redirectResponse({ kind: 'redirect', location, status: 301 }),
		).toThrow('Unsafe')
	})
	it('keeps invalid-path errors non-cacheable', () => {
		const response = redirectResponse({ kind: 'invalid-path' })!
		expect(response.status).toBe(400)
		expect(response.headers.get('cache-control')).toBe('no-store')
	})
})

describe('consumer-owned redirect cache', () => {
	it('stores bounded JSON data, reuses a hit, and invalidates the same key', async () => {
		const io = setup()
		const config = { ...options, cache: io.cache }
		await resolveRedirectRequest(io.client, request(), config)
		const entry = [...io.entries.values()][0]
		expect(JSON.parse(JSON.stringify(entry))).toEqual(entry)
		expect(entry).toMatchObject({
			snapshot: { perspective: 'published', complete: true, records: [rule] },
		})
		await resolveRedirectRequest(io.client, request(), config)
		expect(io.fetch).toHaveBeenCalledTimes(1)
		expect(await invalidateRedirectCache(io.client, options, io.cache)).toEqual(
			{ ok: true },
		)
		expect(io.entries.size).toBe(0)
		await resolveRedirectRequest(io.client, request(), config)
		expect(io.fetch).toHaveBeenCalledTimes(2)
	})

	it('isolates project, dataset, and every validation policy even with identical custom keys', async () => {
		const io = setup()
		io.cache.key = () => 'shared'
		const base = { ...options, cache: io.cache }
		await resolveRedirectRequest(io.client, request(), base)
		io.scope.projectId = 'other123'
		await resolveRedirectRequest(io.client, request(), base)
		io.scope.dataset = 'other'
		await resolveRedirectRequest(io.client, request(), base)
		await resolveRedirectRequest(io.client, request(), {
			...base,
			destinations: 'unverified',
		})
		await resolveRedirectRequest(io.client, request(), {
			...base,
			reservedPaths: ['/api'],
		})
		await resolveRedirectRequest(io.client, request(), {
			...base,
			reservedPathPrefixes: ['/account'],
		})
		await resolveRedirectRequest(io.client, request(), {
			...base,
			occupiedPaths: ['/page'],
		})
		expect(io.entries.size).toBe(7)
		expect(io.fetch).toHaveBeenCalledTimes(7)
	})

	it('uses a deterministic identity for equivalent set-like policy lists', async () => {
		const io = setup()
		await resolveRedirectRequest(io.client, request(), {
			...options,
			cache: io.cache,
			reservedPaths: ['/a', '/b', '/a'],
		})
		await resolveRedirectRequest(io.client, request(), {
			...options,
			cache: io.cache,
			reservedPaths: ['/b', '/a'],
		})
		expect(io.fetch).toHaveBeenCalledTimes(1)
	})

	it('rejects a cache entry returned under the wrong scope instead of fetching a fallback', async () => {
		const io = setup()
		await resolveRedirectRequest(io.client, request(), {
			...options,
			cache: io.cache,
		})
		const entry = [...io.entries.values()][0]
		io.scope.dataset = 'another'
		io.cache.getOrLoad = vi.fn(() => Promise.resolve(entry))
		expect(
			await resolveRedirectRequest(io.client, request(), {
				...options,
				cache: io.cache,
			}),
		).toEqual({ kind: 'error', reason: 'invalid-cache' })
		expect(io.fetch).toHaveBeenCalledTimes(1)
	})

	it.each([
		{ snapshot: undefined },
		{ snapshot: { perspective: 'drafts', complete: true, records: [rule] } },
		{
			snapshot: {
				perspective: 'published',
				complete: true,
				records: [{ ...rule, destination: 'https://evil.example' }],
			},
		},
		{
			snapshot: {
				perspective: 'published',
				complete: true,
				records: Array.from({ length: REDIRECT_MAX_RECORDS + 1 }, () => rule),
			},
		},
	])('revalidates corrupt storage on every hit', async (replacement) => {
		const io = setup()
		await resolveRedirectRequest(io.client, request(), {
			...options,
			cache: io.cache,
		})
		const [key, entry] = [...io.entries][0]! as [string, object]
		io.entries.set(key, { ...entry, ...replacement })
		expect(
			await resolveRedirectRequest(io.client, request(), {
				...options,
				cache: io.cache,
			}),
		).toMatchObject({ kind: 'error', reason: 'invalid-cache' })
		expect(io.fetch).toHaveBeenCalledTimes(1)
	})

	it.each([
		null,
		{},
		[],
		{ perspective: 'published', complete: true, records: [rule] },
	])('rejects an adapter returning unvalidated/raw data', async (value) => {
		const io = setup()
		io.cache.getOrLoad = () => Promise.resolve(value)
		expect(
			await resolveRedirectRequest(io.client, request(), {
				...options,
				cache: io.cache,
			}),
		).toEqual({ kind: 'error', reason: 'invalid-cache' })
		expect(io.fetch).not.toHaveBeenCalled()
	})

	it('never offers invalid origin data for storage', async () => {
		const io = setup()
		io.fetch.mockResolvedValue([
			{ ...rule, destination: 'https://evil.example' },
		])
		expect(
			await resolveRedirectRequest(io.client, request(), {
				...options,
				cache: io.cache,
			}),
		).toMatchObject({
			kind: 'error',
			reason: 'invalid-snapshot',
			snapshotReason: 'invalid-destination',
		})
		expect(io.entries.size).toBe(0)
	})

	it('bypasses optional storage explicitly and does not hide storage failures', async () => {
		const io = setup()
		io.cache.key = () => null
		await resolveRedirectRequest(io.client, request(), {
			...options,
			cache: io.cache,
		})
		expect(io.cache.getOrLoad).not.toHaveBeenCalled()
		expect(io.fetch).toHaveBeenCalledTimes(1)
		delete io.cache.key
		io.cache.getOrLoad = () => Promise.reject(new Error('Backend unavailable'))
		expect(
			await resolveRedirectRequest(io.client, request(), {
				...options,
				cache: io.cache,
			}),
		).toEqual({ kind: 'error', reason: 'cache-failed' })
		expect(io.fetch).toHaveBeenCalledTimes(1)
	})

	it.each(['a'.repeat(257), '\n'])(
		'rejects invalid custom keys without origin work',
		async (key) => {
			const io = setup()
			io.cache.key = () => key
			expect(
				await resolveRedirectRequest(io.client, request(), {
					...options,
					cache: io.cache,
				}),
			).toEqual({ kind: 'error', reason: 'cache-failed' })
			expect(io.fetch).not.toHaveBeenCalled()
		},
	)

	it('reports failed invalidation explicitly', async () => {
		const io = setup()
		io.cache.invalidate = () => Promise.reject(new Error('offline'))
		expect(await invalidateRedirectCache(io.client, options, io.cache)).toEqual(
			{ ok: false, reason: 'cache-failed' },
		)
	})

	it('pins the read project/dataset even if the app mutates its client while deriving the cache key', async () => {
		const io = setup()
		io.cache.key = () => {
			io.scope.dataset = 'changed'
			return ''
		}
		await resolveRedirectRequest(io.client, request(), {
			...options,
			cache: io.cache,
		})
		expect(io.client.withConfig).toHaveBeenCalledWith(
			expect.objectContaining({ projectId: 'project123', dataset: 'test' }),
		)
	})
})

describe('request cancellation', () => {
	it('does no work for an already aborted request', async () => {
		const io = setup()
		const controller = new AbortController()
		controller.abort()
		expect(
			await resolveRedirectRequest(
				io.client,
				request('/old', { signal: controller.signal }),
				{ ...options, cache: io.cache },
			),
		).toEqual({ kind: 'error', reason: 'aborted' })
		expect(io.fetch).not.toHaveBeenCalled()
		expect(io.cache.getOrLoad).not.toHaveBeenCalled()
	})

	it('ignores a late uncached response after cancellation', async () => {
		const io = setup()
		const pending = Promise.withResolvers<unknown>()
		io.fetch.mockReturnValue(pending.promise)
		const controller = new AbortController()
		const result = resolveRedirectRequest(
			io.client,
			request('/old', { signal: controller.signal }),
			options,
		)
		controller.abort()
		expect(await result).toEqual({ kind: 'error', reason: 'aborted' })
		pending.resolve([rule])
	})

	it('lets one cancelled cache waiter leave without poisoning another waiter or their refresh', async () => {
		const io = setup()
		const pending = Promise.withResolvers<unknown>()
		let shared: Promise<unknown> | undefined
		io.cache.getOrLoad = async (_key, load) => (shared ??= load())
		io.fetch.mockReturnValue(pending.promise)
		const controller = new AbortController()
		const first = resolveRedirectRequest(
			io.client,
			request('/old', { signal: controller.signal }),
			{ ...options, cache: io.cache },
		)
		const second = resolveRedirectRequest(io.client, request(), {
			...options,
			cache: io.cache,
		})
		await vi.waitFor(() => expect(io.fetch).toHaveBeenCalledTimes(1))
		controller.abort()
		expect(await first).toEqual({ kind: 'error', reason: 'aborted' })
		pending.resolve([rule])
		expect(await second).toMatchObject({ kind: 'redirect', location: '/new' })
	})
})
