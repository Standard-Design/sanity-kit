/** Repeatable work/retention measurement of the actual Pages session. */
import assert from 'node:assert/strict'
import { mock } from 'node:test'
import { setImmediate as drain } from 'node:timers/promises'
import { queryObjects } from 'node:v8'
import { evaluate, parse } from 'groq-js'
import {
	CHANGE_DELAY_MS,
	RECONCILE_MS,
	createPagesDataSession,
	type PagesDataResource,
} from '../../../src/studio/pages/data-session.js'
import type {
	PageQueryPlan,
	PagesDataEvent,
	PagesDataSource,
} from '../../../src/studio/pages/data-source.js'
import {
	FOLDER_REGISTRY_ID,
	folderRegistryQuery,
} from '../../../src/studio/pages/folder-registry.js'
import { createPagesRuntime } from '../../../src/studio/pages/runtime.js'
import { queryKind } from './measurements.js'

const pageCount = 1_000
const postCount = 5_000
const savedFolderCount = 20
const runtime = createPagesRuntime({
	previewUrl: 'https://preview.example',
	pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
	collections: [
		{
			name: 'journal',
			title: 'Journal',
			index: { schemaType: 'page', pathname: '/journal' },
			routePrefix: '/journal',
			items: [{ schemaType: 'post', pathnameField: 'pathname.current' }],
		},
	],
})
const date = '2026-11-19T12:00:00Z'
const page = (id: string, path: string, type: 'page' | 'post' = 'page') => ({
	_id: id,
	_type: type,
	title: id,
	pathname: { current: path },
	_originalId: id,
	_updatedAt: date,
	body: 'Synthetic body',
})
const ordinary = Array.from({ length: pageCount }, (_, i) => {
	const id = `page-${String(i).padStart(4, '0')}`
	return page(id, i === 0 ? '/journal' : `/pages/${id}`)
})
const posts = Array.from({ length: postCount }, (_, i) => {
	const id = `post-${String(i).padStart(4, '0')}`
	return page(id, `/journal/${id}`, 'post')
})
const folderRegistry = {
	_id: FOLDER_REGISTRY_ID,
	_type: 'sanityKitFolderRegistry',
	_rev: 'fixture-revision',
	schemaVersion: 1,
	folders: Array.from({ length: savedFolderCount }, (_, i) => ({
		_key: `folder-${i}`,
		pathname: `/folder-${i}`,
	})),
}

function createProfile() {
	const dataset = [...ordinary, ...posts, folderRegistry]
	const parsed = new Map<string, ReturnType<typeof parse>>()
	let observer: Parameters<PagesDataSource['listen']>[0] | undefined
	let pending = 0
	let counts = new Map<string, { queries: number; bytes: number }>()
	const fetch: PagesDataSource['fetch'] = async <T>(
		plan: PageQueryPlan,
		signal: AbortSignal,
	) => {
		const kind = queryKind(plan.query, plan.params)
		assert.notEqual(kind, 'other', 'Unclassified navigator query')
		const counter = counts.get(kind) ?? { queries: 0, bytes: 0 }
		counts.set(kind, counter)
		counter.queries++
		pending++
		try {
			let query = parsed.get(plan.query)
			if (!query) {
				query = parse(plan.query)
				parsed.set(plan.query, query)
			}
			const result: unknown = await (
				await evaluate(query, { dataset, params: plan.params })
			).get()
			signal.throwIfAborted()
			counter.bytes += Buffer.byteLength(JSON.stringify(result))
			return result as T
		} finally {
			pending--
		}
	}
	const source: PagesDataSource = {
		fetch,
		fetchFolderRegistry: (signal) =>
			fetch(
				{
					query: folderRegistryQuery,
					params: { registryId: FOLDER_REGISTRY_ID },
				},
				signal,
			),
		listen(next) {
			assert.equal(observer, undefined, 'Expected one shared listener')
			observer = next
			return {
				unsubscribe() {
					observer = undefined
				},
			}
		},
	}
	const session = createPagesDataSession(runtime, source)
	const active = new Set<PagesDataResource<unknown>>()
	const emit = (event: PagesDataEvent) => {
		assert.ok(observer)
		observer.next(event)
	}
	const settle = async () => {
		await drain()
		assert.equal(pending, 0)
		for (const resource of active) {
			const { loading, refreshing, error } = resource.getSnapshot()
			assert.ok(!loading && !refreshing && !error)
		}
	}
	return {
		session,
		dataset,
		emit,
		settle,
		watch<T>(resource: PagesDataResource<T>) {
			assert.ok(!active.has(resource))
			active.add(resource)
			const release = resource.subscribe(() => {})
			return () => {
				active.delete(resource)
				release()
			}
		},
		async sample(
			this: void,
			label: string,
			action: () => void | Promise<void>,
		) {
			counts = new Map()
			await action()
			await settle()
			const byKind = Object.fromEntries(counts)
			const queries = [...counts.values()].reduce(
				(sum, count) => sum + count.queries,
				0,
			)
			const bytes = [...counts.values()].reduce(
				(sum, count) => sum + count.bytes,
				0,
			)
			return { label, queries, bytes, byKind }
		},
	}
}

async function measureReads() {
	const p = createProfile()
	const { session } = p
	let closeTree!: () => void
	let closeHeader!: () => void
	let closeCollection!: () => void
	const collection = session.collection('journal')
	const step = p.sample
	const result = [
		await step('Open tree and header', () => {
			const close = [
				p.watch(session.pages),
				p.watch(session.folders),
				p.watch(session.recent('journal')),
			]
			closeTree = () => close.forEach((release) => release())
			const header = [
				p.watch(
					session.identity(runtime.model.previewQuery('/journal/post-0000')),
				),
				p.watch(
					session.identity(runtime.model.documentQuery('post-0000', 'post')),
				),
			]
			closeHeader = () => header.forEach((release) => release())
		}),
		// Sample a delayed welcome independently of the initial read.
		await step('Listener becomes ready after the first reads', () =>
			p.emit({ type: 'welcome' }),
		),
		await step('Three post body saves in one change window', () => {
			for (let i = 0; i < 3; i++) {
				p.dataset[pageCount] = {
					...posts[0]!,
					body: `Updated body ${i}`,
					_updatedAt: '2026-11-19T13:00:00Z',
				}
				p.emit({
					type: 'mutation',
					documentId: posts[0]!._id,
					transition: 'update',
				})
			}
			mock.timers.tick(CHANGE_DELAY_MS)
		}),
		await step('Three post body saves in separate change windows', async () => {
			for (let i = 0; i < 3; i++) {
				p.dataset[pageCount] = {
					...posts[0]!,
					body: `Another edit ${i}`,
					_updatedAt: `2026-11-19T13:00:0${i + 1}Z`,
				}
				p.emit({
					type: 'mutation',
					documentId: posts[0]!._id,
					transition: 'update',
				})
				mock.timers.tick(CHANGE_DELAY_MS)
				await p.settle()
			}
		}),
		await step('Idle reconciliation while tree is visible', () => {
			mock.timers.tick(RECONCILE_MS - CHANGE_DELAY_MS * 4)
		}),
		await step('Browse all posts', () => {
			closeTree()
			closeCollection = p.watch(collection)
		}),
		await step('Load five more collection batches', async () => {
			for (let i = 0; i < 5; i++) {
				collection.loadMore()
				await p.settle()
			}
		}),
		await step('Ordinary page body save while browsing posts', () => {
			p.dataset[1] = {
				...ordinary[1]!,
				body: 'New page body',
				_updatedAt: '2026-11-19T13:00:00Z',
			}
			p.emit({
				type: 'mutation',
				documentId: ordinary[1]!._id,
				transition: 'update',
			})
			mock.timers.tick(CHANGE_DELAY_MS)
		}),
		await step('Disconnect while browsing posts', () => {
			p.emit({ type: 'reconnect' })
			assert.ok(collection.getSnapshot().disconnected)
		}),
		await step('Reconnect after loading six batches', () => {
			p.emit({ type: 'welcome' })
			assert.ok(!collection.getSnapshot().disconnected)
		}),
		await step('Search posts for post-04', async () => {
			closeCollection()
			const search = session.collection('journal', 'post-04')
			closeCollection = p.watch(search)
			await p.settle()
			assert.equal(search.getSnapshot().data.documents.length, 50)
			assert.ok(search.getSnapshot().data.next)
		}),
		await step('Post notification with only the header mounted', () => {
			closeCollection()
			p.emit({
				type: 'mutation',
				documentId: posts[0]!._id,
				transition: 'update',
			})
			mock.timers.tick(CHANGE_DELAY_MS)
		}),
	]
	assert.equal(session.pages.getSnapshot().data.documents.length, pageCount)
	assert.equal(session.folders.getSnapshot().data.length, savedFolderCount)
	assert.equal(collection.getSnapshot().data.documents.length, 0)
	closeHeader()
	return result
}

async function measureRetention() {
	const p = createProfile()
	const { session } = p
	const count = () =>
		queryObjects(session.pages.constructor, { format: 'count' })
	const closeHeader = p.watch(
		session.identity(runtime.model.previewQuery('/journal/post-0000')),
	)
	await p.settle()
	const before = count()
	let previousCollection: ReturnType<typeof session.collection> | undefined
	let lastIdentity: ReturnType<typeof session.identity> | undefined
	const searchCount = 200
	for (let i = 0; i < searchCount; i++) {
		const id = posts[i]!._id
		const plan = runtime.model.documentQuery(id, 'post')
		const identity = session.identity(plan)
		const collection = session.collection('journal', id)
		const closeIdentity = p.watch(identity)
		const closeSearch = p.watch(collection)
		await p.settle()
		assert.equal(identity.getSnapshot().data.length, 1)
		assert.equal(collection.getSnapshot().data.documents.length, 1)
		if (previousCollection)
			assert.equal(previousCollection.getSnapshot().data.documents.length, 0)
		closeIdentity()
		assert.equal(identity.getSnapshot().data.length, 0)
		closeSearch()
		previousCollection = collection
		lastIdentity = identity
	}
	const during = count()
	const previousSearchRows =
		previousCollection!.getSnapshot().data.documents.length
	closeHeader()
	const afterLastUnsubscribe = count()
	assert.equal(previousCollection!.getSnapshot().data.documents.length, 0)
	assert.equal(lastIdentity!.getSnapshot().data.length, 0)
	return {
		resourceConstructor: session.pages.constructor,
		metrics: {
			searchCount,
			identityCount: searchCount,
			resourceObjects: { before, during, afterLastUnsubscribe },
			lastSearchRowsWhileHeaderOpen: previousSearchRows,
			lastSearchRowsAfterLastUnsubscribe: 0,
		},
	}
}

mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
try {
	const reads = await measureReads()
	await drain()
	const { resourceConstructor, metrics } = await measureRetention()
	await drain()
	const afterDroppingSession = queryObjects(resourceConstructor, {
		format: 'count',
	})
	console.log(
		JSON.stringify(
			{
				fixture: { pageCount, postCount, savedFolderCount },
				reads,
				retention: { ...metrics, afterDroppingSession },
			},
			null,
			2,
		),
	)
} finally {
	mock.timers.reset()
}
