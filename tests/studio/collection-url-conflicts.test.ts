import { createClient, type ClientConfig } from '@sanity/client'
import { evaluate, parse } from 'groq-js'
import { describe, expect, it, vi } from 'vitest'
import type { SlugIsUniqueValidator } from 'sanity'
import type { PagesClient } from '../../src/studio/pages/data-source.js'
import {
	createCollectionUrlConflictChecker,
	createCollectionUrlIsUnique,
} from '../../src/studio/collections/url-conflicts.js'
import {
	checkRoutingSettingsReadAccess,
	checkUrlConflictReadAccess,
} from '../../src/studio/url/access.js'
import type { CollectionRoutingConfig } from '../../src/url/settings/resolve.js'

const config: CollectionRoutingConfig = {
	pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
	collections: [
		{
			name: 'journal',
			title: 'Journal',
			settingsDocumentId: 'journal-settings',
			index: { schemaType: 'page', pathname: '/insights' },
			items: [{ schemaType: 'post', slugField: 'slug.current' }],
		},
	],
}
const setting = (id = 'journal-settings', prefix = '/journal') => ({
	_id: id,
	_type: 'sanityKitCollectionRoute',
	_rev: `rev-${prefix}`,
	collection: 'journal',
	prefix: { _type: 'slug', current: prefix },
})
const page = (_id: string, current: string) => ({
	_id,
	_type: 'page',
	_rev: 'page-rev',
	pathname: { current },
})
const post = (_id: string, current: string) => ({
	_id,
	_type: 'post',
	_rev: 'post-rev',
	slug: { current },
})
const redirect = (_id: string, source: string) => ({
	_id,
	_type: 'sanityKitRedirect',
	_rev: 'redirect-rev',
	source,
	destination: '/elsewhere',
	enabled: true,
})
function transport(extra: object[] = []) {
	let documents: object[] = [
		setting(),
		setting('drafts.journal-settings', '/blog'),
		...extra,
	]
	const request = vi.fn(() =>
		Promise.resolve([{ filter: 'true', permissions: ['read'] }]),
	)
	const fetch = vi.fn(
		async (query: string, params: Record<string, unknown>) =>
			(
				await evaluate(parse(query), { dataset: documents, params })
			).get() as Promise<unknown>,
	)
	const source = {
		withConfig: () => source,
		request,
		fetch,
		config: () => ({ projectId: 'test1234', dataset: 'development' }),
	}
	const client = { withConfig: vi.fn(() => source) } as unknown as Pick<
		PagesClient,
		'withConfig'
	>
	return {
		client,
		fetch,
		request,
		set: (rows: object[]) => {
			documents = rows
		},
		checker: createCollectionUrlConflictChecker(config, client),
	}
}
const proposal = {
	schemaType: 'post',
	storedValue: 'story',
	documentId: 'drafts.current',
}

describe('settings-aware URL occupancy', () => {
	const twoCollections: CollectionRoutingConfig = {
		...config,
		collections: [
			...config.collections!,
			{
				name: 'news',
				title: 'News',
				settingsDocumentId: 'news-settings',
				index: { schemaType: 'page', pathname: '/news-index' },
				items: [{ schemaType: 'article', slugField: 'slug.current' }],
			},
		],
	}
	const newsSetting = (id: string, prefix: string) => ({
		...setting(id, prefix),
		collection: 'news',
	})
	const article = (id: string) => ({ ...post(id, 'story'), _type: 'article' })
	it.each([
		{
			aLive: '/journal',
			aDraft: '/blog',
			bLive: '/blog',
			bDraft: '/news',
			conflictingCandidate: 'drafts',
		},
		{
			aLive: '/blog',
			aDraft: '/journal',
			bLive: '/news',
			bDraft: '/blog',
			conflictingCandidate: 'published',
		},
	] as const)(
		'checks the $conflictingCandidate candidate against another collection in the opposite view',
		async (prefixes) => {
			const io = transport()
			io.set([
				setting('journal-settings', prefixes.aLive),
				setting('drafts.journal-settings', prefixes.aDraft),
				newsSetting('news-settings', prefixes.bLive),
				newsSetting('drafts.news-settings', prefixes.bDraft),
				article('other-collection'),
			])
			const check = createCollectionUrlConflictChecker(
				twoCollections,
				io.client,
			)
			const result = await check(proposal)
			expect(result.status).toBe('checked')
			if (result.status !== 'checked') throw new Error('Expected checked')
			expect(result[prefixes.conflictingCandidate].candidate.url.pathname).toBe(
				'/blog/story',
			)
			expect(result[prefixes.conflictingCandidate].conflicts).toEqual([
				expect.objectContaining({ documentId: 'other-collection' }),
			])
			const validator = createCollectionUrlIsUnique(twoCollections)
			const context = {
				document: { _id: 'drafts.current', _type: 'post' },
				path: ['slug'],
				getClient: () => io.client,
			} as unknown as Parameters<SlugIsUniqueValidator>[1]
			expect(await validator('story', context)).toBe(false)
		},
	)
	it('deduplicates conflicts found in both occupancy views', async () => {
		const io = transport([page('same-page', '/journal/story')])
		const result = await io.checker(proposal)
		expect(result).toMatchObject({
			status: 'checked',
			published: { conflicts: [{ documentId: 'same-page' }], hasMore: false },
		})
		if (result.status !== 'checked') throw new Error('Expected checked')
		expect(result.published.conflicts).toHaveLength(1)
	})
	it('bounds the merged result when separate occupancy queries each fit below the limit', async () => {
		const io = transport()
		io.set([
			setting('journal-settings', '/blog'),
			setting('drafts.journal-settings', '/journal'),
			newsSetting('news-settings', '/news'),
			newsSetting('drafts.news-settings', '/blog'),
			...Array.from({ length: 12 }, (_, index) =>
				post(`post-${index}`, 'story'),
			),
			...Array.from({ length: 12 }, (_, index) => article(`article-${index}`)),
		])
		const result = await createCollectionUrlConflictChecker(
			twoCollections,
			io.client,
		)({ schemaType: 'page', storedValue: '/blog/story' })
		expect(result.status).toBe('checked')
		if (result.status !== 'checked') throw new Error('Expected checked')
		for (const candidate of [result.published, result.drafts]) {
			expect(candidate.conflicts).toHaveLength(20)
			expect(candidate.hasMore).toBe(true)
		}
		const occupancy = io.fetch.mock.calls.filter(
			([, params]) => !('ids' in params),
		)
		expect(occupancy).toHaveLength(4)
		expect(occupancy.every(([query]) => query.includes('[0...21]'))).toBe(true)
	})
	it('preserves truncation reported by either occupancy query', async () => {
		const io = transport(
			Array.from({ length: 25 }, (_, index) =>
				page(`conflict-${index}`, '/journal/story'),
			),
		)
		const result = await io.checker(proposal)
		expect(result.status).toBe('checked')
		if (result.status !== 'checked') throw new Error('Expected checked')
		expect(result.published.conflicts).toHaveLength(20)
		expect(result.published.hasMore).toBe(true)
	})
	it('rejects contradictory revisions observed across occupancy queries', async () => {
		const io = transport([page('changing-page', '/journal/story')])
		const original = io.fetch.getMockImplementation()!
		let read = 0
		io.fetch.mockImplementation(async (query, params) => {
			const revision = `read-${++read}`
			const result = await original(query, params)
			if ('ids' in params || !Array.isArray(result)) return result
			return (result as unknown[]).map((row) =>
				row && typeof row === 'object' ? { ...row, _rev: revision } : row,
			)
		})
		expect(await io.checker(proposal)).toEqual({
			status: 'unavailable',
			reason: 'conflicts-changed',
		})
	})

	it('checks the live and draft URL spaces independently from the same settings read', async () => {
		const io = transport([
			page('old-space', '/journal/story'),
			page('new-space', '/blog/story'),
		])
		const result = await io.checker(proposal)
		expect(result).toMatchObject({
			status: 'checked',
			published: {
				candidate: { url: { pathname: '/journal/story' } },
				conflicts: [{ documentId: 'old-space' }],
			},
			drafts: {
				candidate: { url: { pathname: '/blog/story' } },
				conflicts: [{ documentId: 'new-space' }],
			},
		})
		const settingsReads = io.fetch.mock.calls.filter(
			([, params]) => 'ids' in params,
		)
		expect(settingsReads).toHaveLength(2)
		expect(settingsReads[0]![1]).toEqual({
			ids: ['journal-settings', 'drafts.journal-settings'],
		})
	})
	it('finds a collection item occupying a proposed page path in either prefix', async () => {
		const io = transport([post('other', 'story')])
		for (const storedValue of ['/blog/story', '/journal/story']) {
			const result = await io.checker({ schemaType: 'page', storedValue })
			expect(result.status).toBe('checked')
			if (result.status !== 'checked') throw new Error('Expected checked')
			expect([
				...result.published.conflicts,
				...result.drafts.conflicts,
			]).toContainEqual(expect.objectContaining({ documentId: 'other' }))
		}
	})
	it('keeps other versions conservative and excludes all versions of the current identity', async () => {
		const io = transport([
			post('current', 'story'),
			post('drafts.current', 'story'),
			post('versions.future.current', 'story'),
			post('versions.future.other', 'story'),
		])
		const result = await io.checker(proposal)
		expect(result).toMatchObject({
			status: 'checked',
			published: { conflicts: [{ documentId: 'versions.future.other' }] },
			drafts: { conflicts: [{ documentId: 'versions.future.other' }] },
		})
	})
	it('checks active redirect sources in both spaces', async () => {
		const result = await transport([
			redirect('live', '/journal/story'),
			redirect('preview', '/blog/story'),
		]).checker(proposal)
		expect(result).toMatchObject({
			status: 'checked',
			published: { conflicts: [{ documentId: 'live' }] },
			drafts: { conflicts: [{ documentId: 'preview' }] },
		})
	})
	it('does not fall back to a seed, published prefix, or empty live site when settings cannot resolve', async () => {
		const io = transport()
		for (const rows of [
			[],
			[setting('drafts.journal-settings', '/blog')],
			[setting(), setting('drafts.journal-settings', 'invalid')],
		]) {
			io.set(rows)
			const result = await io.checker(proposal)
			expect(result.status).toBe('unavailable')
		}
		expect(io.fetch.mock.calls.every(([, params]) => 'ids' in params)).toBe(
			true,
		)
	})
	it('refuses settings changes while conflict queries are in flight', async () => {
		const io = transport()
		const original = io.fetch.getMockImplementation()!
		let changed = false
		io.fetch.mockImplementation(async (query, params) => {
			const result = await original(query, params)
			if (!('ids' in params) && !changed) {
				changed = true
				io.set([setting(), setting('drafts.journal-settings', '/articles')])
			}
			return result
		})
		expect(await io.checker(proposal)).toEqual({
			status: 'unavailable',
			reason: 'routing-changed',
		})
	})
	it('rechecks permissions and refuses a lost settings grant before returning evidence', async () => {
		const io = transport()
		io.request
			.mockResolvedValueOnce([{ filter: 'true', permissions: ['read'] }])
			.mockResolvedValueOnce([
				{ filter: '_type == "post"', permissions: ['read'] },
			])
		expect(await io.checker(proposal)).toMatchObject({
			status: 'unavailable',
			reason: 'unknown-read-access',
			accessIssues: expect.arrayContaining([
				expect.objectContaining({
					key: 'routing-settings:drafts.journal-settings',
				}),
			]) as unknown,
		})
	})
	it('checks access to invisible drafts before querying settings', async () => {
		const io = transport()
		io.request.mockResolvedValue([
			{ filter: '!(_id in path("drafts.**"))', permissions: ['read'] },
		])
		expect(await io.checker(proposal)).toMatchObject({
			status: 'unavailable',
			reason: 'unknown-read-access',
		})
		expect(io.fetch).not.toHaveBeenCalled()
	})
	it('refuses occupancy reads when only settings are visible', async () => {
		const io = transport()
		io.request.mockResolvedValue([
			{
				filter: '_id in ["journal-settings","drafts.journal-settings"]',
				permissions: ['read'],
			},
		])
		expect(await io.checker(proposal)).toMatchObject({
			status: 'unavailable',
			reason: 'unknown-read-access',
		})
		expect(io.fetch.mock.calls.every(([, params]) => 'ids' in params)).toBe(
			true,
		)
	})
	it('returns unavailable for a failed query or cancellation, never an empty conflict list', async () => {
		const io = transport()
		io.fetch.mockRejectedValueOnce(new Error('offline'))
		expect(await io.checker(proposal)).toEqual({
			status: 'unavailable',
			reason: 'request-failed',
		})
		const abort = new AbortController()
		abort.abort()
		expect(await io.checker(proposal, abort.signal)).toEqual({
			status: 'unavailable',
			reason: 'aborted',
		})
	})
	it('keeps locked prefix configuration free of settings queries', async () => {
		const io = transport()
		const check = createCollectionUrlConflictChecker(
			{
				...config,
				collections: config.collections!.map((collection) => ({
					...collection,
					routePrefix: { mode: 'locked', value: '/fixed' },
				})),
			},
			io.client,
		)
		expect(await check(proposal)).toMatchObject({
			status: 'checked',
			published: { candidate: { url: { pathname: '/fixed/story' } } },
			drafts: { candidate: { url: { pathname: '/fixed/story' } } },
		})
		expect(io.fetch.mock.calls.some(([, params]) => 'ids' in params)).toBe(
			false,
		)
	})
	it('overrides inherited HTTP caching through the real Sanity client', async () => {
		const documents = [setting(), setting('drafts.journal-settings', '/blog')]
		const seen: RequestInit[] = []
		const fetch = vi.fn(async (input: unknown, init: unknown) => {
			const url = new URL(String(input))
			seen.push(init as RequestInit)
			let body: unknown
			if (url.pathname.endsWith('/acl'))
				body = [{ filter: 'true', permissions: ['read'] }]
			else {
				const params: Record<string, unknown> = {}
				for (const [key, value] of url.searchParams)
					if (key.startsWith('$'))
						params[key.slice(1)] = JSON.parse(value) as unknown
				const result: unknown = await (
					await evaluate(parse(url.searchParams.get('query')!), {
						dataset: documents,
						params,
					})
				).get()
				body = { result }
			}
			return new Response(JSON.stringify(body), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			})
		})
		const client = createClient({
			projectId: 'test1234',
			dataset: 'development',
			apiVersion: '2026-10-01',
			useCdn: true,
			perspective: 'drafts',
			resolveFetch: () => fetch,
			fetch: {
				cache: 'force-cache',
				next: { revalidate: 3600 },
			} as unknown as NonNullable<ClientConfig['fetch']>,
		})
		expect(
			await createCollectionUrlConflictChecker(
				config,
				client as unknown as Pick<PagesClient, 'withConfig'>,
			)(proposal),
		).toMatchObject({ status: 'checked' })
		expect(seen.length).toBeGreaterThan(3)
		for (const options of seen) {
			expect(options.cache).toBe('no-store')
			expect(options).not.toMatchObject({ next: { revalidate: 3600 } })
		}
		expect(client.config().useCdn).toBe(true)
	})
	it('adapts to native slug validation without requiring a Pages context', async () => {
		const io = transport([page('conflict', '/blog/story')])
		const validator = createCollectionUrlIsUnique(config)
		const context = {
			document: { _id: 'drafts.current', _type: 'post' },
			path: ['slug'],
			getClient: () => io.client,
		} as unknown as Parameters<SlugIsUniqueValidator>[1]
		expect(await validator('story', context)).toBe(false)
		io.set([setting(), setting('drafts.journal-settings', '/blog')])
		expect(await validator('story', context)).toBe(true)
		await expect(
			validator('story', { ...context, path: ['other'] }),
		).rejects.toThrow('registered slug field')
		io.set([])
		await expect(validator('story', context)).rejects.toThrow(
			'settings-missing',
		)
	})
})

describe('exact routing read access', () => {
	it('accepts additive exact-ID grants and refuses type-only assumptions for settings', () => {
		const ids = ['settings', 'drafts.settings']
		expect(
			checkRoutingSettingsReadAccess(ids, [
				{ filter: '_id == "settings"', permissions: ['read'] },
				{ filter: '_id == "drafts.settings"', permissions: ['read'] },
			]).ok,
		).toBe(true)
		expect(
			checkRoutingSettingsReadAccess(ids, [
				{
					filter: '_type == "sanityKitCollectionRoute"',
					permissions: ['read'],
				},
			]),
		).toMatchObject({
			ok: false,
			issues: [{ status: 'unverified' }, { status: 'unverified' }],
		})
	})
	it('does not require folder or receipt access for occupancy-only checks', () => {
		const routes = {
			pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
		}
		expect(
			checkUrlConflictReadAccess(routes, [
				{ filter: '_type == "page"', permissions: ['read'] },
				{
					filter:
						'_type == "sanityKitRedirect" && !(_id in path("drafts.**")) && !(_id in path("versions.**"))',
					permissions: ['read'],
				},
			]).ok,
		).toBe(true)
	})
})
