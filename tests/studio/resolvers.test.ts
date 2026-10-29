import { evaluate, parse } from 'groq-js'
import { describe, expect, it } from 'vitest'
import type {
	DocumentLocationResolver,
	DocumentResolver,
} from 'sanity/presentation'
import { createPagesRegistry } from '../../src/studio/pages/registry.js'
import {
	createPageResolvers,
	pageLocationResolvers,
	pageMainDocuments,
	pageProjection,
} from '../../src/studio/pages/resolvers.js'

const registry = createPagesRegistry({
	pages: [
		{ schemaType: 'page', pathnameField: 'pathname.current' },
		{ schemaType: 'landing', pathnameField: 'route', titleField: 'heading' },
	],
	collections: [
		{
			name: 'journal',
			title: 'Journal',
			overview: { schemaType: 'page', pathname: '/journal' },
			routePrefix: '/journal',
			items: [{ schemaType: 'post', pathnameField: 'path' }],
		},
	],
	excludePaths: ['/'],
})
const documents = [
	{
		_id: 'about',
		_type: 'page',
		title: 'About',
		pathname: { current: '/about' },
	},
	{ _id: 'home', _type: 'page', title: 'Home', pathname: { current: '/' } },
	{
		_id: 'alternate',
		_type: 'landing',
		heading: 'Alternate',
		route: '/alternate',
	},
	{
		_id: 'journal',
		_type: 'page',
		title: 'Journal',
		pathname: { current: '/journal' },
	},
	{ _id: 'post', _type: 'post', title: 'Post', path: '/journal/post' },
	{ _id: 'incomplete', _type: 'page', title: 'Incomplete' },
]

function lookup(path: string) {
	const resolver = pageMainDocuments(registry)[0]!
	if (!resolver.resolve) throw new Error('Expected generated native resolver')
	return resolver.resolve({ path, origin: 'https://preview.test', params: {} })
}

async function resolveDocument(
	path: string,
	dataset: object[] = documents,
): Promise<unknown> {
	const result = lookup(path)
	if (!result) return undefined
	// This is the query shape Presentation builds from a filter resolver.
	const query = parse(`*[${result.filter}][0]{_id, _type}`)
	const value = await evaluate(query, { dataset, params: result.params ?? {} })
	return value.get()
}

describe('Generated native Presentation resolvers', () => {
	it('treats keyword-like fields as attributes, never GROQ literals', async () => {
		const keywords = createPagesRegistry({
			pages: [
				{ schemaType: 'page', pathnameField: 'true', titleField: 'null' },
			],
		})
		const resolver = pageMainDocuments(keywords)[0]!
		const lookup = resolver.resolve!({
			path: '/keyword',
			origin: 'https://preview.test',
			params: {},
		})!
		const result = await evaluate(
			parse(`*[${lookup.filter}]{${pageProjection(keywords)}}`),
			{
				dataset: [
					{
						_id: 'keyword',
						_type: 'page',
						true: '/keyword',
						null: 'Keyword title',
					},
				],
				params: lookup.params ?? {},
			},
		)
		expect(await result.get()).toEqual([
			{
				_id: 'keyword',
				_type: 'page',
				pathname: '/keyword',
				title: 'Keyword title',
			},
		])
	})
	it.each([
		['/about', 'about', 'page'],
		['/alternate', 'alternate', 'landing'],
		['/journal', 'journal', 'page'],
		['/journal/post', 'post', 'post'],
	])('resolves %s using the registered field', async (path, id, type) => {
		expect(await resolveDocument(path)).toEqual({ _id: id, _type: type })
	})
	it('never submits a lookup for app-owned or invalid URLs', () => {
		expect(lookup('/')).toBeUndefined()
		expect(lookup('//other.test')).toBeUndefined()
		expect(lookup('/with?query')).toBeUndefined()
	})
	it('does not let collection items claim paths outside their prefix', async () => {
		expect(
			await resolveDocument('/outside', [
				{ _id: 'wrong', _type: 'post', path: '/outside' },
			]),
		).toBeNull()
	})
	it('passes path values as parameters, not executable GROQ', async () => {
		const path = '/odd%22quote'
		const result = lookup(path)!
		expect(result.filter).not.toContain(path)
		expect(result.params?.path).toBe(path)
		expect(
			await resolveDocument(path, [
				{ _id: 'odd', _type: 'page', pathname: { current: path } },
			]),
		).toEqual({ _id: 'odd', _type: 'page' })
	})
	it('does not choose an arbitrary document for duplicate URLs', async () => {
		expect(
			await resolveDocument('/about', [
				...documents,
				{ _id: 'duplicate', _type: 'landing', route: '/about' },
			]),
		).toBeNull()
	})
	it('does not let an item replace its overview at the same path', async () => {
		expect(
			await resolveDocument('/journal', [
				...documents,
				{ _id: 'wrong', _type: 'post', path: '/journal' },
			]),
		).toEqual({ _id: 'journal', _type: 'page' })
	})
	it('projects only browser fields with per-type mappings', async () => {
		const query = parse(
			`*[_type in $types] | order(_id asc){${pageProjection(registry)}}`,
		)
		const result = await evaluate(query, {
			dataset: documents,
			params: { types: registry.types.map((type) => type.schemaType) },
		})
		expect(await result.get()).toEqual([
			{ _id: 'about', _type: 'page', title: 'About', pathname: '/about' },
			{
				_id: 'alternate',
				_type: 'landing',
				title: 'Alternate',
				pathname: '/alternate',
			},
			{ _id: 'home', _type: 'page', title: 'Home', pathname: '/' },
			{ _id: 'incomplete', _type: 'page', title: 'Incomplete', pathname: null },
			{ _id: 'journal', _type: 'page', title: 'Journal', pathname: '/journal' },
			{ _id: 'post', _type: 'post', title: 'Post', pathname: '/journal/post' },
		])
	})
	it('shares route exclusions and collection bounds with location links', () => {
		const locations = pageLocationResolvers(registry)
		expect(locations.landing?.select).toEqual({
			title: 'heading',
			pathname: 'route',
		})
		expect(
			locations.page?.resolve({ title: 'About', pathname: '/about' }),
		).toEqual({ locations: [{ title: 'About', href: '/about' }] })
		for (const result of [
			locations.page?.resolve({ title: 'Home', pathname: '/' }),
			locations.post?.resolve({ title: 'Wrong', pathname: '/outside' }),
			locations.page?.resolve(null),
		])
			expect(result).toMatchObject({ locations: [], tone: 'caution' })
		expect(
			locations.landing?.resolve({ title: null, pathname: '/alternate' }),
		).toEqual({ locations: [{ title: 'Untitled', href: '/alternate' }] })
	})
	it('allows explicit main-document replacement, including disabling it', () => {
		const mainDocuments: DocumentResolver[] = [{ route: '/', type: 'settings' }]
		expect(createPageResolvers(registry, { mainDocuments }).mainDocuments).toBe(
			mainDocuments,
		)
		expect(
			createPageResolvers(registry, { mainDocuments: [] }).mainDocuments,
		).toEqual([])
	})
	it('merges location-map overrides and preserves unrelated app resolvers', () => {
		const page = { locations: [{ title: 'App homepage', href: '/' }] }
		const shared = { locations: [{ title: 'About', href: '/about' }] }
		const result = createPageResolvers(registry, {
			locations: { page, shared },
		})
		expect(result.locations).toMatchObject({
			page,
			shared,
			landing: { select: { pathname: 'route' } },
		})
		expect(result.mainDocuments).toHaveLength(1)
	})
	it('preserves a complete native locations callback by identity', () => {
		const locations: DocumentLocationResolver = () => ({ locations: [] })
		expect(createPageResolvers(registry, { locations }).locations).toBe(
			locations,
		)
	})
})
