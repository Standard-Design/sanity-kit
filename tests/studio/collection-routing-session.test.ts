import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import type { useClient } from 'sanity'
import {
	collectionRoutingPerspective,
	createCollectionRoutingStore,
	type CollectionRoutingClient,
	type CollectionRoutingSession,
} from '../../src/studio/collections/routing-session.js'
import { resolveCollectionPagesRuntime } from '../../src/studio/pages/runtime.js'
import { createNavigationQueries } from '../../src/studio/pages/queries.js'
import type { CollectionRoutingConfig } from '../../src/url/settings/resolve.js'

const config: CollectionRoutingConfig = {
	pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
	collections: [
		{
			name: 'articles',
			displayName: { mode: 'default', value: 'Articles' },
			settingsDocumentId: 'article-settings',
			routePrefix: { mode: 'default', value: '/seed-only' },
			index: { schemaType: 'page', pathname: '/insights' },
			items: [{ schemaType: 'article', slugField: 'slug.current' }],
		},
	],
}
const setting = (prefix = '/articles', id = 'article-settings') => ({
	_id: id,
	_rev: prefix,
	_type: 'sanityKitCollectionRoute',
	collection: 'articles',
	prefix: { _type: 'slug', current: prefix },
})
type Source = ReturnType<CollectionRoutingClient['withConfig']>
type Observer = Parameters<ReturnType<Source['listen']>['subscribe']>[0]
function transport(initial: unknown[] = [setting()]) {
	let documents = initial
	const observers: Observer[] = []
	const unsubscribe = vi.fn()
	const fetch = vi.fn<Source['fetch']>((_query, params) =>
		Promise.resolve(
			documents.filter(
				(value) =>
					!!value &&
					typeof value === 'object' &&
					'_id' in value &&
					params.ids.includes(value._id as string),
			),
		),
	)
	const listen = vi.fn<Source['listen']>(() => ({
		subscribe: (observer) => {
			observers.push(observer)
			return { unsubscribe }
		},
	}))
	const client = {
		withConfig: vi.fn<CollectionRoutingClient['withConfig']>(() => ({
			fetch,
			listen,
		})),
	}
	return {
		client,
		fetch,
		listen,
		observers,
		unsubscribe,
		set: (next: unknown[]) => {
			documents = next
		},
	}
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve))
function ready(session: CollectionRoutingSession) {
	const value = session.getSnapshot()
	expect(value.status).toBe('ready')
	if (value.status !== 'ready') throw new Error(`Not ready: ${value.status}`)
	return value
}
function defer<T>() {
	let resolve!: (value: T) => void
	let reject!: (error: Error) => void
	const promise = new Promise<T>((yes, no) => {
		resolve = yes
		reject = no
	})
	return { promise, resolve, reject }
}

describe('private settings routing sessions', () => {
	it('accepts the public Studio client without internal hooks', () => {
		expectTypeOf<
			ReturnType<typeof useClient>
		>().toMatchTypeOf<CollectionRoutingClient>()
	})
	it.each([
		[[], 'published'],
		[['published'], 'published'],
		[['drafts'], 'drafts'],
		[['drafts', 'published'], 'drafts'],
		[['release-id', 'drafts'], undefined],
		[['raw'], undefined],
		[['published', 'drafts'], undefined],
	] as const)(
		'maps only supported native perspective stack %j',
		(stack, expected) => {
			expect(collectionRoutingPerspective(stack)).toBe(expected)
			expect(collectionRoutingPerspective(stack, 'variant')).toBeUndefined()
		},
	)
	it('keeps published and draft reads separate and leaves the independent index fixed', async () => {
		const source = transport([
			setting(),
			setting('/blog', 'drafts.article-settings'),
		])
		const confirmDraftVisibility = vi.fn(() => Promise.resolve(true))
		const store = createCollectionRoutingStore(config, source.client, {
			confirmDraftVisibility,
		})
		const published = store.session([])
		const draft = store.session(['drafts'])
		expect(store.session(['published'])).toBe(published)
		expect(store.session(['drafts', 'published'])).toBe(draft)
		expect(published).not.toBe(draft)
		const offPublished = published.subscribe(vi.fn())
		const offDraft = draft.subscribe(vi.fn())
		await flush()
		expect(ready(published).value.routes.collections?.[0]?.routePrefix).toBe(
			'/articles',
		)
		expect(ready(draft).value.routes.collections?.[0]?.routePrefix).toBe(
			'/blog',
		)
		expect(ready(draft).value.routes.collections?.[0]?.index.pathname).toBe(
			'/insights',
		)
		expect(confirmDraftVisibility).toHaveBeenCalledWith(
			['drafts.article-settings'],
			expect.any(AbortSignal),
		)
		expect(source.listen.mock.calls.map((call) => call[1].ids)).toEqual([
			['article-settings'],
			['article-settings', 'drafts.article-settings'],
		])
		for (const call of source.client.withConfig.mock.calls)
			expect(call[0]).toEqual({
				apiVersion: '2026-10-01',
				perspective: 'raw',
				useCdn: false,
				stega: false,
			})
		for (const call of source.listen.mock.calls)
			expect(call[2]).toEqual({
				includeResult: false,
				includeMutations: false,
				includeAllVersions: true,
				visibility: 'query',
				events: ['welcome', 'mutation', 'reconnect'],
			})
		offPublished()
		offDraft()
		store.dispose()
	})
	it('requires explicit draft visibility and rechecks it on retry', async () => {
		const source = transport([
			setting(),
			setting('/blog', 'drafts.article-settings'),
		])
		const confirmDraftVisibility = vi
			.fn()
			.mockResolvedValueOnce(false)
			.mockRejectedValueOnce(new Error('unavailable'))
			.mockResolvedValue(true)
		const store = createCollectionRoutingStore(config, source.client, {
			confirmDraftVisibility,
		})
		const session = store.session(['drafts'])
		session.subscribe(vi.fn())
		await flush()
		expect(session.getSnapshot()).toMatchObject({
			status: 'unavailable',
			reason: 'access-unconfirmed',
		})
		expect(source.fetch).not.toHaveBeenCalled()
		session.retry()
		await flush()
		expect(session.getSnapshot()).toMatchObject({
			status: 'unavailable',
			reason: 'access-unconfirmed',
		})
		session.retry()
		await flush()
		ready(session)
		expect(confirmDraftVisibility).toHaveBeenCalledTimes(3)
		store.dispose()
	})
	it('does not interpret query-visible drafts as permission evidence without a checker', async () => {
		const source = transport([setting('/blog', 'drafts.article-settings')])
		const store = createCollectionRoutingStore(config, source.client)
		const session = store.session(['drafts'])
		session.subscribe(vi.fn())
		await flush()
		expect(session.getSnapshot()).toMatchObject({
			status: 'unavailable',
			reason: 'access-unconfirmed',
		})
		expect(source.fetch).not.toHaveBeenCalled()
		store.dispose()
	})
	it.each(['/fixed', { mode: 'locked' as const, value: '/fixed' }])(
		'resolves code-owned prefix %j without data reads, listeners or access checks',
		(routePrefix) => {
			const source = transport()
			const confirmDraftVisibility = vi.fn(() => Promise.resolve(false))
			const store = createCollectionRoutingStore(
				{
					...config,
					collections:
						config.collections?.map((item) => ({ ...item, routePrefix })) ?? [],
				},
				source.client,
				{ confirmDraftVisibility },
			)
			const session = store.session(['drafts'])
			const off = session.subscribe(vi.fn())
			expect(ready(session).value.routes.collections?.[0]?.routePrefix).toBe(
				'/fixed',
			)
			expect(source.client.withConfig).not.toHaveBeenCalled()
			expect(confirmDraftVisibility).not.toHaveBeenCalled()
			expect(store.settingsDocuments).toEqual([
				{
					collection: 'articles',
					documentId: 'article-settings',
					title: 'Articles',
				},
			])
			off()
			store.dispose()
		},
	)
	it('keeps settings targets reachable but never uses the default prefix for missing published data', async () => {
		const source = transport([])
		const store = createCollectionRoutingStore(config, source.client)
		const session = store.session([])
		session.subscribe(vi.fn())
		await flush()
		expect(session.getSnapshot()).toEqual({
			status: 'unavailable',
			perspective: 'published',
			reason: 'settings-missing',
			collection: 'articles',
		})
		expect(store.settingsDocuments[0]?.documentId).toBe('article-settings')
		expect(
			resolveCollectionPagesRuntime(session.getSnapshot(), {
				previewUrl: 'http://localhost:3334',
			}),
		).not.toHaveProperty('runtime')
		store.dispose()
	})
	it('rejects an invalid draft rather than falling back to its published prefix', async () => {
		const source = transport([
			setting(),
			setting('/bad//prefix', 'drafts.article-settings'),
		])
		const store = createCollectionRoutingStore(config, source.client, {
			confirmDraftVisibility: () => Promise.resolve(true),
		})
		const session = store.session(['drafts'])
		session.subscribe(vi.fn())
		await flush()
		expect(session.getSnapshot()).toMatchObject({
			status: 'unavailable',
			reason: 'settings-invalid',
		})
		store.dispose()
	})
	it('drops old URLs immediately on query-visible changes and ignores superseded responses', async () => {
		const source = transport()
		const store = createCollectionRoutingStore(config, source.client)
		const session = store.session([])
		session.subscribe(vi.fn())
		await flush()
		ready(session)
		const old = defer<unknown>()
		source.fetch.mockReturnValueOnce(old.promise)
		source.observers[0]!.next({ type: 'mutation' })
		expect(session.getSnapshot().status).toBe('loading')
		await flush()
		source.set([setting('/latest')])
		source.observers[0]!.next({ type: 'mutation' })
		await flush()
		expect(ready(session).value.routes.collections?.[0]?.routePrefix).toBe(
			'/latest',
		)
		old.resolve([setting('/obsolete')])
		await flush()
		expect(ready(session).value.routes.collections?.[0]?.routePrefix).toBe(
			'/latest',
		)
		expect(source.fetch.mock.calls[1]?.[2].signal?.aborted).toBe(true)
		store.dispose()
	})
	it('does not restore stale routes when the replacement query fails', async () => {
		const source = transport()
		const old = defer<unknown>()
		source.fetch
			.mockReturnValueOnce(old.promise)
			.mockRejectedValueOnce(new Error('offline'))
		const store = createCollectionRoutingStore(config, source.client)
		const session = store.session([])
		session.subscribe(vi.fn())
		await flush()
		session.retry()
		expect(session.getSnapshot().status).toBe('loading')
		await flush()
		expect(session.getSnapshot()).toMatchObject({
			status: 'unavailable',
			reason: 'request-failed',
		})
		old.resolve([setting()])
		await flush()
		expect(session.getSnapshot()).toMatchObject({
			status: 'unavailable',
			reason: 'request-failed',
		})
		store.dispose()
	})
	it('waits for query-visible welcome after reconnect and ignores abandoned connections', async () => {
		const source = transport()
		const store = createCollectionRoutingStore(config, source.client)
		const session = store.session([])
		session.subscribe(vi.fn())
		await flush()
		source.observers[0]!.next({ type: 'reconnect' })
		expect(session.getSnapshot()).toMatchObject({
			status: 'unavailable',
			reason: 'disconnected',
		})
		const readsBeforeWelcome = source.fetch.mock.calls.length
		session.retry()
		source.observers[0]!.next({ type: 'mutation' })
		await flush()
		expect(source.fetch).toHaveBeenCalledTimes(readsBeforeWelcome)
		expect(session.getSnapshot()).toMatchObject({
			status: 'unavailable',
			reason: 'disconnected',
		})
		source.set([setting('/reconnected')])
		source.observers[0]!.next({ type: 'welcome' })
		await flush()
		expect(ready(session).value.routes.collections?.[0]?.routePrefix).toBe(
			'/reconnected',
		)
		source.observers[0]!.error()
		expect(session.getSnapshot()).toMatchObject({
			status: 'unavailable',
			reason: 'disconnected',
		})
		session.retry()
		await flush()
		const snapshot = session.getSnapshot()
		source.observers[0]!.next({ type: 'mutation' })
		source.observers[0]!.error()
		await flush()
		expect(session.getSnapshot()).toBe(snapshot)
		expect(source.listen).toHaveBeenCalledTimes(2)
		store.dispose()
	})
	it('ignores late reads after changing perspective, leaving neither subscription nor stale data behind', async () => {
		const source = transport([
			setting('/draft', 'drafts.article-settings'),
			setting('/published'),
		])
		const pending = defer<unknown>()
		source.fetch.mockReturnValueOnce(pending.promise)
		const store = createCollectionRoutingStore(config, source.client, {
			confirmDraftVisibility: () => Promise.resolve(true),
		})
		const draft = store.session(['drafts'])
		const leave = draft.subscribe(vi.fn())
		await flush()
		leave()
		const published = store.session([])
		published.subscribe(vi.fn())
		await flush()
		pending.resolve([setting('/late', 'drafts.article-settings')])
		await flush()
		expect(ready(published).value.routes.collections?.[0]?.routePrefix).toBe(
			'/published',
		)
		expect(draft.getSnapshot().status).toBe('loading')
		expect(source.unsubscribe).toHaveBeenCalledOnce()
		store.dispose()
	})
	it('ignores late reads after disposal and never restarts a disposed store', async () => {
		const source = transport()
		const pending = defer<unknown>()
		source.fetch.mockReturnValueOnce(pending.promise)
		const store = createCollectionRoutingStore(config, source.client)
		const session = store.session([])
		session.subscribe(vi.fn())
		await flush()
		store.dispose()
		pending.resolve([setting()])
		await flush()
		session.retry()
		expect(session.getSnapshot()).toMatchObject({
			status: 'unavailable',
			reason: 'disposed',
		})
		const other = store.session(['drafts'])
		other.subscribe(vi.fn())
		other.retry()
		expect(other.getSnapshot()).toMatchObject({
			status: 'unavailable',
			reason: 'disposed',
		})
		expect(source.fetch).toHaveBeenCalledOnce()
	})
	it('isolates clients, configurations and their mutation streams', async () => {
		const first = transport([setting('/first')])
		const second = transport([setting('/second')])
		const options = structuredClone(config)
		const storeA = createCollectionRoutingStore(options, first.client)
		const storeB = createCollectionRoutingStore(config, second.client)
		;(options.collections![0]!.index as { pathname: string }).pathname =
			'/changed'
		const a = storeA.session([])
		const b = storeB.session([])
		a.subscribe(vi.fn())
		b.subscribe(vi.fn())
		await flush()
		expect(ready(a).value.routes.collections?.[0]?.index.pathname).toBe(
			'/insights',
		)
		first.set([setting('/changed')])
		first.observers[0]!.next({ type: 'mutation' })
		await flush()
		expect(ready(a).value.routes.collections?.[0]?.routePrefix).toBe('/changed')
		expect(ready(b).value.routes.collections?.[0]?.routePrefix).toBe('/second')
		expect(second.fetch).toHaveBeenCalledOnce()
		storeA.dispose()
		storeB.dispose()
	})
	it('keeps unsupported releases and variants free of misleading queries', () => {
		const source = transport()
		const store = createCollectionRoutingStore(config, source.client)
		for (const session of [
			store.session(['release']),
			store.session(['drafts'], 'variant'),
		]) {
			session.subscribe(vi.fn())
			session.retry()
			expect(session.getSnapshot()).toEqual({
				status: 'unavailable',
				reason: 'unsupported-perspective',
			})
		}
		expect(source.client.withConfig).not.toHaveBeenCalled()
		store.dispose()
	})
	it('projects one successful snapshot consistently into navigation and native resolvers', async () => {
		const source = transport([setting('/blog', 'drafts.article-settings')])
		const store = createCollectionRoutingStore(config, source.client, {
			confirmDraftVisibility: () => Promise.resolve(true),
		})
		const session = store.session(['drafts'])
		session.subscribe(vi.fn())
		await flush()
		const view = resolveCollectionPagesRuntime(session.getSnapshot(), {
			previewUrl: 'http://localhost:3334',
		})
		if (view.status !== 'ready') throw new Error('Expected runtime')
		expect(view.runtime.registry.collections[0]?.routePrefix).toBe('/blog')
		expect(
			createNavigationQueries(view.runtime.registry).recent('articles').query,
		).toContain('"/blog/"')
		const main = view.resolve.mainDocuments?.[0]
		if (!main || !('resolve' in main) || !main.resolve)
			throw new Error('Expected resolver')
		expect(
			main.resolve({
				path: '/blog/first',
				origin: 'http://localhost:3334',
				params: {},
			})?.params,
		).toMatchObject({ slug1: 'first' })
		expect(
			main.resolve({
				path: '/articles/first',
				origin: 'http://localhost:3334',
				params: {},
			})?.params,
		).not.toHaveProperty('slug1')
		expect(view.runtime.registry.collections[0]?.index.pathname).toBe(
			'/insights',
		)
		source.set([setting('/new', 'drafts.article-settings')])
		source.observers[0]!.next({ type: 'mutation' })
		expect(
			resolveCollectionPagesRuntime(session.getSnapshot(), {
				previewUrl: 'http://localhost:3334',
			}),
		).not.toHaveProperty('runtime')
		await flush()
		const next = resolveCollectionPagesRuntime(session.getSnapshot(), {
			previewUrl: 'http://localhost:3334',
		})
		if (next.status !== 'ready') throw new Error('Expected new runtime')
		expect(next.resolve.mainDocuments).not.toBe(view.resolve.mainDocuments)
		store.dispose()
	})
})
