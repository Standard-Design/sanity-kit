import { createClient } from '@sanity/client'
import type { LoaderFunctionArgs } from 'react-router'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { z } from 'zod'
import { SanityDataValidationError } from '../../src/core/index.js'
import {
	createSanitySitemapLoader,
	type SanitySitemapCache,
} from '../../src/react-router/server/index.js'
import { createZodDecoder } from '../../src/validation/zod/index.js'

const rows = [{ pathname: '/page', updated: '2026-01-01', noindex: false }]
const schema = z.array(
	z.object({ pathname: z.string(), updated: z.string(), noindex: z.boolean() }),
)
const decoder = createZodDecoder(schema)

function args(method = 'GET'): LoaderFunctionArgs {
	const url = new URL('https://untrusted-host.test/sitemap.xml')
	return {
		request: new Request(url, {
			method,
			headers: { Cookie: '__sanity_preview=arbitrary' },
		}),
		url,
		pattern: '/sitemap.xml',
		params: {},
		context: {} as LoaderFunctionArgs['context'],
	}
}

function setup(cache?: SanitySitemapCache) {
	const client = createClient({
		projectId: 'project',
		dataset: 'production',
		apiVersion: '2026-09-19',
		perspective: 'drafts',
		useCdn: false,
		stega: { enabled: true, studioUrl: 'https://studio.test' },
	})
	const fetch = vi
		.fn<(...args: unknown[]) => Promise<unknown>>()
		.mockResolvedValue(rows)
	vi.spyOn(client, 'fetch').mockImplementation(fetch as typeof client.fetch)
	const toEntries = vi.fn((data: z.infer<typeof schema>) =>
		data
			.filter((row) => !row.noindex)
			.map((row) => ({ loc: row.pathname, lastmod: row.updated })),
	)
	const config = {
		client,
		siteUrl: 'https://example.com',
		query: '*[_type == $type]',
		params: { type: 'page' },
		decoder,
		toEntries,
		...(cache ? { cache } : {}),
	}
	return { fetch, toEntries, config }
}

describe('createSanitySitemapLoader', () => {
	it('forces published clean fetches and uses configured origin regardless of cookies and host', async () => {
		const { fetch, config } = setup()
		const requestArgs = args()
		const loader = createSanitySitemapLoader(config)
		expectTypeOf(loader).returns.toEqualTypeOf<Promise<Response>>()
		const response = await loader(requestArgs)
		expect(fetch).toHaveBeenCalledWith(
			config.query,
			{ type: 'page' },
			{
				perspective: 'published',
				stega: false,
				filterResponse: true,
				signal: requestArgs.request.signal,
			},
		)
		expect(await response.text()).toContain(
			'<loc>https://example.com/page</loc>',
		)
		expect(config.client.config().perspective).toBe('drafts')
	})

	it('lets the app filter noindex documents and add static routes after typed decoding', async () => {
		const { fetch, config } = setup()
		fetch.mockResolvedValue([
			...rows,
			{ pathname: '/hidden', updated: '2026-01-01', noindex: true },
		])
		const response = await createSanitySitemapLoader({
			...config,
			toEntries: (data) => [{ loc: '/' }, ...config.toEntries(data)],
		})(args())
		const xml = await response.text()
		expect(xml).toContain('<loc>https://example.com/</loc>')
		expect(xml).toContain('<loc>https://example.com/page</loc>')
		expect(xml).not.toContain('/hidden')
	})

	it('rejects invalid CMS data before mapping or caching it', async () => {
		const store = vi.fn()
		const { config, fetch, toEntries } = setup({
			key: () => 'sitemap',
			getOrLoad: async (_key, load) => {
				const value = await load()
				store(value)
				return value
			},
		})
		fetch.mockResolvedValue([{ pathname: 42 }])
		await expect(
			createSanitySitemapLoader(config)(args()),
		).rejects.toBeInstanceOf(SanityDataValidationError)
		expect(toEntries).not.toHaveBeenCalled()
		expect(store).not.toHaveBeenCalled()
	})

	it('validates cache hits and bypasses fetch on a hit', async () => {
		const getOrLoad = vi.fn().mockResolvedValue(rows)
		const { config, fetch } = setup({
			key: () => 'site:dataset:sitemap',
			getOrLoad,
		})
		const loader = createSanitySitemapLoader(config)
		expect((await loader(args())).status).toBe(200)
		expect(fetch).not.toHaveBeenCalled()
		expect(getOrLoad).toHaveBeenCalledWith(
			'site:dataset:sitemap',
			expect.any(Function),
		)
		getOrLoad.mockResolvedValue({ stale: 'invalid shape' })
		await expect(loader(args())).rejects.toBeInstanceOf(
			SanityDataValidationError,
		)
	})

	it('supports async query parameters and explicit cache bypass', async () => {
		const getOrLoad = vi.fn()
		const { config, fetch } = setup({ key: () => null, getOrLoad })
		await createSanitySitemapLoader({
			...config,
			params: () => Promise.resolve({ type: 'article' }),
		})(args())
		expect(getOrLoad).not.toHaveBeenCalled()
		expect(fetch).toHaveBeenCalledWith(
			config.query,
			{ type: 'article' },
			expect.any(Object),
		)
	})

	it('returns bodyless HEAD responses and rejects unsupported methods before fetching', async () => {
		const { config, fetch } = setup()
		const loader = createSanitySitemapLoader(config)
		const head = await loader(args('HEAD'))
		expect(await head.text()).toBe('')
		expect(head.headers.get('Content-Type')).toBe(
			'application/xml; charset=utf-8',
		)
		fetch.mockClear()
		const post = await loader(args('POST'))
		expect(post.status).toBe(405)
		expect(post.headers.get('Allow')).toBe('GET, HEAD')
		expect(fetch).not.toHaveBeenCalled()
	})

	it('propagates upstream errors and invalid mapped URLs', async () => {
		const { config, fetch } = setup()
		const failure = new Error('upstream unavailable')
		fetch.mockRejectedValueOnce(failure)
		await expect(createSanitySitemapLoader(config)(args())).rejects.toBe(
			failure,
		)
		await expect(
			createSanitySitemapLoader({
				...config,
				toEntries: () => [{ loc: 'https://other.test/' }],
			})(args()),
		).rejects.toThrow(/origin/u)
	})

	it('validates configuration before handling requests', () => {
		const { config } = setup()
		expect(() => createSanitySitemapLoader({ ...config, query: '' })).toThrow(
			/query/u,
		)
		expect(() =>
			createSanitySitemapLoader({
				...config,
				siteUrl: 'https://example.com/subpath',
			}),
		).toThrow(/origin/u)
	})
})
