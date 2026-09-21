import type { SanityClient } from '@sanity/client'
import type { LoaderFunctionArgs } from 'react-router'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { defineSanityDataDecoder } from '../../src/core/index.js'
import { sanityRouteDataQuery } from '../../src/react-router/index.js'
import {
	createSanityLoaders,
	defineSanityLoader,
	type SanityKit,
	type SanityLoaderCache,
} from '../../src/react-router/server/index.js'

interface Article {
	_id: string
	_type: 'article'
	title: string
}

const articleDecoder = defineSanityDataDecoder<Article>({
	decode(input) {
		if (
			typeof input === 'object' &&
			input !== null &&
			'_id' in input &&
			typeof input._id === 'string' &&
			'_type' in input &&
			input._type === 'article' &&
			'title' in input &&
			typeof input.title === 'string'
		) {
			return {
				success: true,
				value: {
					_id: input._id,
					_type: input._type,
					title: input.title.toUpperCase(),
				},
				diagnostics: [],
			}
		}

		return {
			success: false,
			diagnostics: [
				{
					code: 'INVALID_ARTICLE',
					message: 'Expected an article.',
					path: [],
					source: 'test',
				},
			],
		}
	},
})

const articleLoader = defineSanityLoader({
	type: 'article',
	query: '*[_id == $id][0]',
	decoder: articleDecoder,
})

function createKit(
	preview: boolean,
	fetch: ReturnType<typeof vi.fn>,
): SanityKit {
	return {
		preview: {
			getContext: vi.fn().mockResolvedValue({
				preview,
				perspective: preview ? 'drafts' : 'published',
				client: { fetch } as unknown as SanityClient,
				options: preview
					? { perspective: 'drafts', stega: true }
					: { perspective: 'published', stega: false },
			}),
		},
	} as unknown as SanityKit
}

function loaderArgs(url: string, init?: RequestInit): LoaderFunctionArgs {
	const normalizedUrl = new URL(url)
	return {
		request: new Request(normalizedUrl, init),
		url: normalizedUrl,
		pattern: '/*',
		params: {},
		context: {} as LoaderFunctionArgs['context'],
	}
}

function routeData() {
	return {
		_id: 'article-1',
		_type: 'article',
		pathname: '/articles/one',
	}
}

describe('createSanityLoaders', () => {
	it('loads, validates, mutates, and caches published route data', async () => {
		const fetch = vi.fn((query: string) => {
			if (query === sanityRouteDataQuery) return routeData()
			return { ...routeData(), title: 'One' }
		})
		const cacheValues = new Map<string, unknown>()
		const cacheCalls: string[] = []
		const cache: SanityLoaderCache = async (context, load) => {
			cacheCalls.push(`${context.scope}:${context.key}`)
			if (cacheValues.has(context.key)) return cacheValues.get(context.key)
			const value = await load()
			cacheValues.set(context.key, value)
			return value
		}
		const loaders = createSanityLoaders({
			routes: { types: ['article'] as const },
			kit: createKit(false, fetch),
			cache,
			loaders: [
				defineSanityLoader({
					...articleLoader,
					cacheKey: ({ request, url }) =>
						`SANITY_ROUTE:${url.pathname}${url.search}:locale=${request.headers.get('lang') ?? 'default'}`,
					params: ({ request }) => ({
						id: 'cannot-override-id',
						locale: request.headers.get('lang'),
						pathname: '/cannot-override-pathname',
					}),
					mutate: (data) => ({ ...data, title: `${data.title}!` }),
				}),
			],
		})
		const args = loaderArgs('https://example.com/articles/one?view=full', {
			headers: { lang: 'en' },
		})

		await expect(loaders.loader(args)).resolves.toEqual({
			_id: 'article-1',
			_type: 'article',
			title: 'ONE!',
		})
		await expect(loaders.loader(args)).resolves.toEqual({
			_id: 'article-1',
			_type: 'article',
			title: 'ONE!',
		})

		expect(fetch).toHaveBeenCalledTimes(2)
		expect(fetch).toHaveBeenNthCalledWith(
			2,
			'*[_id == $id][0]',
			{
				id: 'article-1',
				locale: 'en',
				pathname: '/articles/one',
			},
			expect.objectContaining({
				perspective: 'published',
				signal: args.request.signal,
				stega: false,
			}),
		)
		expect(cacheCalls).toEqual([
			'route-data:SANITY_ROUTE_DATA:/articles/one',
			'route:SANITY_ROUTE:/articles/one?view=full:locale=en',
			'route-data:SANITY_ROUTE_DATA:/articles/one',
			'route:SANITY_ROUTE:/articles/one?view=full:locale=en',
		])
		expectTypeOf(loaders.loader).returns.resolves.toEqualTypeOf<Article>()
	})

	it('bypasses caches and preserves original data in preview', async () => {
		const fetch = vi.fn((query: string) => {
			if (query === sanityRouteDataQuery) return routeData()
			return { ...routeData(), title: 'Preview title' }
		})
		const cache = vi.fn<SanityLoaderCache>()
		const cacheKey = vi.fn(() => 'must-not-run')
		const loaders = createSanityLoaders({
			routes: { types: ['article'] as const },
			kit: createKit(true, fetch),
			cache,
			loaders: [{ ...articleLoader, cacheKey }],
		})

		await expect(
			loaders.loader(loaderArgs('https://example.com/articles/one')),
		).resolves.toMatchObject({ title: 'Preview title' })
		expect(cache).not.toHaveBeenCalled()
		expect(cacheKey).not.toHaveBeenCalled()
		expect(fetch).toHaveBeenCalledTimes(2)
	})

	it('bypasses the page cache for custom params without a cache key', async () => {
		const fetch = vi.fn((query: string) =>
			query === sanityRouteDataQuery
				? routeData()
				: { ...routeData(), title: 'Localized' },
		)
		const cacheScopes: string[] = []
		const cache: SanityLoaderCache = async (context, load) => {
			cacheScopes.push(context.scope)
			return load()
		}
		const loaders = createSanityLoaders({
			routes: { types: ['article'] as const },
			kit: createKit(false, fetch),
			cache,
			loaders: [
				defineSanityLoader({
					...articleLoader,
					params: () => ({ locale: 'en' }),
				}),
			],
		})

		await loaders.loader(loaderArgs('https://example.com/articles/one'))

		expect(cacheScopes).toEqual(['route-data'])
		expect(fetch).toHaveBeenCalledTimes(2)
	})

	it('throws structured published validation failures', async () => {
		const fetch = vi.fn((query: string) => {
			if (query === sanityRouteDataQuery) return routeData()
			return { ...routeData(), title: null }
		})
		const onFailure = vi.fn()
		const loaders = createSanityLoaders({
			routes: { types: ['article'] as const },
			kit: createKit(false, fetch),
			loaders: [articleLoader],
			validation: { onFailure },
		})

		const error = await loaders
			.loader(loaderArgs('https://example.com/articles/one'))
			.catch((cause: unknown) => cause)

		expect(error).toBeInstanceOf(Response)
		expect((error as Response).status).toBe(500)
		await expect((error as Response).json()).resolves.toMatchObject({
			code: 'SANITY_ROUTE_INVALID',
			diagnostics: [{ code: 'INVALID_ARTICLE' }],
		})
		expect(onFailure).toHaveBeenCalledOnce()
	})

	it('passes invalid drafts through after reporting diagnostics', async () => {
		const draft = { ...routeData(), title: null }
		const fetch = vi.fn((query: string) =>
			query === sanityRouteDataQuery ? routeData() : draft,
		)
		const onFailure = vi.fn()
		const loaders = createSanityLoaders({
			routes: { types: ['article'] as const },
			kit: createKit(true, fetch),
			loaders: [articleLoader],
			validation: { onFailure },
		})

		await expect(
			loaders.loader(loaderArgs('https://example.com/articles/one')),
		).resolves.toBe(draft)
		expect(onFailure).toHaveBeenCalledWith(
			expect.objectContaining({
				data: draft,
				preview: true,
				type: 'article',
			}),
		)
	})

	it('rejects preview data whose discriminator does not match its loader', async () => {
		const decoder = defineSanityDataDecoder<Article>({
			decode: () => ({
				success: true,
				value: { _id: 'article-1', _type: 'article', title: 'Decoded' },
				diagnostics: [],
			}),
		})
		const fetch = vi.fn((query: string) =>
			query === sanityRouteDataQuery
				? routeData()
				: { _id: 'article-1', _type: 'landingPage', title: 'Wrong type' },
		)
		const loaders = createSanityLoaders({
			routes: { types: ['article'] as const },
			kit: createKit(true, fetch),
			loaders: [
				defineSanityLoader({
					type: 'article',
					query: articleLoader.query,
					decoder,
				}),
			],
		})

		const error = await loaders
			.loader(loaderArgs('https://example.com/articles/one'))
			.catch((cause: unknown) => cause)

		expect(error).toBeInstanceOf(Response)
		await expect((error as Response).json()).resolves.toMatchObject({
			code: 'SANITY_ROUTE_TYPE_MISMATCH',
			type: 'article',
		})
	})

	it('returns a no-store 404 response when no route document exists', async () => {
		const fetch = vi.fn().mockResolvedValue(null)
		const loaders = createSanityLoaders({
			routes: { types: ['article'] as const },
			kit: createKit(false, fetch),
			loaders: [articleLoader],
		})

		const error = await loaders
			.loader(loaderArgs('https://example.com/missing'))
			.catch((cause: unknown) => cause)

		expect(error).toBeInstanceOf(Response)
		expect((error as Response).status).toBe(404)
		expect((error as Response).headers.get('Cache-Control')).toBe('no-store')
		await expect((error as Response).json()).resolves.toMatchObject({
			code: 'SANITY_ROUTE_NOT_FOUND',
			pathname: '/missing',
		})
	})

	it('enforces complete registry parity and rejects duplicate loaders', () => {
		expect(() =>
			createSanityLoaders({
				routes: { types: ['article', 'landingPage'] as const },
				kit: createKit(false, vi.fn()),
				loaders: [articleLoader],
			}),
		).toThrow('Missing loaders: "landingPage"')

		expect(() =>
			createSanityLoaders({
				routes: { types: ['article'] as const },
				kit: createKit(false, vi.fn()),
				loaders: [articleLoader, articleLoader],
			}),
		).toThrow('Duplicate loader registered for type "article"')
	})
})
