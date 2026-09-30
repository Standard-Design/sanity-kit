import type { SanityClient } from '@sanity/client'
import { stegaClean, stegaEncodeSourceMap } from '@sanity/client/stega'
import { z } from 'zod'
import type { LoaderFunctionArgs } from 'react-router'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { defineSanityDataDecoder } from '../../src/core/index.js'
import {
	sanityRouteDataQuery,
	type SanityRoutable,
} from '../../src/react-router/index.js'
import { createZodDecoder } from '../../src/validation/zod/index.js'
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
	it.each([
		['route-data', null],
		['route-data', { _id: 'private-id', _type: 'article', pathname: false }],
		['route', { ...routeData(), title: null }],
	] as const)(
		'rejects invalid %s before a cache write',
		async (scope, invalid) => {
			const writes: string[] = []
			const onFailure = vi.fn()
			const fetch = vi.fn((query: string) =>
				query === sanityRouteDataQuery && scope === 'route'
					? routeData()
					: invalid,
			)
			const loaders = createSanityLoaders({
				routes: { types: ['article'] },
				kit: createKit(false, fetch),
				loaders: [articleLoader],
				validation: { onFailure },
				cache: async (context, load) => {
					const raw = await load()
					writes.push(context.scope)
					return raw
				},
			})
			const error = await loaders
				.loader(loaderArgs('https://example.com/private-path'))
				.catch((cause: unknown) => cause)
			expect(error).toBeInstanceOf(Response)
			expect(writes).not.toContain(scope)
			expect(onFailure).toHaveBeenCalledOnce()
			expect(onFailure).toHaveBeenCalledWith(
				expect.objectContaining({
					stage: scope === 'route' ? 'published' : 'route-data',
					source: 'fetch',
					data: invalid,
				}),
			)
			const body = (await (error as Response).json()) as Record<string, unknown>
			expect(Object.keys(body).sort()).toEqual(['code', 'message'])
			expect(JSON.stringify(body)).not.toMatch(
				/private-path|private-id|diagnostics/,
			)
		},
	)

	it.each(['route-data', 'route'] as const)(
		'revalidates corrupt %s cache hits',
		async (scope) => {
			const fetch = vi.fn()
			const onFailure = vi.fn()
			const loaders = createSanityLoaders({
				routes: { types: ['article'] },
				kit: createKit(false, fetch),
				loaders: [articleLoader],
				validation: { onFailure },
				cache: (context) =>
					Promise.resolve(
						context.scope === scope ? { secret: 'do-not-expose' } : routeData(),
					),
			})
			await expect(
				loaders.loader(loaderArgs('https://example.com/articles/one')),
			).rejects.toBeInstanceOf(Response)
			expect(fetch).not.toHaveBeenCalled()
			expect(onFailure).toHaveBeenCalledWith(
				expect.objectContaining({ source: 'cache' }),
			)
		},
	)

	it('caches raw data so non-idempotent transforms and mutations do not accumulate', async () => {
		const raw = { ...routeData(), title: 'One' }
		const fetch = vi.fn((query: string) =>
			query === sanityRouteDataQuery ? routeData() : raw,
		)
		const values = new Map<string, unknown>()
		const decoder = createZodDecoder(
			z.object({
				_type: z.literal('article'),
				title: z.string().transform((title) => `${title}!`),
			}),
		)
		const loaders = createSanityLoaders({
			routes: { types: ['article'] },
			kit: createKit(false, fetch),
			loaders: [
				defineSanityLoader({
					type: 'article',
					query: articleLoader.query,
					decoder,
					previewDecoder: decoder,
					mutate: (data) => ({ ...data, title: `${data.title}?` }),
				}),
			],
			cache: async ({ key }, load) => {
				if (!values.has(key))
					values.set(key, JSON.parse(JSON.stringify(await load())) as unknown)
				return values.get(key)
			},
		})
		for (let count = 0; count < 2; count++) {
			await expect(
				loaders.loader(loaderArgs('https://example.com/articles/one')),
			).resolves.toEqual({ _type: 'article', title: 'One!?' })
		}
		expect(values.get('SANITY_ROUTE:/articles/one')).toEqual(raw)
		expect(fetch).toHaveBeenCalledTimes(2)
	})

	it('rejects a raw type mismatch before storing even when a decoder manufactures the expected type', async () => {
		const writes: string[] = []
		const loaders = createSanityLoaders({
			routes: { types: ['article'] },
			kit: createKit(
				false,
				vi.fn((query: string) =>
					query === sanityRouteDataQuery ? routeData() : { _type: 'wrong' },
				),
			),
			loaders: [
				defineSanityLoader({
					type: 'article',
					query: articleLoader.query,
					decoder: createZodDecoder(
						z.unknown().transform(() => ({ _type: 'article' as const })),
					),
				}),
			],
			cache: async ({ scope }, load) => {
				const raw = await load()
				writes.push(scope)
				return raw
			},
		})
		await expect(
			loaders.loader(loaderArgs('https://example.com/articles/one')),
		).rejects.toBeInstanceOf(Response)
		expect(writes).toEqual(['route-data'])
	})

	it('uses normalized args.url for lookup, cache keys, and callbacks', async () => {
		const fetch = vi.fn((query: string) =>
			query === sanityRouteDataQuery
				? routeData()
				: { ...routeData(), title: 'One' },
		)
		const args = loaderArgs('https://example.com/articles/one.data?x=1')
		args.url = new URL('https://example.com/articles/one?x=1')
		const params = vi.fn(() => ({}))
		const cacheKey = vi.fn(({ url }: { url: URL }) => url.pathname + url.search)
		const loaders = createSanityLoaders({
			routes: { types: ['article'] },
			kit: createKit(false, fetch),
			loaders: [{ ...articleLoader, params, cacheKey }],
		})
		await loaders.loader(args)
		expect(fetch).toHaveBeenNthCalledWith(
			1,
			sanityRouteDataQuery,
			{ pathname: '/articles/one' },
			expect.anything(),
		)
		expect(params).toHaveBeenCalledWith(
			expect.objectContaining({ url: args.url }),
		)
		expect(cacheKey).toHaveBeenCalledWith(
			expect.objectContaining({ url: args.url }),
		)
	})

	it('decodes tolerant drafts with original Stega strings and reports strict diagnostics', async () => {
		const raw = stegaEncodeSourceMap(
			{ ...routeData(), title: 'Draft' },
			{
				documents: [{ _id: 'article-1', _type: 'article' }],
				paths: ["$['title']"],
				mappings: {
					"$['title']": {
						type: 'value',
						source: { type: 'documentValue', document: 0, path: 0 },
					},
				},
			},
			{ enabled: true, studioUrl: 'https://studio.example.com' },
		)
		expect(raw.title).not.toBe('Draft')
		expect(stegaClean(raw.title)).toBe('Draft')
		const strictSchema = z.object({
			_type: z.literal('article'),
			title: z.string(),
			requiredForPublish: z.string(),
		})
		const previewSchema = strictSchema.partial({ requiredForPublish: true })
		const onFailure = vi.fn()
		const cache = vi.fn<SanityLoaderCache>()
		const previewDecoder = createZodDecoder(previewSchema)
		const draftDecode = vi.spyOn(previewDecoder, 'decode')
		const definition = defineSanityLoader({
			type: 'article',
			query: articleLoader.query,
			decoder: createZodDecoder(strictSchema),
			previewDecoder,
			mutate(data) {
				expectTypeOf(data).toEqualTypeOf<
					z.output<typeof strictSchema> | z.output<typeof previewSchema>
				>()
				return data
			},
		})
		const loaders = createSanityLoaders({
			routes: { types: ['article'] },
			kit: createKit(
				true,
				vi.fn((query: string) =>
					query === sanityRouteDataQuery ? routeData() : raw,
				),
			),
			loaders: [definition],
			cache,
			validation: { onFailure },
		})
		const result = await loaders.loader(
			loaderArgs('https://example.com/articles/one'),
		)
		expect(result.title).toBe(raw.title)
		expect(result.requiredForPublish).toBeUndefined()
		expectTypeOf(result).toEqualTypeOf<
			z.output<typeof strictSchema> | z.output<typeof previewSchema>
		>()
		expect(draftDecode).toHaveBeenCalledWith(raw)
		expect(onFailure).toHaveBeenCalledOnce()
		expect(onFailure).toHaveBeenCalledWith(
			expect.objectContaining({
				preview: true,
				stage: 'published',
				source: 'fetch',
			}),
		)
		expect(cache).not.toHaveBeenCalled()
	})

	it('does not claim unvalidated drafts satisfy the published decoder type', () => {
		const loaders = createSanityLoaders({
			routes: { types: ['article'] },
			kit: createKit(true, vi.fn()),
			loaders: [articleLoader],
		})
		expectTypeOf(loaders.loader).returns.resolves.toEqualTypeOf<
			Article | SanityRoutable<'article'>
		>()
		const inline = createSanityLoaders({
			routes: { types: ['article'] },
			kit: createKit(true, vi.fn()),
			loaders: [
				defineSanityLoader({
					type: 'article',
					query: articleLoader.query,
					decoder: articleDecoder,
				}),
			],
		})
		expectTypeOf(inline.loader).returns.resolves.toEqualTypeOf<
			Article | SanityRoutable<'article'>
		>()
		const direct = createSanityLoaders({
			routes: { types: ['article'] },
			kit: createKit(true, vi.fn()),
			loaders: [
				{
					type: 'article',
					query: articleLoader.query,
					decoder: articleDecoder,
				},
			],
		})
		expectTypeOf(direct.loader).returns.resolves.not.toBeAny()
	})

	it('fails closed when the preview decoder rejects an invalid draft', async () => {
		const onFailure = vi.fn()
		const loaders = createSanityLoaders({
			routes: { types: ['article'] },
			kit: createKit(
				true,
				vi.fn((query: string) =>
					query === sanityRouteDataQuery
						? routeData()
						: { ...routeData(), title: null },
				),
			),
			loaders: [
				defineSanityLoader({
					type: 'article',
					query: articleLoader.query,
					decoder: articleDecoder,
					previewDecoder: articleDecoder,
				}),
			],
			validation: { onFailure },
		})
		const error = await loaders
			.loader(loaderArgs('https://example.com/articles/one'))
			.catch((cause: unknown) => cause)
		await expect((error as Response).json()).resolves.toEqual({
			code: 'SANITY_PREVIEW_INVALID',
			message: 'Unable to load Sanity content.',
		})
		expect(
			onFailure.mock.calls.map(
				([failure]) => (failure as { stage: string }).stage,
			),
		).toEqual(['published', 'preview'])
	})

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
					previewDecoder: articleDecoder,
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
			message: 'Unable to load Sanity content.',
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
