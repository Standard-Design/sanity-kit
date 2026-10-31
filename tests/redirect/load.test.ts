import { createClient, type ClientConfig } from '@sanity/client'
import { build } from 'esbuild'
import { evaluate, parse } from 'groq-js'
import { describe, expect, it, vi } from 'vitest'
import {
	loadRedirectSnapshot,
	type RedirectLoadOptions,
} from '../../src/redirect/load.js'
import { REDIRECT_MAX_RECORDS } from '../../src/redirect/snapshot.js'

const options: RedirectLoadOptions = {
	destinations: 'unverified',
}
const rule = (_id = 'a-rule', source = '/old', destination = '/new') => ({
	_id,
	_type: 'sanityKitRedirect',
	_rev: 'rev-1',
	_createdAt: '2026-10-01T00:00:00Z',
	_updatedAt: '2026-10-01T00:00:00Z',
	source,
	destination,
	status: 301,
	enabled: true,
	origin: 'manual',
})

/** Evaluate the actual parameterized projection, not a mocked copy of its filter. */
function transport(dataset: object[] = [rule()]) {
	const fetch = vi.fn(
		async (
			query: string,
			params: Record<string, unknown>,
			config: unknown,
		): Promise<unknown> => {
			void config
			return (await evaluate(parse(query), { dataset, params })).get()
		},
	)
	const withConfig = vi.fn(() => ({ fetch }))
	const client = { withConfig }
	return { client, fetch, withConfig }
}

describe('private redirect Sanity loader', () => {
	it('queries the configured dataset with exact fields and omits unrelated content and versions', async () => {
		const io = transport([
			{ ...rule(), body: 'Do not fetch page content' },
			{ ...rule('disabled'), enabled: false, source: 'old malformed history' },
			{ ...rule('drafts.a-rule'), destination: '/draft-change' },
			{ ...rule('drafts.draft-only'), source: '/draft-only' },
			{ ...rule('versions.release.a-rule'), destination: '/release-change' },
			{ ...rule('versions.release.release-only'), source: '/release-only' },
			{ ...rule('not-a-redirect'), _type: 'page' },
		])
		const result = await loadRedirectSnapshot(io.client, options)
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.value.size).toBe(1)
		expect(result.value.match('/old')).toEqual({
			kind: 'redirect',
			location: '/new',
			status: 301,
		})
		expect(result.value.match('/draft-only')).toEqual({ kind: 'none' })
		expect(result.value.match('/release-only')).toEqual({ kind: 'none' })
		const rows: unknown = await io.fetch.mock.results[0]!.value
		expect(rows).toEqual([
			rule(),
			{ ...rule('disabled'), enabled: false, source: 'old malformed history' },
		])
	})

	it('pins the client view and repeats read guards on the fetch', async () => {
		const io = transport()
		const controller = new AbortController()
		await loadRedirectSnapshot(io.client, {
			...options,
			signal: controller.signal,
		})
		expect(io.withConfig).toHaveBeenCalledWith({
			apiVersion: '2026-10-01',
			perspective: 'published',
			useCdn: false,
			stega: false,
		})
		expect(io.fetch).toHaveBeenCalledWith(
			expect.any(String),
			{},
			{
				perspective: 'published',
				useCdn: false,
				stega: false,
				filterResponse: true,
				resultSourceMap: false,
				tag: 'sanity-kit.redirects',
				cache: 'no-store',
				signal: controller.signal,
			},
		)
	})

	it('sends no-store through the real SDK transport over inherited caching', async () => {
		const fetch = vi.fn((_input: unknown, _init?: RequestInit) => {
			void _input
			void _init
			return Promise.resolve(
				new Response(JSON.stringify({ result: [rule()] }), {
					headers: { 'content-type': 'application/json' },
				}),
			)
		})
		const client = createClient({
			projectId: 'project123',
			dataset: 'test',
			apiVersion: '2025-02-19',
			useCdn: true,
			// Exercise runtime cache forwarding without adding Next global types.
			fetch: {
				cache: 'force-cache',
				next: { revalidate: 3600 },
			} as unknown as NonNullable<ClientConfig['fetch']>,
			resolveFetch: () => fetch,
		})
		const result = await loadRedirectSnapshot(client, options)
		expect(result.ok).toBe(true)
		expect(fetch).toHaveBeenCalledTimes(1)
		expect(fetch.mock.calls[0]![1]).toMatchObject({ cache: 'no-store' })
		expect(fetch.mock.calls[0]![1]).not.toHaveProperty('next.revalidate')
		expect(client.config().fetch).toEqual({
			cache: 'force-cache',
			next: { revalidate: 3600 },
		})
	})

	it('preserves the app client project, dataset, and preview configuration', async () => {
		const requests: URL[] = []
		const queries: unknown[] = []
		const client = createClient({
			projectId: 'project123',
			dataset: 'test',
			apiVersion: '2025-02-19',
			useCdn: true,
			perspective: 'drafts',
			resultSourceMap: true,
			stega: { enabled: true, studioUrl: 'https://studio.example' },
			requestHandler: (request) => {
				requests.push(new URL(request.url))
				queries.push(request.query)
				return Promise.resolve({ result: [rule()] })
			},
		})
		const before = client.config()
		const result = await loadRedirectSnapshot(client, options)
		expect(result.ok).toBe(true)
		expect(client.config()).toEqual(before)
		expect(requests).toHaveLength(1)
		expect(requests[0]!.host).toBe('project123.api.sanity.io')
		expect(requests[0]!.pathname).toBe('/v2026-10-01/data/query/test')
		expect(queries[0]).toMatchObject({ perspective: 'published' })
		expect(queries[0]).not.toHaveProperty('resultSourceMap')
	})

	it('accepts an empty published set without inventing rules', async () => {
		const io = transport([])
		const result = await loadRedirectSnapshot(io.client, options)
		expect(result.ok && result.value.size).toBe(0)
	})

	it('does not let legacy site fields hide duplicate paths in the same dataset', async () => {
		const io = transport([
			{ ...rule('first'), site: 'first-site' },
			{ ...rule('second'), site: 'second-site' },
		])
		expect(await loadRedirectSnapshot(io.client, options)).toMatchObject({
			ok: false,
			reason: 'invalid-snapshot',
			snapshotReason: 'duplicate-source',
		})
		// The query reads both documents and projects away the removed field;
		// there is no legacy scope filter or optional multisite behavior.
		expect(await io.fetch.mock.results[0]!.value).toEqual([
			rule('first'),
			rule('second'),
		])
	})

	it('counts disabled history and detects one row beyond the bound', async () => {
		const io = transport(
			Array.from({ length: REDIRECT_MAX_RECORDS + 3 }, (_, i) => ({
				...rule(`rule-${i}`),
				enabled: false,
			})),
		)
		expect(await loadRedirectSnapshot(io.client, options)).toEqual({
			ok: false,
			reason: 'invalid-snapshot',
			snapshotReason: 'too-many-records',
		})
		expect(await io.fetch.mock.results[0]!.value).toHaveLength(
			REDIRECT_MAX_RECORDS + 1,
		)
	})

	it('accepts exactly the row bound without dropping the last rule', async () => {
		const io = transport(
			Array.from({ length: REDIRECT_MAX_RECORDS }, (_, i) =>
				rule(`rule-${i}`, `/old-${i}`),
			),
		)
		const result = await loadRedirectSnapshot(io.client, options)
		expect(result.ok && result.value.size).toBe(REDIRECT_MAX_RECORDS)
		expect(
			result.ok && result.value.match(`/old-${REDIRECT_MAX_RECORDS - 1}`).kind,
		).toBe('redirect')
	})

	it.each([
		null,
		{},
		{ result: [] },
		'[]',
		Array.from({ length: REDIRECT_MAX_RECORDS + 2 }, () => rule()),
	])(
		'rejects malformed or unexpectedly large transport responses',
		async (value) => {
			const io = transport()
			io.fetch.mockResolvedValueOnce(value)
			expect(await loadRedirectSnapshot(io.client, options)).toEqual({
				ok: false,
				reason: 'invalid-response',
			})
		},
	)

	it.each([
		['invalid-record', { ...rule(), site: 'legacy' }],
		['unpublished-record', rule('drafts.rule')],
		['unpublished-record', rule('versions.release.rule')],
		['invalid-record', { ...rule(), enabled: null }],
		[
			'invalid-destination',
			{ ...rule(), destination: 'https://elsewhere.example' },
		],
		['self-redirect', { ...rule(), destination: '/old' }],
		['payload-too-large', { ...rule(), origin: 'a'.repeat(1_048_576) }],
	] as const)(
		'does not trust the transport to guarantee %s safety',
		async (snapshotReason, row) => {
			const io = transport()
			io.fetch.mockResolvedValueOnce([row])
			expect(await loadRedirectSnapshot(io.client, options)).toMatchObject({
				ok: false,
				reason: 'invalid-snapshot',
				snapshotReason,
			})
		},
	)

	it.each([
		['duplicate-source', [rule(), rule('duplicate')]],
		['redirect-chain', [rule(), rule('next', '/new', '/last')]],
		['redirect-cycle', [rule(), rule('back', '/new', '/old')]],
	] as const)('refuses the entire %s graph', async (snapshotReason, rows) => {
		const io = transport([...rows])
		expect(await loadRedirectSnapshot(io.client, options)).toMatchObject({
			ok: false,
			reason: 'invalid-snapshot',
			snapshotReason,
		})
	})

	it.each([
		['reserved-source', { ...options, reservedPaths: ['/old'] }],
		['occupied-source', { ...options, occupiedPaths: ['/old'] }],
		['unknown-destination', { ...options, destinations: [] }],
	] as const)(
		'applies explicit caller policy: %s',
		async (snapshotReason, policy) => {
			const io = transport()
			expect(await loadRedirectSnapshot(io.client, policy)).toMatchObject({
				ok: false,
				reason: 'invalid-snapshot',
				snapshotReason,
			})
		},
	)

	it('rejects invalid trusted configuration before any request', async () => {
		const io = transport()
		await expect(
			loadRedirectSnapshot(io.client, {
				...options,
				reservedPaths: ['https://example.com'],
			}),
		).rejects.toThrow('canonical')
		await expect(
			loadRedirectSnapshot(io.client, {} as RedirectLoadOptions),
		).rejects.toThrow('known destinations')
		expect(io.withConfig).not.toHaveBeenCalled()
		expect(io.fetch).not.toHaveBeenCalled()
	})

	it('reports a request failure rather than silently returning no redirects', async () => {
		const io = transport()
		io.fetch.mockRejectedValueOnce(new Error('Unavailable'))
		expect(await loadRedirectSnapshot(io.client, options)).toEqual({
			ok: false,
			reason: 'request-failed',
		})
	})

	it('does not fetch when already cancelled', async () => {
		const io = transport()
		const controller = new AbortController()
		controller.abort()
		expect(
			await loadRedirectSnapshot(io.client, {
				...options,
				signal: controller.signal,
			}),
		).toEqual({ ok: false, reason: 'aborted' })
		expect(io.withConfig).not.toHaveBeenCalled()
	})

	it.each(['resolve', 'reject'] as const)(
		'does not expose late %s after cancellation',
		async (settlement) => {
			const io = transport()
			const pending = Promise.withResolvers<unknown>()
			const controller = new AbortController()
			io.fetch.mockReturnValueOnce(pending.promise)
			const result = loadRedirectSnapshot(io.client, {
				...options,
				signal: controller.signal,
			})
			controller.abort()
			if (settlement === 'resolve') pending.resolve([rule()])
			else pending.reject(new Error('Aborted'))
			expect(await result).toEqual({ ok: false, reason: 'aborted' })
		},
	)

	it('captures caller policy before awaiting the response', async () => {
		const io = transport()
		const pending = Promise.withResolvers<unknown>()
		io.fetch.mockReturnValueOnce(pending.promise)
		const config = {
			destinations: ['/new'],
			reservedPaths: ['/api'],
			occupiedPaths: ['/page'],
		}
		const operation = loadRedirectSnapshot(io.client, config)
		config.destinations.length = 0
		config.reservedPaths.push('/old')
		config.occupiedPaths.push('/old')
		pending.resolve([rule()])
		const result = await operation
		expect(result.ok && result.value.destinationsVerified).toBe(true)
	})

	it('loads again on each call and never shares a mutable lookup', async () => {
		const io = transport()
		io.fetch
			.mockResolvedValueOnce([rule()])
			.mockResolvedValueOnce([{ ...rule(), destination: '/updated' }])
		const first = await loadRedirectSnapshot(io.client, options)
		const second = await loadRedirectSnapshot(io.client, options)
		expect(io.fetch).toHaveBeenCalledTimes(2)
		expect(first.ok && first.value.match('/old')).toMatchObject({
			location: '/new',
		})
		expect(second.ok && second.value.match('/old')).toMatchObject({
			location: '/updated',
		})
	})

	it('keeps Studio and framework runtimes outside the loader dependency graph', async () => {
		const output = await build({
			entryPoints: ['src/redirect/load.ts'],
			bundle: true,
			write: false,
			platform: 'browser',
			format: 'esm',
			metafile: true,
		})
		for (const path of Object.keys(output.metafile.inputs)) {
			expect(path).not.toMatch(/src\/(?:studio|react-router)\//u)
			expect(path).not.toMatch(
				/node_modules\/(?:sanity|react|react-dom|react-router|@sanity\/ui)\//u,
			)
		}
	})
})
