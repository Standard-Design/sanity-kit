import { evaluate, parse } from 'groq-js'
import { describe, expect, it } from 'vitest'
import {
	createPagesRegistry,
	pageSlug,
	registeredPathname,
	storedPagePathname,
	validatePagesSchema,
	type PagesRouteConfig,
} from '../../src/studio/pages/registry.js'
import {
	createBrowserModel,
	type PageDocument,
} from '../../src/studio/pages/model.js'
import { createNavigationQueries } from '../../src/studio/pages/queries.js'
import {
	pageLocationResolvers,
	pageMainDocuments,
} from '../../src/studio/pages/resolvers.js'
import type { PageQueryPlan } from '../../src/studio/pages/data-source.js'

const config = {
	pages: [{ schemaType: 'page', pathnameField: 'path' }],
	collections: [
		{
			name: 'journal',
			title: 'Journal',
			routePrefix: '/journal',
			overview: { schemaType: 'page', pathname: '/journal' },
			items: [
				{
					schemaType: 'post',
					slugField: 'slug.current',
					titleField: 'heading',
				},
				{ schemaType: 'legacy', pathnameField: 'path' },
			],
		},
	],
	excludePaths: ['/journal/private'],
} satisfies PagesRouteConfig
const registry = createPagesRegistry(config)
const model = createBrowserModel(registry)
const queries = createNavigationQueries(registry)
const post = {
	_id: 'post-1',
	_type: 'post',
	heading: 'First post',
	slug: { current: 'first-post' },
	_updatedAt: '2026-10-30T00:00:00Z',
}
const dataset = [
	{ _id: 'overview', _type: 'page', title: 'Journal', path: '/journal' },
	post,
	{
		_id: 'legacy-1',
		_type: 'legacy',
		title: 'Legacy',
		path: '/journal/archive/story',
		_updatedAt: post._updatedAt,
	},
]
async function read<T>(
	plan: PageQueryPlan,
	documents: object[] = dataset,
): Promise<T> {
	return (
		await evaluate(parse(plan.query), {
			dataset: documents,
			params: plan.params,
		})
	).get() as Promise<T>
}
function lookup(path: string) {
	return pageMainDocuments(registry)[0]!.resolve!({
		path,
		origin: 'https://preview.test',
		params: {},
	})
}

describe('Collection slug storage', () => {
	it('copies the opted-in storage mapping without changing existing full-path types', () => {
		const mutable = structuredClone(config)
		const snapshot = createPagesRegistry(mutable)
		mutable.collections[0]!.items[0]!.slugField = 'changed'
		expect(snapshot.types[1]).toMatchObject({
			pathField: 'slug.current',
			pathMode: 'slug',
			routePrefix: '/journal',
		})
		expect(snapshot.collections[0]?.items[0]).toMatchObject({
			slugField: 'slug.current',
		})
		expect(Object.isFrozen(snapshot.collections[0]?.items[0])).toBe(true)
		expect(snapshot.types[2]).toMatchObject({
			pathField: 'path',
			pathMode: 'pathname',
		})
	})
	it.each(['first-post', 'Capitalized', 'caf%C3%A9', 'a.b', 'with%20space'])(
		'keeps a valid segment unchanged: %s',
		(value) => {
			expect(pageSlug(value)).toBe(value)
			expect(storedPagePathname(registry, registry.types[1]!, value)).toBe(
				`/journal/${value}`,
			)
		},
	)
	it.each([
		undefined,
		null,
		42,
		'',
		'/first-post',
		'nested/post',
		'post/',
		'nested//post',
		'.',
		'..',
		'%2e',
		'%2e%2e',
		'a%2Fb',
		'a%5Cb',
		'a\\b',
		'a?b',
		'a#b',
		'a b',
		'a\n',
		'%00',
		'%7f',
		'%FF',
		'%zz',
	])('rejects invalid or nested slug %j without repairing it', (value) => {
		expect(pageSlug(value)).toBeUndefined()
		expect(
			storedPagePathname(registry, registry.types[1]!, value),
		).toBeUndefined()
	})
	it('enforces exclusions, prefix boundaries, and one-segment item URLs', () => {
		for (const path of [
			'/journal',
			'/journal/',
			'/journal/private',
			'/journalism/post',
			'/journal/a/b',
		])
			expect(registeredPathname(registry, 'post', path)).toBeUndefined()
		expect(registeredPathname(registry, 'legacy', '/journal/a/b')).toBe(
			'/journal/a/b',
		)
	})
	it('projects full URLs for recent items, browsing, search, and edited-document identity', async () => {
		const recent = await read<{ documents: PageDocument[]; total: number }>(
			queries.recent('journal'),
		)
		expect(recent.total).toBe(2)
		expect(
			recent.documents.find((item) => item._id === post._id),
		).toMatchObject({ title: 'First post', pathname: '/journal/first-post' })
		for (const search of ['first-post', '/journal/first', 'FIRST POST']) {
			const documents = await read<PageDocument[]>(
				queries.collection('journal', search),
			)
			expect(documents.map((item) => item._id)).toEqual([post._id])
		}
		expect(
			await read<PageDocument[]>(model.documentQuery(post._id, 'post')!),
		).toMatchObject([{ pathname: '/journal/first-post' }])
	})
	it('queries the stored slug directly for reverse lookup and header identity', async () => {
		const native = lookup('/journal/first-post')!
		expect(native.filter).toContain('@["slug"]["current"] == $slug')
		expect(native.filter).not.toContain(' + ')
		expect(
			await read({
				query: `*[${native.filter}][0]{_id}`,
				params: native.params ?? {},
			}),
		).toEqual({ _id: post._id })
		const documents = await read<PageDocument[]>(
			model.previewQuery('/journal/first-post')!,
		)
		expect(model.previewedDocument(documents, '/journal/first-post')?._id).toBe(
			post._id,
		)
	})
	it.each(['post', 'page', 'legacy'])(
		'detects a duplicate URL claimed by %s storage',
		async (type) => {
			const collision = {
				_id: 'duplicate',
				_type: type,
				slug: { current: 'first-post' },
				path: '/journal/first-post',
			}
			const documents = [...dataset, collision]
			const native = lookup('/journal/first-post')!
			expect(
				await read(
					{ query: `*[${native.filter}][0]{_id}`, params: native.params ?? {} },
					documents,
				),
			).toBeNull()
			const candidates = await read<PageDocument[]>(
				model.previewQuery('/journal/first-post')!,
				documents,
			)
			expect(
				model.previewedDocument(candidates, '/journal/first-post'),
			).toBeUndefined()
		},
	)
	it('uses the stored slug for native location links and keeps invalid items editable', async () => {
		const locations = pageLocationResolvers(registry)
		expect(locations.post?.select).toEqual({
			title: 'heading',
			pathname: 'slug.current',
		})
		expect(
			locations.post?.resolve({ title: 'First post', pathname: 'first-post' }),
		).toEqual({
			locations: [{ title: 'First post', href: '/journal/first-post' }],
		})
		for (const value of ['', 'nested/post', '/first-post', 'private'])
			expect(
				locations.post?.resolve({ title: 'Bad', pathname: value }),
			).toMatchObject({ locations: [], tone: 'caution' })
		const items = await read<PageDocument[]>(queries.collection('journal'), [
			{ ...post, slug: { current: 'nested/post' } },
		])
		expect(items).toMatchObject([{ _id: post._id, pathname: null }])
		expect(model.documentPath(items[0]!)).toBeUndefined()
	})
	it.each([
		{
			pages: [{ schemaType: 'page', slugField: 'slug.current' }],
			collections: [],
		},
		{
			collections: [
				{
					...config.collections[0],
					items: [
						{
							schemaType: 'post',
							slugField: 'slug.current',
							pathnameField: 'path',
						},
					],
				},
			],
		},
		{
			collections: [
				{
					...config.collections[0],
					items: [{ schemaType: 'post', slugField: 'slug[0]' }],
				},
			],
		},
		{
			collections: [
				{ ...config.collections[0], items: [{ schemaType: 'post' }] },
			],
		},
		{
			collections: [
				{ ...config.collections[0], routePrefix: '/journal//nested' },
			],
		},
	])('rejects unsupported or ambiguous configuration %#', (override) => {
		expect(() =>
			createPagesRegistry({
				...config,
				...override,
			} as unknown as PagesRouteConfig),
		).toThrow()
	})
	it('checks that the configured slug field actually resolves to a string in Studio', () => {
		const string = { jsonType: 'string' }
		const schema = (valid: boolean) => ({
			get: () => ({
				type: { name: 'document' },
				jsonType: 'object',
				fields: [
					...['title', 'heading', 'path'].map((name) => ({
						name,
						type: string,
					})),
					{
						name: 'slug',
						type: {
							jsonType: 'object',
							fields: [
								{
									name: 'current',
									type: valid ? string : { jsonType: 'number' },
								},
							],
						},
					},
				],
			}),
		})
		expect(() => validatePagesSchema(registry, schema(true))).not.toThrow()
		expect(() => validatePagesSchema(registry, schema(false))).toThrow(
			'post.slug.current',
		)
	})
})
