import { describe, expect, it } from 'vitest'
import {
	assertFieldPath,
	createPagesRegistry,
	pagePathname,
	registeredPathname,
	validatePagesSchema,
	type PageCollectionDefinition,
	type PagesRouteConfig,
} from '../../src/studio/pages/registry.js'

const page = { schemaType: 'page', pathnameField: 'pathname.current' }
const journal: PageCollectionDefinition = {
	name: 'journal',
	title: 'Journal',
	overview: { schemaType: 'page', pathname: '/journal' },
	routePrefix: '/journal',
	items: [
		{ schemaType: 'post', pathnameField: 'url.path', titleField: 'heading' },
	],
}
const config: PagesRouteConfig = { pages: [page], collections: [journal] }

describe('Pages route registration', () => {
	it('preserves explicit plural item labels without guessing from schema names', () => {
		const registry = createPagesRegistry({
			...config,
			collections: [{ ...journal, itemsTitle: 'People' }],
		})
		expect(registry.collections[0]?.itemsTitle).toBe('People')
		expect(
			createPagesRegistry(config).collections[0]?.itemsTitle,
		).toBeUndefined()
	})
	it('copies and freezes configuration without freezing caller-owned objects', () => {
		const input = {
			pages: [{ ...page }],
			collections: [
				{
					...journal,
					overview: { ...journal.overview },
					items: journal.items.map((item) => ({ ...item })),
				},
			],
			excludePaths: ['/private'],
		}
		const registry = createPagesRegistry(input)
		input.pages[0]!.pathnameField = 'changed'
		input.collections[0]!.overview.pathname = '/changed'
		input.collections[0]!.items[0]!.pathnameField = 'changed'
		input.excludePaths.push('/another')
		expect(registry.types[0]).toEqual({
			schemaType: 'page',
			pathField: page.pathnameField,
			pathMode: 'pathname',
			titleField: 'title',
		})
		expect(registry.collections[0]?.overview.pathname).toBe('/journal')
		expect(registry.types[1]?.pathField).toBe('url.path')
		expect(registry.excludePaths).toEqual(['/private'])
		for (const value of [
			registry,
			registry.types,
			registry.types[0],
			registry.collections,
			registry.collections[0],
			registry.collections[0]?.overview,
			registry.collections[0]?.items,
			registry.excludePaths,
		])
			expect(Object.isFrozen(value)).toBe(true)
	})
	it.each([
		[{ pages: [] }, 'at least one'],
		[{ pages: [page, page] }, 'registered more than once'],
		[
			{ ...config, collections: [journal, journal] },
			'Duplicate collection name',
		],
		[{ ...config, collections: [{ ...journal, title: ' ' }] }, 'needs a title'],
		[
			{ ...config, collections: [{ ...journal, itemsTitle: ' ' }] },
			'non-empty itemsTitle',
		],
		[
			{
				...config,
				collections: [{ ...journal, itemsTitle: 42 as unknown as string }],
			},
			'non-empty itemsTitle',
		],
		[
			{ ...config, collections: [{ ...journal, name: '' }] },
			'stable identifier',
		],
		[
			{ ...config, collections: [{ ...journal, items: [] }] },
			'at least one item type',
		],
		[
			{ ...config, collections: [{ ...journal, items: [page] }] },
			'registered more than once',
		],
		[
			{
				...config,
				collections: [
					{
						...journal,
						overview: { schemaType: 'missing', pathname: '/journal' },
					},
				],
			},
			'registered ordinary page type',
		],
		[{ ...config, excludePaths: ['/journal'] }, 'excluded overview'],
		[
			{ ...config, collections: [{ ...journal, routePrefix: '/' }] },
			'non-root',
		],
		[
			{ ...config, collections: [{ ...journal, routePrefix: '/journal/' }] },
			'trailing slash',
		],
		[{ pages: [{ ...page, schemaType: 'bad type' }] }, 'schema identifier'],
		[{ pages: [{ ...page, schemaType: '__proto__' }] }, 'schema identifier'],
		[{ pages: [{ ...page, titleField: 'titles[0]' }] }, 'dotted field path'],
		[{ ...config, excludePaths: ['https://example.test'] }, 'root-relative'],
	] satisfies [PagesRouteConfig, string][])(
		'rejects invalid or ambiguous configuration %#',
		(input, message) => {
			expect(() => createPagesRegistry(input)).toThrow(message)
		},
	)
	it('rejects one item type used by two collections', () => {
		expect(() =>
			createPagesRegistry({
				pages: [page],
				collections: [
					journal,
					{
						...journal,
						name: 'news',
						overview: { schemaType: 'page', pathname: '/news' },
						routePrefix: '/news',
					},
				],
			}),
		).toThrow('registered more than once')
	})
	it('rejects duplicate overview paths even with different page types', () => {
		expect(() =>
			createPagesRegistry({
				pages: [page, { ...page, schemaType: 'landing' }],
				collections: [
					journal,
					{
						...journal,
						name: 'news',
						overview: { schemaType: 'landing', pathname: '/journal' },
						routePrefix: '/news',
						items: [{ ...page, schemaType: 'news' }],
					},
				],
			}),
		).toThrow('Multiple collections claim')
	})
	it.each(['/journal', '/journal/news'])(
		'rejects overlapping collection prefix %s',
		(routePrefix) => {
			expect(() =>
				createPagesRegistry({
					pages: [page],
					collections: [
						journal,
						{
							...journal,
							name: 'news',
							overview: { schemaType: 'page', pathname: '/news' },
							routePrefix,
							items: [{ ...page, schemaType: 'news' }],
						},
					],
				}),
			).toThrow('overlapping routePrefix')
		},
	)
	it('checks prefix boundaries rather than similar text', () => {
		expect(() =>
			createPagesRegistry({
				pages: [page],
				collections: [
					journal,
					{
						...journal,
						name: 'news',
						overview: { schemaType: 'page', pathname: '/journalism' },
						routePrefix: '/journalism',
						items: [{ ...page, schemaType: 'news' }],
					},
				],
			}),
		).not.toThrow()
	})
	it.each([
		'',
		'path[0]',
		'reference->path',
		'coalesce(path, route)',
		'path || true',
		'a..b',
		'__proto__.path',
		'constructor.name',
		'x.prototype.path',
	])('rejects query expressions or unsafe field path %s', (field) => {
		expect(() => assertFieldPath(field, 'pathnameField')).toThrow(
			'dotted field path',
		)
	})
})

describe('Pages pathname policy', () => {
	it.each(['/', '/nested/page', '/about/', '/caf%C3%A9', '/with%20space'])(
		'keeps a valid authored path unchanged: %s',
		(path) => {
			expect(pagePathname(path)).toBe(path)
		},
	)
	it.each([
		null,
		undefined,
		1,
		'',
		'about',
		'//host',
		'https://host/path',
		'/a\\b',
		'/a b',
		'/a?b',
		'/a#b',
		'/a/../b',
		'/%2e%2e/b',
		'/bad%zz',
		'/%FF',
		'/%2Fhost',
		'/a%5Cb',
		'/%00',
		'/%7f',
		'/a\u007f',
		'/a\n',
	])('rejects invalid or ambiguous URL %j', (path) => {
		expect(pagePathname(path)).toBeUndefined()
	})
	it('does not mistake unrelated or excluded documents for pages', () => {
		const registry = createPagesRegistry({ ...config, excludePaths: ['/'] })
		expect(registeredPathname(registry, 'page', '/')).toBeUndefined()
		expect(registeredPathname(registry, 'page', '/about')).toBe('/about')
		expect(registeredPathname(registry, 'shared', '/about')).toBeUndefined()
		expect(registeredPathname(registry, 'page', null)).toBeUndefined()
	})
	it('limits collection items to descendants and reserves overview paths', () => {
		const registry = createPagesRegistry({
			pages: [page, { ...page, schemaType: 'landing' }],
			collections: [journal],
		})
		expect(registeredPathname(registry, 'page', '/journal')).toBe('/journal')
		expect(registeredPathname(registry, 'landing', '/journal')).toBeUndefined()
		expect(registeredPathname(registry, 'post', '/journal')).toBeUndefined()
		expect(registeredPathname(registry, 'post', '/journal/')).toBeUndefined()
		expect(
			registeredPathname(registry, 'post', '/journalism/post'),
		).toBeUndefined()
		expect(registeredPathname(registry, 'post', '/journal/post')).toBe(
			'/journal/post',
		)
	})
})

describe('Compiled Studio schema validation', () => {
	const string = { jsonType: 'string' }
	const object = (fields: unknown[]) => ({ jsonType: 'object', fields })
	const document = {
		...object([
			{ name: 'title', type: string },
			{ name: 'pathname', type: object([{ name: 'current', type: string }]) },
		]),
		type: { name: 'document' },
	}
	const registry = createPagesRegistry({ pages: [page] })
	it('accepts a document with string fields reached through objects', () => {
		expect(() =>
			validatePagesSchema(registry, { get: () => document }),
		).not.toThrow()
	})
	it.each([undefined, { ...document, type: { name: 'object' } }])(
		'rejects an absent or non-document schema',
		(value) => {
			expect(() => validatePagesSchema(registry, { get: () => value })).toThrow(
				'must be a document',
			)
		},
	)
	it.each([
		{ fields: [] },
		{
			fields: [
				{ name: 'title', type: string },
				{ name: 'pathname', type: { jsonType: 'array' } },
			],
		},
		{
			fields: [
				{ name: 'title', type: string },
				{
					name: 'pathname',
					type: object([{ name: 'current', type: { jsonType: 'number' } }]),
				},
			],
		},
	])('rejects missing, array, or non-string paths %#', ({ fields }) => {
		expect(() =>
			validatePagesSchema(registry, { get: () => ({ ...document, fields }) }),
		).toThrow('must resolve to a string')
	})
})
