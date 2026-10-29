import { evaluate, parse } from 'groq-js'
import { describe, expect, it, vi } from 'vitest'
import { createPagesRegistry } from '../../src/studio/pages/registry.js'
import {
	collectionBatch,
	createNavigationQueries,
	type NavigationDocument,
} from '../../src/studio/pages/queries.js'
import { readPageSnapshot } from '../../src/studio/pages/snapshot.js'

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
			items: [
				{ schemaType: 'post', pathnameField: 'path' },
				{ schemaType: 'essay', pathnameField: 'route', titleField: 'heading' },
			],
		},
	],
})
const queries = createNavigationQueries(registry)
const record = (index: number, type = 'post') => ({
	_id: `id-${String(index).padStart(4, '0')}`,
	_type: type,
	_updatedAt: '2026-10-29T10:00:00Z',
	title: `Title ${index}`,
	path: `/journal/post-${index}`,
	pathname: { current: `/page-${index}` },
	body: 'Not navigation data',
})
const records = Array.from({ length: 126 }, (_, index) => record(index))
type QueryPlan = { query: string; params: Record<string, unknown> }
async function run(
	plan: QueryPlan,
	dataset: object[] = records,
): Promise<unknown> {
	return (
		await evaluate(parse(plan.query), { dataset, params: plan.params })
	).get()
}

describe('Pages navigator query plans', () => {
	it('reads ordinary types in ID-ordered batches, including alternate fields and incomplete pages', async () => {
		const data = [
			...Array.from({ length: 105 }, (_, index) => record(index, 'page')),
			record(200),
			{ _id: 'z', _type: 'landing', heading: 'Landing', route: '/landing' },
			{ _id: 'zz', _type: 'page' },
		]
		const first = (await run(queries.pages(), data)) as NavigationDocument[]
		expect(first).toHaveLength(100)
		expect(first[0]).toMatchObject({
			_id: 'id-0000',
			title: 'Title 0',
			pathname: '/page-0',
		})
		expect(first[0]).not.toHaveProperty('body')
		const next = (await run(
			queries.pages(first.at(-1)!._id),
			data,
		)) as NavigationDocument[]
		expect(next).toHaveLength(7)
		expect(next.at(-2)).toMatchObject({
			title: 'Landing',
			pathname: '/landing',
		})
		expect(next.at(-1)).toMatchObject({ _id: 'zz', pathname: null })
	})
	it('fetches exactly five recent items with deterministic ties and an all-item count', async () => {
		const data = [
			record(999, 'page'),
			...records,
			{ ...record(200), _updatedAt: '2026-10-29T11:00:00Z', path: null },
		]
		const result = (await run(queries.recent('journal'), data)) as {
			total: number
			documents: NavigationDocument[]
		}
		expect(result.total).toBe(127)
		expect(
			result.documents.map((document: NavigationDocument) => document._id),
		).toEqual(['id-0200', 'id-0000', 'id-0001', 'id-0002', 'id-0003'])
		expect(result.documents[0]?.pathname).toBeNull()
	})
	it('paginates ties without skipping the look-ahead item or repeating rows', async () => {
		const found: string[] = []
		let cursor: { updatedAt: string; id: string } | undefined
		do {
			const raw = (await run(
				queries.collection('journal', '', cursor),
			)) as NavigationDocument[]
			expect(raw.length).toBeLessThanOrEqual(51)
			const batch = collectionBatch(raw)
			found.push(...batch.documents.map((document) => document._id))
			cursor = batch.next
		} while (cursor)
		expect(found).toEqual(records.map((document) => document._id))
	})
	it('uses timestamp AND ID for a cursor, not ID alone', async () => {
		const data = [
			record(0),
			{ ...record(1), _updatedAt: '2026-10-29T09:00:00Z' },
			{ ...record(999), _updatedAt: '2026-10-29T11:00:00Z' },
		]
		const found = (await run(
			queries.collection('journal', '', {
				updatedAt: data[2]!._updatedAt,
				id: 'id-0999',
			}),
			data,
		)) as NavigationDocument[]
		expect(found.map((document) => document._id)).toEqual([
			'id-0000',
			'id-0001',
		])
	})
	it.each(['Title 125', '/post-125', '  TITLE 125  '])(
		'searches all collection items for %s, not just recent rows',
		async (search) => {
			const result = (await run(
				queries.collection('journal', search),
			)) as NavigationDocument[]
			expect(result.map((document) => document._id)).toEqual(['id-0125'])
		},
	)
	it('uses every item type’s own field mapping', async () => {
		const result = await run(queries.collection('journal', 'alternate'), [
			{
				_id: 'e',
				_type: 'essay',
				heading: 'An alternate heading',
				route: '/journal/essay',
				_updatedAt: records[0]!._updatedAt,
			},
		])
		expect(result).toMatchObject([
			{ title: 'An alternate heading', pathname: '/journal/essay' },
		])
	})
	it('keeps wildcard characters and query-like text literal and parameterized', async () => {
		const text = '* "] | order(_id) //'
		const plan = queries.collection('journal', text)
		expect(plan.query).not.toContain(text)
		expect(await run(plan)).toEqual([])
		expect(
			await run(queries.collection('journal', '*'), [
				{ ...record(0), title: 'Literal *' },
				record(1),
			]),
		).toMatchObject([{ title: 'Literal *' }])
	})
	it('quotes keyword fields as attributes', async () => {
		const special = createPagesRegistry({
			pages: [{ schemaType: 'page', pathnameField: 'path' }],
			collections: [
				{
					...registry.collections[0]!,
					items: [
						{ schemaType: 'post', pathnameField: 'true', titleField: 'null' },
					],
				},
			],
		})
		expect(
			await run(
				createNavigationQueries(special).collection('journal', 'keyword'),
				[{ _id: 'a', _type: 'post', null: 'Keyword', true: '/journal/a' }],
			),
		).toMatchObject([{ title: 'Keyword', pathname: '/journal/a' }])
	})
	it('does not infer publication status from the effective ID or original version ID', async () => {
		const result = (await run(queries.collection('journal'), [
			{ ...record(0), _originalId: 'versions.release.id-0000' },
		])) as NavigationDocument[]
		expect(result[0]).toMatchObject({
			_id: 'id-0000',
			_originalId: 'versions.release.id-0000',
		})
		expect(result[0]).not.toHaveProperty('status')
	})
	it('rejects unknown collections', () => {
		expect(() => queries.recent('missing')).toThrow('Unknown Pages collection')
		expect(() => queries.collection('missing')).toThrow(
			'Unknown Pages collection',
		)
	})
	it('does not supply a cursor for an empty or complete batch', () => {
		expect(collectionBatch([])).toEqual({ documents: [], next: undefined })
		const rows = records
			.slice(0, 50)
			.map((document) => ({ ...document, pathname: document.path }))
		expect(collectionBatch(rows).next).toBeUndefined()
		expect(rows).toHaveLength(50)
	})
})

describe('Ordinary-page snapshot assembly', () => {
	it('assembles the complete tree input across more than two request batches', async () => {
		const data = Array.from({ length: 205 }, (_, index) =>
			record(index, 'page'),
		)
		const fetch = vi.fn(
			async (plan: QueryPlan) =>
				(await run(plan, data)) as NavigationDocument[],
		)
		const signal = new AbortController().signal
		const result = await readPageSnapshot(queries, fetch, signal)
		expect(result).toHaveLength(205)
		expect(fetch).toHaveBeenCalledTimes(3)
		expect(fetch.mock.calls[1]![0].params.after).toBe('id-0099')
	})
	it('ends correctly after an exact-size batch and an empty final request', async () => {
		const data = Array.from({ length: 100 }, (_, index) =>
			record(index, 'page'),
		)
		const fetch = vi.fn(
			async (plan: QueryPlan) =>
				(await run(plan, data)) as NavigationDocument[],
		)
		expect(
			await readPageSnapshot(queries, fetch, new AbortController().signal),
		).toHaveLength(100)
		expect(fetch).toHaveBeenCalledTimes(2)
	})
	it('never starts a request with an already aborted signal', async () => {
		const fetch = vi.fn()
		await expect(
			readPageSnapshot(queries, fetch, AbortSignal.abort()),
		).rejects.toThrow()
		expect(fetch).not.toHaveBeenCalled()
	})
	it('discards a late result even when the transport ignores cancellation', async () => {
		const controller = new AbortController()
		const fetch = vi.fn(() => {
			controller.abort()
			return Promise.resolve([])
		})
		await expect(
			readPageSnapshot(queries, fetch, controller.signal),
		).rejects.toThrow()
	})
	it('propagates failures instead of returning a misleading partial tree', async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(records.slice(0, 100))
			.mockRejectedValueOnce(new Error('offline'))
		await expect(
			readPageSnapshot(queries, fetch, new AbortController().signal),
		).rejects.toThrow('offline')
	})
	it.each([
		{ batch: [record(1), record(0)] },
		{ batch: [record(0), record(0)] },
		{ batch: [{ ...record(0), _id: 'drafts.a' }] },
		{ batch: [{ ...record(0), _id: 'versions.release.a' }] },
	])('rejects unordered, duplicate, or raw IDs', async ({ batch }) => {
		await expect(
			readPageSnapshot(
				queries,
				vi.fn().mockResolvedValue(batch),
				new AbortController().signal,
			),
		).rejects.toThrow('effective document IDs')
	})
	it('bounds every response even if an adapter runs the wrong query', async () => {
		await expect(
			readPageSnapshot(
				queries,
				vi.fn().mockResolvedValue(records),
				new AbortController().signal,
			),
		).rejects.toThrow('oversized batch')
	})
})
