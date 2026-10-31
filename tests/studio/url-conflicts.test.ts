import { evaluate, parse } from 'groq-js'
import type { SlugIsUniqueValidator } from 'sanity'
import { describe, expect, it, vi } from 'vitest'
import type { PagesClient } from '../../src/studio/pages/data-source.js'
import {
	createUrlConflictChecker,
	type UrlConflictRequest,
} from '../../src/studio/url/conflicts.js'
import { createUrlIsUnique } from '../../src/studio/url/is-unique.js'
import type { PagesRouteConfig } from '../../src/url/index.js'

const config = {
	pages: [
		{ schemaType: 'page', pathnameField: 'pathname.current' },
		{ schemaType: 'landing', pathnameField: 'url' },
	],
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
		{
			name: 'news',
			title: 'News',
			routePrefix: '/news',
			overview: { schemaType: 'page', pathname: '/news' },
			items: [{ schemaType: 'newsItem', slugField: 'slug.current' }],
		},
	],
	excludePaths: ['/reserved'],
} satisfies PagesRouteConfig

const page = (_id: string, pathname = '/journal/story') => ({
	_id,
	_type: 'page',
	_rev: 'rev-1',
	pathname: { current: pathname },
	body: 'Not fetched',
})
const post = (_id: string, slug = 'story') => ({
	_id,
	_type: 'post',
	_rev: 'rev-2',
	slug: { current: slug },
})

/** Evaluate the real generated GROQ, including Sanity's versionOf function. */
function transport(dataset: object[] = []) {
	const fetch = vi.fn(
		async (
			query: string,
			params: Record<string, unknown>,
			_options: unknown,
		): Promise<unknown> => {
			void _options
			return (await evaluate(parse(query), { dataset, params })).get()
		},
	)
	const source = { fetch }
	const withConfig = vi.fn(() => source)
	const client = { withConfig } as unknown as Pick<PagesClient, 'withConfig'>
	return {
		fetch,
		withConfig,
		client,
		check: createUrlConflictChecker(config, client),
	}
}
const request: UrlConflictRequest = {
	schemaType: 'page',
	storedValue: '/journal/story',
}

describe('URL occupancy checks', () => {
	it('finds the same URL across full-path types and slug-only collections', async () => {
		const { check } = transport([
			page('a'),
			post('b'),
			{ _id: 'c', _type: 'landing', _rev: '3', url: '/journal/story' },
			{ _id: 'd', _type: 'legacy', _rev: '4', url: '/journal/story' },
			{ ...post('other-prefix'), _type: 'newsItem' },
			{ ...page('unregistered'), _type: 'shared' },
		])
		const result = await check(request)
		expect(result).toMatchObject({ status: 'checked', hasMore: false })
		if (result.status !== 'checked') throw new Error('Expected check')
		expect(result.conflicts.map(({ documentId }) => documentId)).toEqual([
			'a',
			'b',
			'c',
			'd',
		])
		expect(result.conflicts[0]).toEqual({
			documentId: 'a',
			schemaType: 'page',
			revision: 'rev-1',
			version: 'published',
		})
		expect(result.candidate).toEqual({
			url: { pathname: '/journal/story', prefix: '/journal', slug: 'story' },
			fieldPath: 'pathname.current',
			storedValue: '/journal/story',
		})
	})

	it('finds page collisions when the candidate stores only a slug', async () => {
		const { check } = transport([page('page'), post('post')])
		const result = await check({
			schemaType: 'post',
			storedValue: 'story',
			documentId: 'drafts.post',
		})
		expect(result).toMatchObject({
			status: 'checked',
			conflicts: [{ documentId: 'page' }],
			candidate: { storedValue: 'story' },
		})
	})

	it.each(['/company/team', '/leadership/team', '/'])(
		'compares the whole path, including root: %s',
		async (path) => {
			const { check } = transport([
				page('match', path),
				page('different', '/unrelated/team'),
				post('post', 'team'),
			])
			expect(
				await check({ schemaType: 'page', storedValue: path }),
			).toMatchObject({
				status: 'checked',
				conflicts: [{ documentId: 'match' }],
			})
		},
	)

	it.each([
		'doc.with.dots',
		'drafts.doc.with.dots',
		'versions.launch.doc.with.dots',
	])(
		'excludes every version of the current document %s',
		async (documentId) => {
			const { check, fetch } = transport([
				page('doc.with.dots'),
				page('drafts.doc.with.dots'),
				page('versions.launch.doc.with.dots'),
				page('versions.later.doc.with.dots'),
				page('another'),
				page('drafts.another'),
				page('versions.launch.another'),
			])
			const result = await check({ ...request, documentId })
			expect(result).toMatchObject({
				status: 'checked',
				conflicts: [
					{ documentId: 'another', version: 'published' },
					{ documentId: 'drafts.another', version: 'draft' },
					{ documentId: 'versions.launch.another', version: 'release' },
				],
			})
			expect(fetch.mock.calls[0]![0]).toContain(
				'!sanity::versionOf($publishedId)',
			)
			expect(fetch.mock.calls[0]![1].publishedId).toBe('doc.with.dots')
		},
	)

	it('does not lose a live conflict when another document has a draft at a different URL', async () => {
		const { check } = transport([
			page('other'),
			page('drafts.other', '/planned'),
		])
		expect(await check(request)).toMatchObject({
			status: 'checked',
			conflicts: [{ documentId: 'other' }],
		})
	})

	it('does not hide a stored collision because its type cannot own that overview', async () => {
		const { check } = transport([
			{ _id: 'wrong-owner', _type: 'landing', _rev: '1', url: '/insights' },
		])
		expect(
			await check({ schemaType: 'page', storedValue: '/insights' }),
		).toMatchObject({
			status: 'checked',
			conflicts: [{ documentId: 'wrong-owner' }],
		})
	})

	it('checks a cleaned candidate without changing any existing documents', async () => {
		const documents = [
			page('canonical', '/about/team'),
			page('legacy', '/about//team/'),
		]
		const before = structuredClone(documents)
		const { check } = transport(documents)
		expect(
			await check({ schemaType: 'page', storedValue: '/about//team/' }),
		).toMatchObject({
			status: 'checked',
			candidate: { storedValue: '/about/team' },
			conflicts: [{ documentId: 'canonical' }],
		})
		expect(documents).toEqual(before)
	})

	it('keeps case and percent-encoding exact; does not impose app redirect rules', async () => {
		const { check } = transport([
			page('case', '/Story'),
			page('encoded', '/%73tory'),
			page('slash', '/story/'),
			page('repeat', '/about//story'),
		])
		expect(
			await check({ schemaType: 'page', storedValue: '/story' }),
		).toMatchObject({ status: 'checked', conflicts: [] })
	})

	it('does not mistake a prefix lookalike or nested path for a single-segment collection', async () => {
		const { check } = transport([
			post('nested', 'archive/story'),
			post('story'),
		])
		for (const path of ['/journal/archive/story', '/journaling/story'])
			expect(
				await check({ schemaType: 'page', storedValue: path }),
			).toMatchObject({ status: 'checked', conflicts: [] })
	})

	it('uses parameters for values and quoted access for registered fields', async () => {
		const { client, fetch } = transport([
			{
				_id: 'a',
				_type: 'page',
				_rev: '1',
				select: { current: '/say%22hello' },
			},
		])
		const check = createUrlConflictChecker(
			{ pages: [{ schemaType: 'page', pathnameField: 'select.current' }] },
			client,
		)
		expect(
			await check({ schemaType: 'page', storedValue: '/say%22hello' }),
		).toMatchObject({ status: 'checked', conflicts: [{ documentId: 'a' }] })
		expect(fetch.mock.calls[0]![0]).toContain(
			'@["select"]["current"] == $value0',
		)
		expect(fetch.mock.calls[0]![0]).not.toContain('/say')
	})

	it('requests raw, uncached-by-CDN, non-Stega results and only small conflict records', async () => {
		const { check, withConfig, fetch } = transport([page('a')])
		const controller = new AbortController()
		await check(request, controller.signal)
		expect(withConfig).toHaveBeenCalledWith({
			apiVersion: '2026-10-01',
			useCdn: false,
			perspective: 'raw',
			stega: false,
		})
		expect(fetch.mock.calls[0]![2]).toEqual({
			perspective: 'raw',
			useCdn: false,
			stega: false,
			filterResponse: true,
			tag: 'sanity-kit.url-conflicts',
			signal: controller.signal,
		})
		expect(fetch.mock.calls[0]![0]).toContain('{_id, _type, _rev}')
		expect(fetch.mock.calls[0]![0]).not.toContain('body')
	})

	it.each([20, 21, 30])(
		'bounds %i matches without declaring the URL free',
		async (count) => {
			const { check } = transport(
				Array.from({ length: count }, (_, i) =>
					page(`p-${i.toString().padStart(2, '0')}`),
				),
			)
			const result = await check(request)
			if (result.status !== 'checked') throw new Error('Expected check')
			expect(result.conflicts).toHaveLength(20)
			expect(result.hasMore).toBe(count > 20)
		},
	)

	it.each([
		[{ schemaType: 'unknown', storedValue: '/a' }, 'unregistered-type'],
		[{ schemaType: 'page', storedValue: '/reserved' }, 'disallowed-path'],
		[{ schemaType: 'post', storedValue: 'two/parts' }, 'invalid-value'],
		[{ schemaType: 'page', storedValue: '//host' }, 'invalid-value'],
		[{ schemaType: 'page', storedValue: '' }, 'missing-value'],
	] as const)(
		'does not query invalid candidates %j',
		async (candidate, reason) => {
			const { check, fetch } = transport()
			expect(await check(candidate)).toEqual({ status: 'invalid', reason })
			expect(fetch).not.toHaveBeenCalled()
		},
	)

	it.each([
		'',
		'bad id',
		'-bad',
		'a..b',
		'drafts.',
		'versions.release',
		'versions.release.',
		'a.versions.b',
		'drafts.drafts.a',
		'a'.repeat(129),
	])('refuses invalid self identity %s', async (documentId) => {
		const { check, fetch } = transport()
		expect(await check({ ...request, documentId })).toEqual({
			status: 'invalid',
			reason: 'invalid-document-id',
		})
		expect(fetch).not.toHaveBeenCalled()
	})

	it.each([
		null,
		{},
		[null],
		[{ _id: 'a', _type: 'page' }],
		[{ _id: 'a', _type: 'other', _rev: '1' }],
		[{ _id: 'a', _type: 'page', _rev: '' }],
		[page('same'), page('same')],
		Array.from({ length: 22 }, (_, i) => page(`p${i}`)),
	])('does not interpret malformed results as success', async (rows) => {
		const { check, fetch } = transport()
		fetch.mockResolvedValueOnce(rows)
		expect(await check(request)).toEqual({
			status: 'unavailable',
			reason: 'invalid-response',
		})
	})

	it('rejects an unexpected self match returned by the transport', async () => {
		const { check, fetch } = transport()
		fetch.mockResolvedValueOnce([page('versions.release.self')])
		expect(await check({ ...request, documentId: 'self' })).toEqual({
			status: 'unavailable',
			reason: 'invalid-response',
		})
	})

	it('reports query errors without leaking their details or treating the URL as free', async () => {
		const { check, fetch } = transport()
		fetch.mockRejectedValueOnce(new Error('private request details'))
		expect(await check(request)).toEqual({
			status: 'unavailable',
			reason: 'request-failed',
		})
	})

	it('honors cancellation before and after a request, even when transport ignores it', async () => {
		const { check, fetch } = transport()
		const controller = new AbortController()
		controller.abort()
		expect(await check(request, controller.signal)).toEqual({
			status: 'unavailable',
			reason: 'aborted',
		})
		expect(fetch).not.toHaveBeenCalled()
		const later = new AbortController()
		fetch.mockImplementationOnce(() => {
			later.abort()
			return Promise.resolve([])
		})
		expect(await check(request, later.signal)).toEqual({
			status: 'unavailable',
			reason: 'aborted',
		})
		const rejects = new AbortController()
		fetch.mockImplementationOnce(() => {
			rejects.abort()
			return Promise.reject(new Error('aborted'))
		})
		expect(await check(request, rejects.signal)).toEqual({
			status: 'unavailable',
			reason: 'aborted',
		})
	})

	it('snapshots configuration and does not cache independent checks', async () => {
		const mutable = structuredClone(config)
		const { client, fetch } = transport([post('a')])
		const check = createUrlConflictChecker(mutable, client)
		mutable.collections[0]!.routePrefix = '/changed'
		expect(await check(request)).toMatchObject({
			status: 'checked',
			conflicts: [{ documentId: 'a' }],
		})
		fetch.mockResolvedValueOnce([])
		expect(await check(request)).toMatchObject({
			status: 'checked',
			conflicts: [],
		})
		expect(fetch).toHaveBeenCalledTimes(2)
	})
})

type NativeContext = Parameters<SlugIsUniqueValidator>[1]
function nativeContext(
	client: Pick<PagesClient, 'withConfig'>,
	overrides: Partial<NativeContext> = {},
): NativeContext {
	return {
		document: { ...page('drafts.self'), _createdAt: '', _updatedAt: '' },
		path: ['pathname'],
		getClient: vi.fn(() => client),
		...overrides,
	} as NativeContext
}

describe('native slug isUnique adapter', () => {
	it('rejects missing document context and unregistered types before fetching', async () => {
		const { client, fetch } = transport()
		const context = nativeContext(client)
		delete context.document
		await expect(createUrlIsUnique(config)('/a', context)).rejects.toThrow(
			'registered document type',
		)
		context.document = {
			...page('self'),
			_type: 'shared',
			_createdAt: '',
			_updatedAt: '',
		}
		await expect(createUrlIsUnique(config)('/a', context)).rejects.toThrow(
			'registered document type',
		)
		expect(fetch).not.toHaveBeenCalled()
	})

	it('supports nested slug objects and refuses missing field context', async () => {
		const { client, fetch } = transport([
			{
				_id: 'other',
				_type: 'page',
				_rev: '1',
				seo: { url: { current: '/a' } },
			},
		])
		const isUnique = createUrlIsUnique({
			pages: [{ schemaType: 'page', pathnameField: 'seo.url.current' }],
		})
		const context = nativeContext(client, { path: ['seo', 'url'] })
		expect(await isUnique('/a', context)).toBe(false)
		delete context.path
		await expect(isUnique('/a', context)).rejects.toThrow(
			'registered slug field',
		)
		expect(fetch).toHaveBeenCalledTimes(1)
	})

	it('propagates malformed responses as failed checks, not duplicate-slug results', async () => {
		const { client, fetch } = transport()
		fetch.mockResolvedValueOnce(null)
		await expect(
			createUrlIsUnique(config)('/a', nativeContext(client)),
		).rejects.toThrow('invalid-response')
	})

	it('returns native booleans and excludes all of its own versions', async () => {
		const { client, fetch } = transport([
			page('self'),
			page('versions.launch.self'),
		])
		const isUnique: SlugIsUniqueValidator = createUrlIsUnique(config)
		const context = nativeContext(client)
		expect(await isUnique('/journal/story', context)).toBe(true)
		fetch.mockResolvedValueOnce([{ _id: 'other', _type: 'post', _rev: '1' }])
		expect(await isUnique('/journal/story', context)).toBe(false)
		expect(context.getClient).toHaveBeenCalledWith({ apiVersion: '2026-10-01' })
	})

	it('uses the callback value rather than an older value in the document', async () => {
		const { client } = transport([page('other', '/new')])
		expect(await createUrlIsUnique(config)('/new', nativeContext(client))).toBe(
			false,
		)
	})

	it('supports native slug-only collection fields', async () => {
		const { client } = transport([page('other')])
		const context = nativeContext(client, {
			document: { ...post('drafts.self'), _createdAt: '', _updatedAt: '' },
			path: ['slug'],
		})
		expect(await createUrlIsUnique(config)('story', context)).toBe(false)
	})

	it.each([['wrong'], ['pathname', 0], ['pathname', { _key: 'a' }], []])(
		'refuses a mismatched field path %j',
		async (...args) => {
			const { client, fetch } = transport()
			const path = args as NonNullable<NativeContext['path']>
			await expect(
				createUrlIsUnique(config)('/a', nativeContext(client, { path })),
			).rejects.toThrow('registered slug field')
			expect(fetch).not.toHaveBeenCalled()
		},
	)

	it.each(['/about//team/', '/reserved', '', '//host'])(
		'does not report uniqueness for an invalid stored URL %j',
		async (value) => {
			const { client, fetch } = transport()
			await expect(
				createUrlIsUnique(config)(value, nativeContext(client)),
			).rejects.toThrow('Cannot check URL uniqueness')
			expect(fetch).not.toHaveBeenCalled()
		},
	)

	it('throws on network failure instead of claiming a collision or success', async () => {
		const { client, fetch } = transport()
		fetch.mockRejectedValueOnce(new Error('secret details'))
		await expect(
			createUrlIsUnique(config)('/a', nativeContext(client)),
		).rejects.toThrow('Cannot check URL uniqueness: request-failed.')
	})

	it('passes native validation cancellation through', async () => {
		const { client, fetch } = transport()
		const controller = new AbortController()
		await createUrlIsUnique(config)(
			'/a',
			nativeContext(client, { signal: controller.signal }),
		)
		expect(fetch.mock.calls[0]![2]).toMatchObject({ signal: controller.signal })
		controller.abort()
		await expect(
			createUrlIsUnique(config)(
				'/a',
				nativeContext(client, { signal: controller.signal }),
			),
		).rejects.toThrow('aborted')
	})

	it('snapshots configuration for later native validation calls', async () => {
		const mutable = structuredClone(config)
		const isUnique = createUrlIsUnique(mutable)
		mutable.collections[0]!.routePrefix = '/changed'
		const { client } = transport([post('other')])
		expect(await isUnique('/journal/story', nativeContext(client))).toBe(false)
	})
})
