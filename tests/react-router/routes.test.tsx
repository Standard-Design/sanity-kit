import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, expectTypeOf, it } from 'vitest'
import {
	createSanityRoutes,
	defineSanityRoute,
	sanityRouteDataDecoder,
	sanityRouteDataQuery,
	sanityRouteDataQueryFragment,
} from '../../src/react-router/index.js'

interface Article {
	_id: string
	_type: 'article'
	title: string
}

interface LandingPage {
	_id: string
	_type: 'landingPage'
	title: string
}

function ArticleView({ data }: { data: Article }) {
	return <article>{data.title}</article>
}

function LandingPageView({ data }: { data: LandingPage }) {
	return <main>{data.title}</main>
}

const routes = createSanityRoutes({
	extraLinkableTypes: ['externalProduct'] as const,
	layout: ({ children }) => <div data-layout="page">{children}</div>,
	defaultMeta: (data) => [{ title: `Default: ${data.title}` }],
	routes: [
		defineSanityRoute({
			type: 'article',
			component: ArticleView,
			meta: (data) => [{ title: data.title }],
		}),
		defineSanityRoute({
			type: 'landingPage',
			component: LandingPageView,
			linkable: false,
		}),
	] as const,
})

type RegisteredRouteType = (typeof routes.types)[number]
type RegisteredLinkableType = (typeof routes.linkableTypes)[number]

describe('createSanityRoutes', () => {
	it('dispatches a registered component through the optional layout', () => {
		const html = renderToStaticMarkup(
			routes.default({
				loaderData: {
					_id: 'article-1',
					_type: 'article',
					title: 'Typed routing',
				},
			}),
		)

		expect(html).toBe(
			'<div data-layout="page"><article>Typed routing</article></div>',
		)
	})

	it('dispatches route metadata and falls back for registered types', () => {
		expect(
			routes.meta({
				loaderData: {
					_id: 'article-1',
					_type: 'article',
					title: 'Article title',
				},
			}),
		).toEqual([{ title: 'Article title' }])

		expect(
			routes.meta({
				loaderData: {
					_id: 'landing-1',
					_type: 'landingPage',
					title: 'Landing title',
				},
			}),
		).toEqual([{ title: 'Default: Landing title' }])
		expect(routes.meta({ loaderData: undefined })).toEqual([])
	})

	it('exposes immutable runtime route and linkable type registries', () => {
		expect(routes.types).toEqual(['article', 'landingPage'])
		expect(routes.linkableTypes).toEqual(['article', 'externalProduct'])
		expect(Object.isFrozen(routes.types)).toBe(true)
		expect(Object.isFrozen(routes.linkableTypes)).toBe(true)
		expectTypeOf<RegisteredRouteType>().toEqualTypeOf<
			'article' | 'landingPage'
		>()
		expectTypeOf<RegisteredLinkableType>().toEqualTypeOf<
			'article' | 'externalProduct'
		>()
	})

	it('rejects empty and duplicate route registries', () => {
		expect(() => createSanityRoutes({ routes: [] })).toThrow(
			'At least one Sanity route is required',
		)
		expect(() =>
			createSanityRoutes({
				routes: [
					defineSanityRoute({ type: 'article', component: ArticleView }),
					defineSanityRoute({ type: 'article', component: ArticleView }),
				],
			}),
		).toThrow('Duplicate route type registered: "article"')
	})

	it('rejects contradictory linkability configuration', () => {
		expect(() =>
			createSanityRoutes({
				extraLinkableTypes: ['landingPage'],
				routes: [
					defineSanityRoute({
						type: 'landingPage',
						component: LandingPageView,
						linkable: false,
					}),
				],
			}),
		).toThrow(
			'Route type "landingPage" cannot be both non-linkable and an extra linkable type',
		)
	})

	it('fails clearly for missing loader data and unknown document types', () => {
		expect(() => routes.default({ loaderData: undefined })).toThrow(
			'rendered without `loaderData`',
		)
		expect(() =>
			routes.default({
				loaderData: {
					_id: 'unknown-1',
					_type: 'unknown',
					title: 'Unknown',
				} as never,
			}),
		).toThrow('No route registered for _type "unknown"')
		expect(() =>
			routes.default({ loaderData: { _type: '' } as never }),
		).toThrow('must contain a non-empty `_type`')
	})
})

describe('Sanity route data primitives', () => {
	it('defines a TypeGen-compatible pathname lookup query', () => {
		expect(sanityRouteDataQuery).toContain(
			'*[pathname.current == $pathname][0]',
		)
		expect(sanityRouteDataQuery).toContain(sanityRouteDataQueryFragment.trim())
	})

	it('decodes valid route data without retaining unrelated fields', async () => {
		const result = await sanityRouteDataDecoder.decode({
			_id: 'article-1',
			_type: 'article',
			pathname: '/articles/typed-routing',
			secret: 'not retained',
		})

		expect(result).toEqual({
			success: true,
			value: {
				_id: 'article-1',
				_type: 'article',
				pathname: '/articles/typed-routing',
			},
			diagnostics: [],
		})
	})

	it.each([
		[null, []],
		[{ _id: '', _type: 'article', pathname: '/article' }, ['_id']],
		[{ _id: 'article-1', _type: 'article', pathname: 'article' }, ['pathname']],
	])(
		'returns structured diagnostics for invalid route data',
		async (input, path) => {
			const result = await sanityRouteDataDecoder.decode(input)

			expect(result.success).toBe(false)
			if (!result.success) {
				expect(result.diagnostics[0]).toMatchObject({
					code: 'ROUTE_DATA_INVALID',
					path,
					source: 'sanity-route-data',
				})
			}
		},
	)
})
