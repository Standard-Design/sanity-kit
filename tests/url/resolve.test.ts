import { describe, expect, it } from 'vitest'
import { build } from 'esbuild'
import { stegaEncodeSourceMap } from '@sanity/client/stega'
import {
	createSanityUrlResolver,
	type PagesRouteConfig,
	type SanityUrlFailureReason,
} from '../../src/url/index.js'
import {
	createPagesRegistry,
	storedPagePathname,
} from '../../src/studio/pages/registry.js'

const config = {
	pages: [
		{ schemaType: 'page', pathnameField: 'pathname.current' },
		{ schemaType: 'landing', pathnameField: 'url' },
	],
	collections: [
		{
			name: 'journal',
			title: 'Journal',
			routePrefix: '/writing/journal',
			overview: { schemaType: 'page', pathname: '/insights' },
			items: [
				{ schemaType: 'post', slugField: 'slug.current' },
				{ schemaType: 'legacyPost', pathnameField: 'url' },
			],
		},
	],
	excludePaths: ['/private', '/writing/journal/private'],
} satisfies PagesRouteConfig
const resolve = createSanityUrlResolver(config)
const page = (value: unknown) => ({
	_type: 'page',
	pathname: { current: value },
})
const post = (value: unknown) => ({ _type: 'post', slug: { current: value } })

describe('shared URL resolution', () => {
	it.each([
		[page('/'), { pathname: '/', prefix: '/', slug: '' }],
		[page('/about'), { pathname: '/about', prefix: '/', slug: 'about' }],
		[
			page('/about/team'),
			{ pathname: '/about/team', prefix: '/about', slug: 'team' },
		],
		[
			post('first-post'),
			{
				pathname: '/writing/journal/first-post',
				prefix: '/writing/journal',
				slug: 'first-post',
			},
		],
		[
			{ _type: 'legacyPost', url: '/writing/journal/archive/first-post' },
			{
				pathname: '/writing/journal/archive/first-post',
				prefix: '/writing/journal/archive',
				slug: 'first-post',
			},
		],
		[
			page('/caf%C3%A9/with%20space'),
			{
				pathname: '/caf%C3%A9/with%20space',
				prefix: '/caf%C3%A9',
				slug: 'with%20space',
			},
		],
	])('resolves %j without mutating query data', (document, value) => {
		const original = structuredClone(document)
		expect(resolve(document)).toEqual({ ok: true, value })
		expect(document).toEqual(original)
		const registry = createPagesRegistry(config)
		const type = registry.types.find(
			(entry) => entry.schemaType === document._type,
		)!
		const stored = type.pathField
			.split('.')
			.reduce<unknown>(
				(current, part) => (current as Record<string, unknown>)[part],
				document,
			)
		expect(storedPagePathname(registry, type, stored)).toBe(value.pathname)
	})

	it.each<[unknown, SanityUrlFailureReason]>([
		[null, 'missing-document'],
		[undefined, 'missing-document'],
		[42, 'invalid-document'],
		[[], 'invalid-document'],
		[{}, 'invalid-document'],
		[{ _type: '' }, 'invalid-document'],
		[{ _type: 'shared' }, 'unregistered-type'],
		[page(null), 'missing-value'],
		[page(undefined), 'missing-value'],
		[page(''), 'missing-value'],
		[post(''), 'missing-value'],
		[page(4), 'invalid-value'],
		[post({ current: 'nested' }), 'invalid-value'],
		[post('two/segments'), 'invalid-value'],
		[page('/private'), 'disallowed-path'],
		[post('private'), 'disallowed-path'],
		[{ _type: 'landing', url: '/insights' }, 'disallowed-path'],
		[{ _type: 'legacyPost', url: '/elsewhere/post' }, 'disallowed-path'],
		[{ _type: 'legacyPost', url: '/writing/journal' }, 'disallowed-path'],
		[page('/about/'), 'noncanonical-path'],
		[page('/about//team'), 'noncanonical-path'],
	])('reports explicit failure for %j', (document, reason) => {
		expect(resolve(document)).toEqual({ ok: false, reason })
	})

	it.each([
		'https://example.com',
		'//example.com',
		'about',
		'/a b',
		'/a?b',
		'/a#b',
		'/a\\b',
		'/a/../b',
		'/%2e%2e/b',
		'/%2fhost',
		'/%5chost',
		'/%00',
		'/%7f',
		'/bad%zz',
		'/%FF',
		'/a\n',
		'/café',
	])('never repairs an unsafe or ambiguous path %j', (pathname) => {
		expect(resolve(page(pathname))).toEqual({
			ok: false,
			reason: 'invalid-value',
		})
	})

	it('reads own fields only, and does not traverse arrays', () => {
		const inheritedPath: unknown = Object.create({ current: '/about' })
		expect(resolve(Object.create(page('/about')))).toEqual({
			ok: false,
			reason: 'invalid-document',
		})
		expect(
			resolve({
				_type: 'page',
				pathname: inheritedPath,
			}),
		).toEqual({ ok: false, reason: 'missing-value' })
		expect(
			resolve({ _type: 'page', pathname: [{ current: '/about' }] }),
		).toEqual({ ok: false, reason: 'missing-value' })
	})

	it('cleans Stega for URL resolution without altering the render document', () => {
		const document = stegaEncodeSourceMap(
			{ _type: 'post', slug: { current: 'story' }, title: 'Story' },
			{
				documents: [{ _id: 'post-1', _type: 'post' }],
				paths: ["$['slug']['current']", "$['title']"],
				mappings: {
					"$['slug']['current']": {
						type: 'value',
						source: { type: 'documentValue', document: 0, path: 0 },
					},
					"$['title']": {
						type: 'value',
						source: { type: 'documentValue', document: 0, path: 1 },
					},
				},
			},
			{
				enabled: true,
				studioUrl: 'https://studio.example.com',
				filter: () => true,
			},
		)
		expect(document.slug.current).not.toBe('story')
		const before = structuredClone(document)
		expect(resolve(document)).toEqual({
			ok: true,
			value: {
				pathname: '/writing/journal/story',
				prefix: '/writing/journal',
				slug: 'story',
			},
		})
		expect(document).toEqual(before)
	})

	it('snapshots configuration and returns independent results', () => {
		const mutable = structuredClone(config)
		const resolver = createSanityUrlResolver(mutable)
		mutable.collections[0]!.routePrefix = '/changed'
		mutable.excludePaths.push('/writing/journal/post')
		const first = resolver(post('post'))
		if (!first.ok) throw new Error('Expected success')
		Object.assign(first.value, { pathname: '/changed' })
		expect(resolver(post('post'))).toEqual({
			ok: true,
			value: {
				pathname: '/writing/journal/post',
				prefix: '/writing/journal',
				slug: 'post',
			},
		})
	})

	it('throws for invalid registration, not for ordinary bad content', () => {
		expect(() => createSanityUrlResolver({ pages: [] })).toThrow('at least one')
		expect(() =>
			createSanityUrlResolver({
				pages: [{ schemaType: 'page', pathnameField: '__proto__.url' }],
			}),
		).toThrow('dotted field path')
	})

	it('does not claim to establish URL uniqueness', () => {
		expect(resolve({ ...page('/about'), _id: 'first' })).toEqual(
			resolve({ ...page('/about'), _id: 'second' }),
		)
	})

	it('bundles for browsers without Studio, React, or router code', async () => {
		const bundle = await build({
			entryPoints: ['src/url/index.ts'],
			bundle: true,
			write: false,
			platform: 'browser',
			format: 'esm',
			metafile: true,
		})
		for (const path of Object.keys(bundle.metafile.inputs)) {
			expect(path).not.toMatch(/src\/studio\//u)
			expect(path).not.toMatch(
				/node_modules\/(?:sanity|react|react-dom|react-router|@sanity\/ui)\//u,
			)
		}
	})
})
