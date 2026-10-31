import { createClient, type ClientConfig } from '@sanity/client'
import { evaluate, parse } from 'groq-js'
import { describe, expect, it, vi } from 'vitest'
import {
	createCollectionRoutingLoader,
	MAX_SETTINGS_PAYLOAD_BYTES,
	type CollectionSettingsClient,
	type CollectionSettingsLoadRequest,
} from '../../src/url/settings/load.js'
import type { CollectionRoutingConfig } from '../../src/url/settings/resolve.js'

const config = {
	pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
	collections: [
		{
			name: 'journal',
			title: 'Journal',
			routePrefix: { documentId: 'journal-routing' },
			overview: { schemaType: 'page', pathname: '/insights' },
			items: [{ schemaType: 'post', slugField: 'slug.current' }],
		},
	],
} satisfies CollectionRoutingConfig

function setting(prefix = '/journal', id = 'journal-routing') {
	return {
		_id: id,
		_rev: 'revision',
		_type: 'sanityKitCollectionRoute',
		collection: 'journal',
		prefix: { _type: 'slug', current: prefix },
	}
}

function transport(documents: unknown[] = [setting()]) {
	const fetch = vi.fn(
		async (
			query: string,
			params: { ids: string[] },
			_options: Parameters<
				ReturnType<CollectionSettingsClient['withConfig']>['fetch']
			>[2],
		): Promise<unknown> => {
			void _options
			const result = await evaluate(parse(query), {
				dataset: documents,
				params,
			})
			return result.get()
		},
	)
	const withConfig = vi.fn(
		(_config: Parameters<CollectionSettingsClient['withConfig']>[0]) => {
			void _config
			return { fetch }
		},
	)
	return { fetch, withConfig }
}

const preview = {
	perspective: 'drafts',
	draftVisibility: 'all-required-drafts',
} as const

describe('private collection routing settings loader', () => {
	it('loads only configured published IDs with explicit raw uncached options', async () => {
		const client = transport([
			setting(),
			setting('/blog', 'drafts.journal-routing'),
			setting('/release', 'versions.future.journal-routing'),
			setting('/other', 'other'),
		])
		const loader = createCollectionRoutingLoader(config, client)
		const signal = new AbortController().signal
		const result = await loader.load({ perspective: 'published', signal })
		expect(client.withConfig).toHaveBeenCalledExactlyOnceWith({
			apiVersion: '2026-10-01',
			useCdn: false,
			perspective: 'raw',
			stega: false,
		})
		expect(client.fetch.mock.calls[0]?.[1]).toEqual({
			ids: ['journal-routing'],
		})
		expect(client.fetch.mock.calls[0]?.[2]).toEqual({
			filterResponse: true,
			useCdn: false,
			perspective: 'raw',
			stega: false,
			cache: 'no-store',
			signal,
		})
		expect(loader.documentIds).toEqual(['journal-routing'])
		if (!result.ok) throw new Error(result.reason)
		expect(
			result.value.resolveUrl({ _type: 'post', slug: { current: 'first' } }),
		).toMatchObject({ ok: true, value: { pathname: '/journal/first' } })
		expect(result.value.routes.collections?.[0]?.overview.pathname).toBe(
			'/insights',
		)
		expect(result.value.settings[0]?.documentId).toBe('journal-routing')
	})

	it('preserves raw draft identity and projects only routing fields', async () => {
		const client = transport([
			{ ...setting(), body: 'not needed' },
			setting('/blog', 'drafts.journal-routing'),
		])
		const result = await createCollectionRoutingLoader(config, client).load(
			preview,
		)
		expect(client.fetch.mock.calls[0]?.[1]).toEqual({
			ids: ['journal-routing', 'drafts.journal-routing'],
		})
		expect(await client.fetch.mock.results[0]?.value).toEqual([
			setting(),
			setting('/blog', 'drafts.journal-routing'),
		])
		if (!result.ok) throw new Error(result.reason)
		expect(result.value.settings[0]).toMatchObject({
			documentId: 'drafts.journal-routing',
			prefix: '/blog',
		})
	})

	it('requires explicit draft visibility even if the transport would return drafts', async () => {
		const client = transport([
			setting(),
			setting('/blog', 'drafts.journal-routing'),
		])
		const loader = createCollectionRoutingLoader(config, client)
		for (const draftVisibility of [undefined, true, 'confirmed']) {
			expect(
				await loader.load({
					perspective: 'drafts',
					draftVisibility,
				} as CollectionSettingsLoadRequest),
			).toEqual({ ok: false, reason: 'access-unconfirmed' })
		}
		expect(client.withConfig).not.toHaveBeenCalled()
	})

	it('uses published fallback only after an attested complete draft read', async () => {
		const client = transport()
		const result = await createCollectionRoutingLoader(config, client).load(
			preview,
		)
		if (!result.ok) throw new Error(result.reason)
		expect(result.value.settings[0]?.documentId).toBe('journal-routing')
	})

	it.each([
		{ _type: 'wrong' },
		{ collection: 'other' },
		{ prefix: { _type: 'slug', current: '/' } },
		{ _originalId: 'drafts.journal-routing' },
	])('does not filter away incorrect selected content %j', async (change) => {
		const client = transport([{ ...setting(), ...change }])
		expect(
			await createCollectionRoutingLoader(config, client).load({
				perspective: 'published',
			}),
		).toEqual({ ok: false, reason: 'settings-invalid', collection: 'journal' })
	})

	it('keeps invalid drafts separate from published reads and refuses preview fallback', async () => {
		const client = transport([
			setting(),
			setting('/', 'drafts.journal-routing'),
		])
		const loader = createCollectionRoutingLoader(config, client)
		expect((await loader.load({ perspective: 'published' })).ok).toBe(true)
		expect(await loader.load(preview)).toMatchObject({
			ok: false,
			reason: 'settings-invalid',
		})
	})

	it('reports missing records rather than guessing defaults', async () => {
		expect(
			await createCollectionRoutingLoader(config, transport([])).load({
				perspective: 'published',
			}),
		).toEqual({ ok: false, reason: 'settings-missing', collection: 'journal' })
	})
	it('loads the full 100-collection bound without truncating published or draft settings', async () => {
		const collections = Array.from({ length: 100 }, (_, i) => ({
			...config.collections[0]!,
			name: `collection${i}`,
			routePrefix: { documentId: `routing-${i}` },
			overview: { schemaType: 'page', pathname: `/overview-${i}` },
			items: [{ schemaType: `item${i}`, slugField: 'slug.current' }],
		}))
		const documents = collections.flatMap((collection, i) => [
			{
				...setting(`/live-${i}`, collection.routePrefix.documentId),
				collection: collection.name,
			},
			{
				...setting(
					`/preview-${i}`,
					`drafts.${collection.routePrefix.documentId}`,
				),
				collection: collection.name,
			},
		])
		const client = transport(documents)
		const result = await createCollectionRoutingLoader(
			{ ...config, collections },
			client,
		).load(preview)
		if (!result.ok) throw new Error(result.reason)
		expect(client.fetch.mock.calls[0]?.[1].ids).toHaveLength(200)
		expect(result.value.settings).toHaveLength(100)
		expect(result.value.settings[99]?.prefix).toBe('/preview-99')
		// A transport returning duplicate identities must not disguise a truncated read.
		const overflow = transport([...documents, ...documents])
		expect(
			await createCollectionRoutingLoader(
				{ ...config, collections },
				overflow,
			).load(preview),
		).toEqual({ ok: false, reason: 'invalid-response' })
		expect(await overflow.fetch.mock.results[0]?.value).toHaveLength(201)
	})

	it('does not configure or fetch a client for code-fixed routes', async () => {
		const client = transport()
		client.withConfig.mockImplementation(() => {
			throw new Error('Must not run')
		})
		const loader = createCollectionRoutingLoader(
			{
				...config,
				collections: [{ ...config.collections[0]!, routePrefix: '/journal' }],
			},
			client,
		)
		expect((await loader.load({ perspective: 'drafts' })).ok).toBe(true)
		expect(loader.documentIds).toEqual([])
		expect(client.withConfig).not.toHaveBeenCalled()
	})

	it.each(
		[
			null,
			{},
			{ result: [setting()] },
			[null],
			[{}],
			[{ _id: 42 }],
			[setting('/other', 'unexpected')],
			[setting(), setting()],
			[setting(), setting('/blog', 'drafts.journal-routing')],
			[{ ...setting(), extra: 'x'.repeat(MAX_SETTINGS_PAYLOAD_BYTES) }],
		].map((documents) => ({ documents })),
	)(
		'refuses malformed, oversized, duplicate, and unexpected transport results',
		async ({ documents }) => {
			const client = transport()
			client.fetch.mockResolvedValue(documents)
			expect(
				await createCollectionRoutingLoader(config, client).load({
					perspective: 'published',
				}),
			).toEqual({ ok: false, reason: 'invalid-response' })
		},
	)

	it('rejects duplicate records even when there is room in the requested ID set', async () => {
		const client = transport()
		client.fetch.mockResolvedValue([setting(), setting()])
		expect(
			await createCollectionRoutingLoader(config, client).load(preview),
		).toEqual({ ok: false, reason: 'invalid-response' })
	})

	it('rejects non-JSON cyclic payloads and inherited identities', async () => {
		const cycle = { ...setting(), cycle: undefined as unknown }
		cycle.cycle = cycle
		for (const row of [cycle, Object.create(setting()) as unknown]) {
			const client = transport()
			client.fetch.mockResolvedValue([row])
			expect(
				await createCollectionRoutingLoader(config, client).load({
					perspective: 'published',
				}),
			).toEqual({ ok: false, reason: 'invalid-response' })
		}
	})

	it.each(['configure', 'fetch'] as const)(
		'reports %s failures without exposing credentials or errors',
		async (stage) => {
			const client = transport()
			if (stage === 'configure')
				client.withConfig.mockImplementation(() => {
					throw new Error('secret')
				})
			else client.fetch.mockRejectedValue(new Error('secret'))
			expect(
				await createCollectionRoutingLoader(config, client).load({
					perspective: 'published',
				}),
			).toEqual({ ok: false, reason: 'request-failed' })
		},
	)

	it('does no work for an already aborted request', async () => {
		const abort = new AbortController()
		abort.abort()
		const client = transport()
		expect(
			await createCollectionRoutingLoader(config, client).load({
				perspective: 'published',
				signal: abort.signal,
			}),
		).toEqual({ ok: false, reason: 'aborted' })
		expect(client.withConfig).not.toHaveBeenCalled()
	})

	it.each([false, true])(
		'discards late transport results or rejection after ignored abort (reject=%s)',
		async (reject) => {
			const abort = new AbortController()
			const client = transport()
			client.fetch.mockImplementation(() => {
				abort.abort()
				return reject
					? Promise.reject(new Error('aborted'))
					: Promise.resolve([setting()])
			})
			expect(
				await createCollectionRoutingLoader(config, client).load({
					perspective: 'published',
					signal: abort.signal,
				}),
			).toEqual({ ok: false, reason: 'aborted' })
		},
	)

	it('does not cache outcomes or mutate a previous context', async () => {
		const client = transport()
		const loader = createCollectionRoutingLoader(config, client)
		const first = await loader.load({ perspective: 'published' })
		client.fetch.mockResolvedValue([setting('/blog')])
		const second = await loader.load({ perspective: 'published' })
		if (!first.ok || !second.ok) throw new Error('Expected loaded settings')
		expect(first.value.settings[0]?.prefix).toBe('/journal')
		expect(second.value.settings[0]?.prefix).toBe('/blog')
		expect(client.fetch).toHaveBeenCalledTimes(2)
	})

	it('snapshots bindings and passes only a disposable ID array to the transport', async () => {
		const mutable = structuredClone(config)
		const client = transport()
		const loader = createCollectionRoutingLoader(mutable, client)
		mutable.collections[0]!.routePrefix.documentId = 'changed'
		client.fetch.mockImplementation((_query, params) => {
			params.ids.push('unexpected')
			return Promise.resolve([setting('/other', 'unexpected')])
		})
		expect(await loader.load({ perspective: 'published' })).toEqual({
			ok: false,
			reason: 'invalid-response',
		})
		expect(loader.documentIds).toEqual(['journal-routing'])
	})

	it('rejects unsupported perspectives before touching transport', async () => {
		const client = transport()
		expect(
			await createCollectionRoutingLoader(config, client).load({
				perspective: 'raw',
			} as unknown as CollectionSettingsLoadRequest),
		).toEqual({ ok: false, reason: 'unsupported-perspective' })
		expect(client.fetch).not.toHaveBeenCalled()
	})

	it('accepts a native Sanity client without configuring or mutating it at creation', () => {
		const native: CollectionSettingsClient = createClient({
			projectId: 'test1234',
			dataset: 'test',
			apiVersion: '2026-10-01',
			useCdn: true,
			perspective: 'drafts',
		})
		expect(() => createCollectionRoutingLoader(config, native)).not.toThrow()
	})

	it('forwards no-store and raw to the native SDK transport without changing its configured perspective', async () => {
		const fetch = vi.fn((_url: unknown, _init: unknown) => {
			void _url
			void _init
			return Promise.resolve(
				new Response(JSON.stringify({ result: [setting()] }), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				}),
			)
		})
		const client = createClient({
			projectId: 'test1234',
			dataset: 'test',
			apiVersion: '2026-10-01',
			useCdn: true,
			perspective: 'drafts',
			maxRetries: 0,
			// SDK v8's runtime accepts fetch cache options outside Next too.
			fetch: {
				cache: 'force-cache',
				next: { revalidate: 3600 },
			} as unknown as NonNullable<ClientConfig['fetch']>,
			resolveFetch: () => fetch,
		})
		const before = client.config()
		const result = await createCollectionRoutingLoader(config, client).load({
			perspective: 'published',
		})
		expect(result.ok).toBe(true)
		expect(fetch).toHaveBeenCalledTimes(1)
		const [url, options] = fetch.mock.calls[0]!
		expect(String(url)).toContain(
			'test1234.api.sanity.io/v2026-10-01/data/query/test',
		)
		expect(String(url)).toContain('perspective=raw')
		expect(options).toMatchObject({ cache: 'no-store' })
		expect(options).not.toMatchObject({ next: { revalidate: 3600 } })
		expect(client.config()).toEqual(before)
	})
})
