import { describe, expect, it, vi } from 'vitest'
import { stegaEncodeSourceMap } from '@sanity/client/stega'
import speakingurl from 'speakingurl'
import { createUrlAuthoring, generateUrlSlug } from '../../src/url/authoring.js'
import {
	createSanityUrlResolver,
	type PagesRouteConfig,
} from '../../src/url/index.js'

const config = {
	pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
	collections: [
		{
			name: 'journal',
			title: 'Journal',
			routePrefix: '/journal',
			overview: { schemaType: 'page', pathname: '/insights' },
			items: [
				{ schemaType: 'post', slugField: 'slug.current' },
				{ schemaType: 'legacy', pathnameField: 'url' },
			],
		},
	],
	excludePaths: ['/private', '/journal/private'],
} satisfies PagesRouteConfig
const authoring = createUrlAuthoring(config)

describe('URL authoring candidates', () => {
	it('rejects noncanonical fixed configuration rather than changing it', () => {
		const legacyConfig = {
			...config,
			collections: [
				{
					...config.collections[0]!,
					routePrefix: '/journal//archive',
					items: [{ schemaType: 'legacy', pathnameField: 'url' }],
				},
			],
		}
		expect(() => createUrlAuthoring(legacyConfig)).toThrow(
			'canonical collection prefix',
		)
		expect(legacyConfig.collections[0]?.routePrefix).toBe('/journal//archive')
	})

	it('cleans Stega in candidates without stripping the render document', async () => {
		const document = stegaEncodeSourceMap(
			{
				_type: 'page',
				pathname: { current: '/about//team/' },
				title: 'Team Page',
			},
			{
				documents: [{ _id: 'page-1', _type: 'page' }],
				paths: ["$['pathname']['current']", "$['title']"],
				mappings: {
					"$['pathname']['current']": {
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
		const before = structuredClone(document)
		expect(document.title).not.toBe('Team Page')
		expect(
			authoring.prepareStored('page', document.pathname.current),
		).toMatchObject({ ok: true, value: { storedValue: '/about/team' } })
		expect(await generateUrlSlug(document.title)).toEqual({
			ok: true,
			value: 'team-page',
		})
		expect(document).toEqual(before)
	})
	it.each(['_type', '_id', '_rev', '_createdAt', '_updatedAt', '_system.path'])(
		'refuses authoring through document metadata %s',
		(pathnameField) => {
			expect(() =>
				createUrlAuthoring({ pages: [{ schemaType: 'page', pathnameField }] }),
			).toThrow('cannot target document metadata')
		},
	)
	it.each([
		['/', '/', '/', ''],
		['/about/', '/about', '/', 'about'],
		['/about//team///', '/about/team', '/about', 'team'],
		['/about/company', '/about/company', '/about', 'company'],
		['/caf%C3%A9//team/', '/caf%C3%A9/team', '/caf%C3%A9', 'team'],
	])(
		'prepares only separator cleanup for %s',
		(stored, pathname, prefix, slug) => {
			expect(authoring.prepareStored('page', stored)).toEqual({
				ok: true,
				value: {
					url: { pathname, prefix, slug },
					fieldPath: 'pathname.current',
					storedValue: pathname,
				},
			})
		},
	)

	it('returns the correct stored string for each mode', () => {
		const parts = { prefix: '/journal', slug: 'story' }
		expect(authoring.prepareParts('post', parts)).toEqual({
			ok: true,
			value: {
				url: { pathname: '/journal/story', prefix: '/journal', slug: 'story' },
				fieldPath: 'slug.current',
				storedValue: 'story',
			},
		})
		expect(authoring.prepareParts('legacy', parts)).toEqual({
			ok: true,
			value: {
				url: { pathname: '/journal/story', prefix: '/journal', slug: 'story' },
				fieldPath: 'url',
				storedValue: '/journal/story',
			},
		})
		expect(parts).toEqual({ prefix: '/journal', slug: 'story' })
	})

	it('normalizes a page folder before joining its final segment', () => {
		expect(
			authoring.prepareParts('page', {
				prefix: '/about//company/',
				slug: 'team',
			}),
		).toMatchObject({ ok: true, value: { storedValue: '/about/company/team' } })
		expect(
			authoring.prepareParts('post', { prefix: '/journal/', slug: 'story' }),
		).toMatchObject({ ok: true, value: { storedValue: 'story' } })
	})

	it('supports root, and supplies index-page paths through whole-value preparation', () => {
		expect(
			authoring.prepareParts('page', { prefix: '/', slug: '' }),
		).toMatchObject({
			ok: true,
			value: { url: { pathname: '/', prefix: '/', slug: '' } },
		})
		expect(
			authoring.prepareParts('page', { prefix: '/about', slug: '' }),
		).toEqual({ ok: false, reason: 'missing-slug' })
		expect(authoring.prepareStored('page', '/about')).toMatchObject({
			ok: true,
			value: { url: { pathname: '/about', prefix: '/', slug: 'about' } },
		})
	})

	it.each([
		'about',
		'//host',
		'///',
		'/a?b',
		'/a#b',
		'/a\\b',
		'/a b',
		'/a/../b',
		'/%2e/b',
		'/%2fhost',
		'/%5chost',
		'/%00',
		'/%7f',
		'/bad%zz',
		'/%FF',
		'/café',
		' /about/',
		'/about/ ',
	])('does not repair unsafe whole values %j', (value) => {
		expect(authoring.prepareStored('page', value)).toEqual({
			ok: false,
			reason: 'invalid-value',
		})
	})

	it.each([
		'story/',
		'/story',
		'two//segments',
		'two/segments',
		'../story',
		'story?x',
		'story#x',
		'story\\x',
		' story ',
	])('does not apply pathname cleanup to a collection slug %j', (value) => {
		expect(authoring.prepareStored('post', value)).toEqual({
			ok: false,
			reason: 'invalid-value',
		})
		expect(
			authoring.prepareParts('post', { prefix: '/journal', slug: value }),
		).toEqual({ ok: false, reason: 'invalid-value' })
	})

	it.each(['/blog', '/journal/archive', '/', '/journalish'])(
		'keeps the slug-only prefix locked: %s',
		(prefix) => {
			expect(authoring.prepareParts('post', { prefix, slug: 'story' })).toEqual(
				{ ok: false, reason: 'locked-prefix' },
			)
		},
	)

	it('retains nested full-path collection folders but prevents leaving the collection', () => {
		expect(
			authoring.prepareParts('legacy', {
				prefix: '/journal/archive',
				slug: 'story',
			}),
		).toMatchObject({
			ok: true,
			value: { storedValue: '/journal/archive/story' },
		})
		expect(
			authoring.prepareParts('legacy', {
				prefix: '/journalish/archive',
				slug: 'story',
			}),
		).toEqual({ ok: false, reason: 'locked-prefix' })
	})

	it('applies ownership and exclusions after cleanup', () => {
		expect(authoring.prepareStored('page', '/private/')).toEqual({
			ok: false,
			reason: 'disallowed-path',
		})
		expect(
			authoring.prepareParts('post', { prefix: '/journal', slug: 'private' }),
		).toEqual({ ok: false, reason: 'disallowed-path' })
		expect(authoring.prepareStored('legacy', '/insights')).toEqual({
			ok: false,
			reason: 'disallowed-path',
		})
		expect(authoring.prepareStored('legacy', '/elsewhere/story')).toEqual({
			ok: false,
			reason: 'disallowed-path',
		})
	})

	it('distinguishes missing and invalid inputs', () => {
		for (const value of [undefined, null, ''])
			expect(authoring.prepareStored('page', value)).toEqual({
				ok: false,
				reason: 'missing-value',
			})
		for (const value of [0, {}, []])
			expect(authoring.prepareStored('page', value)).toEqual({
				ok: false,
				reason: 'invalid-value',
			})
		expect(
			authoring.prepareParts('page', { prefix: 'about', slug: 'team' }),
		).toEqual({ ok: false, reason: 'invalid-prefix' })
		expect(authoring.prepareStored('shared', '/')).toEqual({
			ok: false,
			reason: 'unregistered-type',
		})
		expect(
			authoring.prepareParts('shared', { prefix: '/', slug: 'story' }),
		).toEqual({ ok: false, reason: 'unregistered-type' })
		for (const slug of ['', null, undefined])
			expect(
				authoring.prepareParts('post', { prefix: '/journal', slug }),
			).toEqual({ ok: false, reason: 'missing-slug' })
	})

	it('does not change read-time resolution or documents', () => {
		const document = { _type: 'page', pathname: { current: '/about//team/' } }
		expect(createSanityUrlResolver(config)(document)).toEqual({
			ok: false,
			reason: 'noncanonical-path',
		})
		expect(
			authoring.prepareStored('page', document.pathname.current),
		).toMatchObject({ ok: true, value: { storedValue: '/about/team' } })
		expect(document.pathname.current).toBe('/about//team/')
	})

	it('snapshots configuration without changing the caller registration', () => {
		const mutable = structuredClone(config)
		const tools = createUrlAuthoring(mutable)
		mutable.collections[0]!.routePrefix = '/blog'
		expect(tools.prepareStored('post', 'story')).toMatchObject({
			ok: true,
			value: { url: { pathname: '/journal/story' } },
		})
	})

	it('keeps internal authoring APIs out of the public entry point', async () => {
		const api = await import('../../src/url/index.js')
		expect('createUrlAuthoring' in api).toBe(false)
		expect('generateUrlSlug' in api).toBe(false)
	})
})

describe('Sanity-compatible slug generation', () => {
	it.each([
		['Hello World', 'hello-world'],
		['  Hello, world!  ', 'hello-world'],
		['Hello___world / again', 'hello___world-again'],
		['already-slugged', 'already-slugged'],
		['Café', 'cafe'],
		['Cafe\u0301', 'cafe'],
		['Research & Development', 'research-and-development'],
		['100% Ready', '100-ready'],
	])('matches native default output for %j', async (source, value) => {
		expect(await generateUrlSlug(source)).toEqual({ ok: true, value })
		expect(authoring.prepareStored('post', value).ok).toBe(true)
	})

	it.each([undefined, null, ''])(
		'reports missing source %j',
		async (source) => {
			expect(await generateUrlSlug(source)).toEqual({
				ok: false,
				reason: 'missing-source',
			})
		},
	)
	it.each([4, {}, []])('rejects non-text source %j', async (source) => {
		expect(await generateUrlSlug(source)).toEqual({
			ok: false,
			reason: 'invalid-source',
		})
	})
	it.each(['---', '🌳', '\u0301', '東京', 'नमस्ते', '   '])(
		'does not invent a slug for %j',
		async (source) => {
			expect(await generateUrlSlug(source)).toEqual({
				ok: false,
				reason: 'invalid-slug',
			})
		},
	)

	it('uses native truncation, including word boundaries, without adding suffixes', async () => {
		expect(await generateUrlSlug('a'.repeat(200))).toEqual({
			ok: true,
			value: 'a'.repeat(200),
		})
		expect(await generateUrlSlug('a'.repeat(201))).toEqual({
			ok: true,
			value: 'a'.repeat(199),
		})
		expect(
			await generateUrlSlug('A longer title with several words', {
				maxLength: 12,
			}),
		).toEqual({
			ok: true,
			value: 'a-longer',
		})
		expect(await generateUrlSlug('Café', { maxLength: 9 })).toEqual({
			ok: true,
			value: 'cafe',
		})
	})
	it.each([0, 1, 12, 200, -1, 1.5, Infinity, NaN])(
		'matches Sanity default numeric maxLength handling: %j',
		async (maxLength) => {
			const expected = speakingurl('A longer title with several words', {
				truncate: maxLength,
				symbols: true,
			})
			expect(
				await generateUrlSlug('A longer title with several words', {
					maxLength,
				}),
			).toEqual(
				expected
					? { ok: true, value: expected }
					: { ok: false, reason: 'invalid-slug' },
			)
		},
	)
	it('passes the original clean source to custom generation and ignores maxLength', async () => {
		const slugify = vi.fn(() => 'Custom_Segment')
		expect(
			await generateUrlSlug('  Title  ', { slugify, maxLength: 2 }),
		).toEqual({
			ok: true,
			value: 'Custom_Segment',
		})
		expect(slugify).toHaveBeenCalledExactlyOnceWith('  Title  ')
	})
	it.each(['', 'two/segments', '/absolute', '%2fhost', '../path', 'café'])(
		'validates custom result %j',
		async (value) => {
			expect(await generateUrlSlug('Title', { slugify: () => value })).toEqual({
				ok: false,
				reason: 'invalid-slug',
			})
		},
	)
	it('reports a failed custom generator', async () => {
		expect(
			await generateUrlSlug('Title', {
				slugify: () => {
					throw new Error('failed')
				},
			}),
		).toEqual({ ok: false, reason: 'generation-failed' })
	})
	it('awaits custom generation and still validates the result', async () => {
		expect(
			await generateUrlSlug('Title', {
				maxLength: 1,
				slugify: () => Promise.resolve('custom-async-slug'),
			}),
		).toEqual({ ok: true, value: 'custom-async-slug' })
		expect(
			await generateUrlSlug('Title', {
				slugify: () => Promise.resolve('nested/slug'),
			}),
		).toEqual({ ok: false, reason: 'invalid-slug' })
		expect(
			await generateUrlSlug('Title', {
				slugify: () => Promise.reject(new Error('failed')),
			}),
		).toEqual({ ok: false, reason: 'generation-failed' })
	})
	it('keeps overlapping async requests independent; the field must discard stale results', async () => {
		let finish!: (value: string) => void
		const first = generateUrlSlug('First', {
			slugify: () =>
				new Promise<string>((resolve) => {
					finish = resolve
				}),
		})
		expect(await generateUrlSlug('Second')).toEqual({
			ok: true,
			value: 'second',
		})
		finish('first')
		expect(await first).toEqual({ ok: true, value: 'first' })
	})
})
