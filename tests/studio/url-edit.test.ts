import { evaluate, parse } from 'groq-js'
import { describe, expect, it, vi } from 'vitest'
import type { PagesClient } from '../../src/studio/pages/data-source.js'
import { createUrlEditController } from '../../src/studio/url/edit.js'

const routes = {
	pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
	collections: [
		{
			name: 'journal',
			title: 'Journal',
			routePrefix: '/journal',
			overview: { schemaType: 'page', pathname: '/insights' },
			items: [{ schemaType: 'post', slugField: 'slug.current' }],
		},
	],
}
const page = (_id = 'drafts.page-1', current = '/old/team') => ({
	_id,
	_type: 'page',
	_rev: 'rev-1',
	pathname: { current },
})
const savedRegistry = () => ({
	_id: 'sanityKit.folders',
	_type: 'sanityKitFolderRegistry',
	_rev: 'folders-1',
	schemaVersion: 1,
	folders: [{ _key: 'empty', pathname: '/empty' }],
})

/** Use the real GROQ and mutation shapes, so the test observes persisted paths. */
function transport(initial: Record<string, unknown>[] = [page()]) {
	const dataset = structuredClone(initial)
	let grants: unknown = [
		{ filter: '_id in path("**")', permissions: ['read', 'create', 'update'] },
	]
	let unknownWrite: 'before' | 'after' | undefined
	let afterMutation: (() => void) | undefined
	let beforeQuery: (() => Promise<void>) | undefined
	const fetch = vi.fn(
		async (
			query: string,
			params: Record<string, unknown>,
		): Promise<unknown> => {
			await beforeQuery?.()
			return (await evaluate(parse(query), { dataset, params })).get()
		},
	)
	const mutations: unknown[] = []
	const request = vi.fn(
		(options: {
			url: string
			body?: { mutations: Record<string, unknown>[] }
		}): Promise<unknown> => {
			if (options.url.endsWith('/acl')) return Promise.resolve(grants)
			if (!options.body) throw new Error('Unexpected request')
			mutations.push(options.body)
			if (unknownWrite === 'before')
				throw new Error('Disconnected before confirmation')
			const mutation = options.body.mutations[0]!
			if (mutation.create) dataset.push({ ...mutation.create, _rev: 'created' })
			else {
				const patch = mutation.patch as {
					id: string
					insert: { items: object[] }
				}
				const registry = dataset.find((item) => item._id === patch.id)!
				registry.folders = [
					...(registry.folders as object[]),
					...patch.insert.items,
				]
				registry._rev = 'updated'
			}
			afterMutation?.()
			if (unknownWrite === 'after') throw new Error('Disconnected after write')
			return Promise.resolve({
				transactionId: 'tx-1',
				results: [
					{
						id: 'sanityKit.folders',
						operation: mutation.create ? 'create' : 'update',
					},
				],
			})
		},
	)
	const source = {
		fetch,
		request,
		config: () => ({ projectId: 'proof', dataset: 'development' }),
	}
	const client = {
		...source,
		withConfig: vi.fn(() => source),
	} as unknown as PagesClient
	return {
		dataset,
		mutations,
		fetch,
		request,
		controller: createUrlEditController(routes, client),
		setGrants(value: unknown) {
			grants = value
		},
		setUnknownWrite(value: typeof unknownWrite) {
			unknownWrite = value
		},
		afterMutation(callback: () => void) {
			afterMutation = callback
		},
		beforeQuery(callback: () => Promise<void>) {
			beforeQuery = callback
		},
	}
}

describe('URL input edit preparation', () => {
	it('loads saved and inferred folders without writing, including invalid URLs that can be corrected', async () => {
		const io = transport([
			page(),
			savedRegistry(),
			page('drafts.bad', '/bad//path/'),
		])
		expect(await io.controller.load(page())).toEqual({
			status: 'loaded',
			editable: true,
			folders: [{ pathname: '/empty' }, { pathname: '/old' }],
		})
		expect(io.mutations).toEqual([])
		expect(io.request.mock.calls[0]?.[0]).toMatchObject({
			url: '/projects/proof/datasets/development/acl',
			fetch: { cache: 'no-store' },
		})
	})

	it.each([
		[],
		null,
		[{ filter: '_type == "page"', permissions: ['read'] }],
		[{ filter: 'true', permissions: ['create'] }],
		[{ filter: '_id in path("*")', permissions: ['read'] }],
	])('refuses incomplete access evidence %j', async (grants) => {
		const io = transport()
		io.setGrants(grants)
		expect(await io.controller.load(page())).toEqual({
			status: 'blocked',
			reason: 'unknown-read-access',
		})
		expect(io.fetch).not.toHaveBeenCalled()
	})

	it.each([
		[page('page-1'), 'published-document'],
		[page('versions.release.page-1'), 'release-version'],
	] as const)(
		'blocks edits when the current document has protected versions',
		async (other, reason) => {
			const io = transport([page(), other])
			expect(await io.controller.load(page())).toMatchObject({
				status: 'loaded',
				editable: false,
				reason,
			})
			expect(
				await io.controller.prepare({
					document: page(),
					storedValue: '/new/team',
					readOnly: false,
				}),
			).toEqual({ status: 'blocked', reason })
			expect(io.mutations).toEqual([])
		},
	)

	it('checks conflicts before preserving prior and destination folders, without patching the page', async () => {
		const original = page()
		const io = transport([original])
		expect(
			await io.controller.prepare({
				document: original,
				storedValue: '/new//team/',
				readOnly: false,
			}),
		).toEqual({
			status: 'ready',
			candidate: {
				fieldPath: 'pathname.current',
				storedValue: '/new/team',
				url: { pathname: '/new/team', prefix: '/new', slug: 'team' },
			},
		})
		const saved = io.dataset.find((item) => item._id === 'sanityKit.folders')!
		expect(saved.folders).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ pathname: '/old' }),
				expect.objectContaining({ pathname: '/new' }),
			]),
		)
		expect(io.dataset.find((item) => item._id === original._id)).toEqual(
			original,
		)
		expect(io.mutations).toHaveLength(2)
	})

	it('checks full URL occupancy across different storage modes', async () => {
		const io = transport([
			page(),
			{ _id: 'other', _type: 'post', _rev: '1', slug: { current: 'story' } },
		])
		expect(
			await io.controller.prepare({
				document: page(),
				storedValue: '/journal/story',
				readOnly: false,
			}),
		).toEqual({ status: 'blocked', reason: 'url-in-use' })
		expect(io.mutations).toEqual([])
	})

	it('preserves a stored draft folder when local form state already differs', async () => {
		const io = transport([page('drafts.page-1', '/stored/team')])
		expect(
			await io.controller.prepare({
				document: page(),
				storedValue: '/new/team',
				readOnly: false,
			}),
		).toMatchObject({ status: 'ready' })
		const saved = io.dataset.find((item) => item._id === 'sanityKit.folders')!
		expect(
			(saved.folders as { pathname: string }[])
				.map((item) => item.pathname)
				.sort(),
		).toEqual(['/new', '/old', '/stored'])
	})

	it('rechecks occupancy after folder writes before returning a native patch candidate', async () => {
		const io = transport()
		io.afterMutation(() => {
			if (!io.dataset.some((item) => item._id === 'competitor'))
				io.dataset.push(page('competitor', '/new/team'))
		})
		expect(
			await io.controller.prepare({
				document: page(),
				storedValue: '/new/team',
				readOnly: false,
			}),
		).toEqual({ status: 'blocked', reason: 'url-in-use' })
	})

	it('keeps collection slug storage and does not save collection prefixes as folders', async () => {
		const document = {
			_id: 'drafts.post',
			_type: 'post',
			_rev: '1',
			slug: { current: 'old' },
		}
		const io = transport([document])
		expect(
			await io.controller.prepare({
				document,
				storedValue: 'new',
				readOnly: false,
			}),
		).toMatchObject({
			status: 'ready',
			candidate: { storedValue: 'new', url: { pathname: '/journal/new' } },
		})
		expect(io.mutations).toEqual([])
	})

	it('rechecks versions after folder writes instead of offering a newly published document for patching', async () => {
		const io = transport()
		io.afterMutation(() => {
			if (!io.dataset.some((item) => item._id === 'page-1'))
				io.dataset.push(page('page-1'))
		})
		expect(
			await io.controller.prepare({
				document: page(),
				storedValue: '/new/team',
				readOnly: false,
			}),
		).toEqual({ status: 'blocked', reason: 'published-document' })
	})

	it('blocks read-only actions without requests', async () => {
		const io = transport()
		expect(
			await io.controller.prepare({
				document: page(),
				storedValue: '/new',
				readOnly: true,
			}),
		).toEqual({ status: 'blocked', reason: 'read-only' })
		expect(
			await io.controller.createFolder({
				document: page(),
				pathname: '/new',
				readOnly: true,
			}),
		).toEqual({ status: 'blocked', reason: 'read-only' })
		expect(io.request).not.toHaveBeenCalled()
	})

	it('adds an empty folder and ancestors only on the explicit action', async () => {
		const io = transport()
		expect(
			await io.controller.createFolder({
				document: page(),
				pathname: '/new/team',
				readOnly: false,
			}),
		).toEqual({ status: 'saved' })
		expect(
			io.dataset.find((item) => item._id === 'sanityKit.folders')!
				.folders as object[],
		).toEqual([
			expect.objectContaining({ pathname: '/new' }),
			expect.objectContaining({ pathname: '/new/team' }),
		])
		expect(
			await io.controller.createFolder({
				document: page(),
				pathname: '/insights',
				readOnly: false,
			}),
		).toEqual({ status: 'blocked', reason: 'collection-group' })
	})

	it('keeps an uncertain write blocked across invalidation until exact keys and paths are confirmed', async () => {
		const io = transport()
		io.setUnknownWrite('before')
		const request = { document: page(), pathname: '/new', readOnly: false }
		expect(await io.controller.createFolder(request)).toEqual({
			status: 'blocked',
			reason: 'folder-outcome-unknown',
		})
		io.controller.invalidate()
		io.setUnknownWrite(undefined)
		expect(await io.controller.createFolder(request)).toEqual({
			status: 'blocked',
			reason: 'folder-outcome-unknown',
		})
		expect(io.mutations).toHaveLength(1)
	})

	it('reconciles a saved but unacknowledged folder before permitting another action', async () => {
		const io = transport()
		io.setUnknownWrite('after')
		const request = { document: page(), pathname: '/new', readOnly: false }
		expect(await io.controller.createFolder(request)).toEqual({
			status: 'blocked',
			reason: 'folder-outcome-unknown',
		})
		io.controller.invalidate()
		io.setUnknownWrite(undefined)
		expect(await io.controller.load(page())).toMatchObject({
			status: 'loaded',
			editable: true,
		})
		expect(await io.controller.createFolder(request)).toEqual({
			status: 'saved',
		})
		expect(io.mutations).toHaveLength(1)
	})

	it('serializes mutations and rejects late results when invalidated', async () => {
		const io = transport()
		let release!: () => void
		const pending = new Promise<void>((resolve) => {
			release = resolve
		})
		io.beforeQuery(() => pending)
		const first = io.controller.prepare({
			document: page(),
			storedValue: '/new/team',
			readOnly: false,
		})
		expect(
			await io.controller.createFolder({
				document: page(),
				pathname: '/new',
				readOnly: false,
			}),
		).toEqual({ status: 'blocked', reason: 'busy' })
		io.controller.invalidate()
		release()
		expect(await first).toEqual({ status: 'blocked', reason: 'aborted' })
		expect(io.mutations).toEqual([])
	})

	it('keeps display loading independent of unrelated field action invalidation', async () => {
		const io = transport()
		let release!: () => void
		const pending = new Promise<void>((resolve) => {
			release = resolve
		})
		io.beforeQuery(() => pending)
		const load = io.controller.load(page())
		io.controller.invalidate()
		release()
		expect(await load).toMatchObject({ status: 'loaded', editable: true })
		expect(io.mutations).toEqual([])
	})

	it('still cancels display loading through the caller signal', async () => {
		const io = transport()
		let release!: () => void
		const pending = new Promise<void>((resolve) => {
			release = resolve
		})
		io.beforeQuery(() => pending)
		const abort = new AbortController()
		const load = io.controller.load(page(), abort.signal)
		abort.abort()
		release()
		expect(await load).toEqual({ status: 'blocked', reason: 'aborted' })
		expect(io.mutations).toEqual([])
	})
})
