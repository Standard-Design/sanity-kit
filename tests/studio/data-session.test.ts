import { evaluate, parse } from 'groq-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	CHANGE_DELAY_MS,
	RECONCILE_MS,
	createPagesDataSession,
} from '../../src/studio/pages/data-session.js'
import type {
	PagesDataSource,
	PageQueryPlan,
} from '../../src/studio/pages/data-source.js'
import { createPagesRuntime } from '../../src/studio/pages/runtime.js'

const runtime = createPagesRuntime({
	previewUrl: 'https://preview.test',
	pages: [{ schemaType: 'page', pathnameField: 'path' }],
	collections: [
		{
			name: 'journal',
			title: 'Journal',
			overview: { schemaType: 'page', pathname: '/journal' },
			routePrefix: '/journal',
			items: [{ schemaType: 'post', pathnameField: 'path' }],
		},
	],
})
const doc = (id: number, type = 'page') => ({
	_id: `id-${String(id).padStart(4, '0')}`,
	_type: type,
	title: `Page ${id}`,
	path: type === 'page' ? `/page-${id}` : `/journal/post-${id}`,
	_updatedAt: '2026-10-29T00:00:00Z',
})

function harness(initial = [doc(0)]) {
	let dataset: object[] = initial
	const observers: Parameters<PagesDataSource['listen']>[0][] = []
	const unsubscribe = vi.fn()
	const fetch = vi.fn(
		async (plan: PageQueryPlan, _signal: AbortSignal): Promise<unknown> => {
			void _signal
			return (
				await evaluate(parse(plan.query), { dataset, params: plan.params })
			).get()
		},
	)
	const listen = vi.fn((observer: Parameters<PagesDataSource['listen']>[0]) => {
		observers.push(observer)
		return { unsubscribe }
	})
	const source: PagesDataSource = {
		fetch: <T>(plan: PageQueryPlan, signal: AbortSignal) =>
			fetch(plan, signal) as Promise<T>,
		listen,
	}
	const session = createPagesDataSession(runtime, source)
	const releases: (() => void)[] = []
	return {
		session,
		fetch,
		listen,
		unsubscribe,
		observers,
		setData(value: object[]) {
			dataset = value
		},
		subscribe(resource: { subscribe(notify: () => void): () => void }) {
			const release = resource.subscribe(vi.fn())
			releases.push(release)
			return release
		},
		close() {
			for (const release of releases) release()
		},
	}
}
type Harness = ReturnType<typeof harness>

describe('Shared Pages data sessions', () => {
	const active: Harness[] = []
	function setup(initial?: ReturnType<typeof doc>[]) {
		const h = initial ? harness(initial) : harness()
		active.push(h)
		return h
	}
	beforeEach(() => vi.useFakeTimers())
	afterEach(() => {
		for (const h of active.splice(0)) h.close()
		expect(vi.getTimerCount()).toBe(0)
		vi.useRealTimers()
	})
	const settle = () => vi.advanceTimersByTimeAsync(0)
	const changed = () => vi.advanceTimersByTimeAsync(CHANGE_DELAY_MS)

	it('is lazy and shares one request/listener across simultaneous readers', async () => {
		const h = setup()
		expect(h.fetch).not.toHaveBeenCalled()
		expect(h.listen).not.toHaveBeenCalled()
		h.subscribe(h.session.proof)
		h.subscribe(h.session.proof)
		await settle()
		expect(h.fetch).toHaveBeenCalledTimes(1)
		expect(h.listen).toHaveBeenCalledTimes(1)
		expect(h.session.proof.getSnapshot()).toMatchObject({
			loading: false,
			data: [{ _id: 'id-0000' }],
		})
		expect(h.session.proof.getSnapshot()).toBe(h.session.proof.getSnapshot())
	})
	it('does not reconnect or refetch when the sidebar leaves and returns while the header remains', async () => {
		const h = setup()
		h.subscribe(h.session.proof)
		const sidebar = h.subscribe(h.session.proof)
		await settle()
		sidebar()
		h.subscribe(h.session.proof)
		await settle()
		expect(h.fetch).toHaveBeenCalledTimes(1)
		expect(h.unsubscribe).not.toHaveBeenCalled()
	})
	it('clears cached data and resources when the last reader leaves, then can restart', async () => {
		const h = setup()
		const release = h.subscribe(h.session.proof)
		await settle()
		release()
		expect(h.unsubscribe).toHaveBeenCalledTimes(1)
		expect(h.session.proof.getSnapshot()).toMatchObject({
			data: [],
			loading: true,
		})
		expect(vi.getTimerCount()).toBe(0)
		h.subscribe(h.session.proof)
		await settle()
		expect(h.listen).toHaveBeenCalledTimes(2)
		expect(h.fetch).toHaveBeenCalledTimes(2)
	})
	it('coalesces mutation bursts and preserves rows during the replacement read', async () => {
		const h = setup()
		h.subscribe(h.session.proof)
		await settle()
		const next = Promise.withResolvers<unknown>()
		h.fetch.mockReturnValueOnce(next.promise)
		for (let i = 0; i < 10; i++) h.observers[0]!.next({ type: 'mutation' })
		await changed()
		expect(h.fetch).toHaveBeenCalledTimes(2)
		expect(h.session.proof.getSnapshot()).toMatchObject({
			loading: false,
			refreshing: true,
			data: [{ _id: 'id-0000' }],
		})
		next.resolve([{ ...doc(1), pathname: '/page-1' }])
		await settle()
		expect(h.session.proof.getSnapshot()).toMatchObject({
			refreshing: false,
			data: [{ _id: 'id-0001' }],
		})
	})
	it('aborts obsolete requests and ignores late responses even if the transport does not', async () => {
		const h = setup()
		const old = Promise.withResolvers<unknown>()
		h.fetch.mockReturnValueOnce(old.promise)
		h.subscribe(h.session.proof)
		await settle()
		h.observers[0]!.next({ type: 'mutation' })
		expect(h.fetch.mock.calls[0]![1].aborted).toBe(true)
		h.setData([doc(2)])
		await changed()
		old.resolve([{ ...doc(9), pathname: '/wrong' }])
		await settle()
		expect(h.session.proof.getSnapshot().data[0]?._id).toBe('id-0002')
	})
	it('ignores callbacks and late reads from a stopped session', async () => {
		const h = setup()
		const pending = Promise.withResolvers<unknown>()
		h.fetch.mockReturnValueOnce(pending.promise)
		const release = h.subscribe(h.session.proof)
		await settle()
		release()
		h.observers[0]!.next({ type: 'welcome' })
		h.observers[0]!.error()
		pending.resolve([doc(8)])
		await settle()
		expect(h.session.proof.getSnapshot()).toMatchObject({
			data: [],
			disconnected: false,
		})
		expect(h.fetch).toHaveBeenCalledTimes(1)
	})
	it('rechecks on welcome and marks reconnects until a new welcome arrives', async () => {
		const h = setup()
		h.subscribe(h.session.proof)
		await settle()
		h.observers[0]!.next({ type: 'reconnect' })
		expect(h.session.proof.getSnapshot().disconnected).toBe(true)
		h.setData([doc(3)])
		h.observers[0]!.next({ type: 'welcome' })
		await settle()
		expect(h.session.proof.getSnapshot()).toMatchObject({
			disconnected: false,
			data: [{ _id: 'id-0003' }],
		})
	})
	it('offers retry after a terminal listener error without hiding that failure behind a successful fetch', async () => {
		const h = setup()
		h.subscribe(h.session.proof)
		await settle()
		h.observers[0]!.error()
		h.session.retry()
		await settle()
		expect(h.listen).toHaveBeenCalledTimes(2)
		expect(h.session.proof.getSnapshot().disconnected).toBe(true)
		h.observers[1]!.next({ type: 'welcome' })
		await settle()
		expect(h.session.proof.getSnapshot().disconnected).toBe(false)
		h.observers[0]!.error()
		expect(h.session.proof.getSnapshot().disconnected).toBe(false)
	})
	it('retains last-good data on read errors and can recover without another listener', async () => {
		const h = setup()
		h.subscribe(h.session.proof)
		await settle()
		h.fetch.mockRejectedValueOnce(new Error('offline'))
		h.session.retry()
		await settle()
		expect(h.session.proof.getSnapshot()).toMatchObject({
			error: true,
			data: [{ _id: 'id-0000' }],
		})
		h.session.retry()
		await settle()
		expect(h.session.proof.getSnapshot().error).toBe(false)
		expect(h.listen).toHaveBeenCalledTimes(1)
	})
	it('handles synchronously throwing listeners and fetch adapters', async () => {
		const h = setup()
		h.listen.mockImplementationOnce(() => {
			throw new Error('listen')
		})
		h.fetch.mockImplementationOnce(() => {
			throw new Error('fetch')
		})
		h.subscribe(h.session.proof)
		await settle()
		expect(h.session.proof.getSnapshot()).toMatchObject({
			error: true,
			disconnected: true,
			loading: false,
		})
	})
	it('repairs missed notifications with a periodic read, but never cancels a slow read for a poll', async () => {
		const h = setup()
		h.subscribe(h.session.proof)
		await settle()
		h.setData([doc(4)])
		await vi.advanceTimersByTimeAsync(RECONCILE_MS)
		expect(h.session.proof.getSnapshot().data[0]?._id).toBe('id-0004')
		const pending = Promise.withResolvers<unknown>()
		h.fetch.mockReturnValueOnce(pending.promise)
		h.session.retry()
		await settle()
		const signal = h.fetch.mock.calls.at(-1)![1]
		await vi.advanceTimersByTimeAsync(RECONCILE_MS * 2)
		expect(signal.aborted).toBe(false)
		expect(h.fetch).toHaveBeenCalledTimes(3)
	})
	it('does not poll a known-disconnected listener', async () => {
		const h = setup()
		h.subscribe(h.session.proof)
		await settle()
		h.observers[0]!.error()
		await vi.advanceTimersByTimeAsync(RECONCILE_MS * 2)
		expect(h.fetch).toHaveBeenCalledTimes(1)
	})
	it('loads a complete ordinary-page tree and bounded collection summaries with one listener', async () => {
		const h = setup([
			...Array.from({ length: 205 }, (_, i) => doc(i)),
			...Array.from({ length: 70 }, (_, i) => doc(i + 300, 'post')),
		])
		h.subscribe(h.session.pages)
		const recent = h.session.recent('journal')
		h.subscribe(recent)
		await settle()
		expect(h.session.pages.getSnapshot().data.documents).toHaveLength(205)
		expect(h.session.pages.getSnapshot().data.tree.roots).toHaveLength(206)
		expect(recent.getSnapshot().data).toMatchObject({ total: 70 })
		expect(recent.getSnapshot().data.documents).toHaveLength(5)
		expect(h.listen).toHaveBeenCalledTimes(1)
		expect(h.fetch).toHaveBeenCalledTimes(4)
	})
	it('does not expose a partial tree when a later page batch fails', async () => {
		const h = setup(Array.from({ length: 105 }, (_, i) => doc(i)))
		h.fetch.mockImplementationOnce(async (plan): Promise<unknown> =>
			(
				await evaluate(parse(plan.query), {
					dataset: Array.from({ length: 100 }, (_, i) => doc(i)),
					params: plan.params,
				})
			).get(),
		)
		h.fetch.mockRejectedValueOnce(new Error('page 2 failed'))
		h.subscribe(h.session.pages)
		await settle()
		expect(h.session.pages.getSnapshot()).toMatchObject({
			error: true,
			data: { documents: [] },
		})
	})
	it('loads more by cursor once, then refreshes the loaded depth after creates/deletes/path changes', async () => {
		const h = setup(Array.from({ length: 126 }, (_, i) => doc(i, 'post')))
		const collection = h.session.collection('journal')
		h.subscribe(collection)
		await settle()
		expect(collection.getSnapshot().data.documents).toHaveLength(50)
		collection.loadMore()
		collection.loadMore()
		await settle()
		expect(collection.getSnapshot().data.documents).toHaveLength(100)
		expect(h.fetch.mock.calls[1]![0].params.id).toBe('id-0049')
		h.setData(
			Array.from({ length: 120 }, (_, i) => ({
				...doc(i + 5, 'post'),
				path: `/journal/changed-${i}`,
			})),
		)
		h.observers[0]!.next({ type: 'mutation' })
		await changed()
		expect(collection.getSnapshot().data.documents).toHaveLength(100)
		expect(collection.getSnapshot().data.documents[0]).toMatchObject({
			_id: 'id-0005',
			pathname: '/journal/changed-0',
		})
		expect(h.fetch.mock.calls[2]![0].params.hasCursor).toBe(false)
		expect(collection.getSnapshot().data.batches).toBe(2)
	})
	it('deduplicates overlapping item IDs during pagination', async () => {
		const h = setup(Array.from({ length: 60 }, (_, i) => doc(i, 'post')))
		const collection = h.session.collection('journal')
		h.subscribe(collection)
		await settle()
		h.fetch.mockResolvedValueOnce([
			{ ...doc(49, 'post'), pathname: '/journal/post-49' },
			{ ...doc(50, 'post'), pathname: '/journal/post-50' },
		])
		collection.loadMore()
		await settle()
		expect(collection.getSnapshot().data.documents).toHaveLength(51)
		expect(collection.getSnapshot().data.next).toBeUndefined()
	})
	it('cannot append while a read is invalidated or failed', async () => {
		const h = setup(Array.from({ length: 60 }, (_, i) => doc(i, 'post')))
		const collection = h.session.collection('journal')
		h.subscribe(collection)
		await settle()
		h.observers[0]!.next({ type: 'mutation' })
		collection.loadMore()
		expect(h.fetch).toHaveBeenCalledTimes(1)
		h.fetch.mockRejectedValueOnce(new Error('offline'))
		await changed()
		collection.loadMore()
		await settle()
		expect(h.fetch).toHaveBeenCalledTimes(2)
	})
	it('isolates search results, normalizes equivalent searches, and drops inactive old result arrays', async () => {
		const h = setup(Array.from({ length: 60 }, (_, i) => doc(i, 'post')))
		h.subscribe(h.session.proof)
		const first = h.session.collection('journal', 'page 59')
		expect(first).toBe(h.session.collection('journal', ' PAGE 59 '))
		const release = h.subscribe(first)
		await settle()
		expect(first.getSnapshot().data.documents).toHaveLength(1)
		release()
		const second = h.session.collection('journal', 'page 58')
		expect(first.getSnapshot().data.documents).toEqual([])
		expect(second.getSnapshot().data.documents).toEqual([])
		h.subscribe(second)
		await settle()
		expect(second.getSnapshot().data.documents[0]?._id).toBe('id-0058')
	})
	it('preserves the connection warning when inactive search caches are cleared', async () => {
		const h = setup([doc(0, 'post')])
		h.subscribe(h.session.proof)
		const first = h.session.collection('journal')
		const release = h.subscribe(first)
		await settle()
		release()
		h.observers[0]!.error()
		h.session.collection('journal', 'different')
		expect(first.getSnapshot().disconnected).toBe(true)
		h.subscribe(first)
		await settle()
		expect(first.getSnapshot().disconnected).toBe(true)
	})

	it('does not fetch inactive resources on changes; reopening refreshes them', async () => {
		const h = setup()
		h.subscribe(h.session.proof)
		const release = h.subscribe(h.session.pages)
		await settle()
		release()
		h.setData([doc(8)])
		h.observers[0]!.next({ type: 'mutation' })
		await changed()
		expect(h.fetch).toHaveBeenCalledTimes(3)
		h.subscribe(h.session.pages)
		await settle()
		expect(h.session.pages.getSnapshot().data.documents[0]?._id).toBe('id-0008')
	})
	it('does not let an invalidated append replace a refreshed collection', async () => {
		const h = setup(Array.from({ length: 60 }, (_, i) => doc(i, 'post')))
		const collection = h.session.collection('journal')
		h.subscribe(collection)
		await settle()
		const old = Promise.withResolvers<unknown>()
		h.fetch.mockReturnValueOnce(old.promise)
		collection.loadMore()
		await settle()
		h.setData([doc(900, 'post')])
		h.observers[0]!.next({ type: 'mutation' })
		await changed()
		old.resolve([{ ...doc(999, 'post'), pathname: '/wrong' }])
		await settle()
		expect(
			collection.getSnapshot().data.documents.map((item) => item._id),
		).toEqual(['id-0900'])
	})
})
