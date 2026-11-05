import { evaluate, parse } from 'groq-js'
import { describe, expect, it, vi } from 'vitest'
import { createFolderSynchronizer } from '../../src/studio/folders/synchronize.js'
import type { PagesClient } from '../../src/studio/pages/data-source.js'

const routes = {
	pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
}
const page = (path = '/about/team') => ({
	_id: 'drafts.team',
	_type: 'page',
	_rev: 'page-1',
	pathname: { current: path },
})
const saved = () => ({
	_id: 'sanityKit.folders',
	_type: 'sanityKitFolderRegistry',
	_rev: 'folders-1',
	schemaVersion: 1,
	folders: [{ _key: 'existing', pathname: '/empty', detail: 'keep me' }],
	custom: 'retain me',
})

/** Exercise the real planner, loader, writer and GROQ against a small dataset. */
function transport(initial: Record<string, unknown>[] = [page()]) {
	const dataset = structuredClone(initial)
	let grants: unknown = [{ filter: 'true', permissions: ['read'] }]
	let failure: 'before' | 'after' | 'rejected' | undefined
	let afterWrite: (() => void) | undefined
	const fetch = vi.fn(
		async (query: string, params: Record<string, unknown>): Promise<unknown> =>
			(await evaluate(parse(query), { dataset, params })).get(),
	)
	const mutate = vi.fn(
		(body: { mutations: Record<string, unknown>[] }): Promise<unknown> => {
			if (failure === 'before') throw new Error('lost connection')
			if (failure === 'rejected')
				throw Object.assign(new Error('Denied'), { statusCode: 403 })
			const mutation = body.mutations[0]!
			let operation: 'create' | 'update'
			if (mutation.create) {
				operation = 'create'
				dataset.push({
					...structuredClone(mutation.create),
					_rev: 'created',
				})
			} else {
				operation = 'update'
				const patch = mutation.patch as {
					id: string
					ifRevisionID: string
					insert: { items: object[] }
				}
				const registry = dataset.find((item) => item._id === patch.id)!
				if (registry._rev !== patch.ifRevisionID)
					throw Object.assign(new Error('Conflict'), { statusCode: 409 })
				registry.folders = [
					...(registry.folders as object[]),
					...structuredClone(patch.insert.items),
				]
				registry._rev = 'updated'
			}
			afterWrite?.()
			if (failure === 'after') throw new Error('lost acknowledgment')
			return Promise.resolve({
				transactionId: 'transaction-1',
				results: [{ id: 'sanityKit.folders', operation }],
			})
		},
	)
	const request = vi.fn(
		async (options: {
			url: string
			body?: { mutations: Record<string, unknown>[] }
		}) => {
			if (options.url.endsWith('/acl')) return grants
			if (!options.body) throw new Error('Unexpected request')
			return mutate(options.body)
		},
	)
	const source = {
		fetch,
		request,
		config: () => ({ projectId: 'project1', dataset: 'test' }),
	}
	const client = { withConfig: vi.fn(() => source) } as unknown as PagesClient
	return {
		dataset,
		fetch,
		request,
		mutate,
		client,
		service: createFolderSynchronizer(routes, client),
		grants(value: unknown) {
			grants = value
		},
		fail(value: typeof failure) {
			failure = value
		},
		afterWrite(value: () => void) {
			afterWrite = value
		},
	}
}

function deferred<T>() {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((done) => {
		resolve = done
	})
	return { promise, resolve }
}

describe('checked Pages folder synchronization', () => {
	it('creates an empty nested folder and its ancestors without changing pages', async () => {
		const io = transport([saved(), page()])
		const originalPage = structuredClone(io.dataset[1])
		expect(await io.service.create('/prepared/team')).toEqual({
			status: 'synced',
			count: 2,
		})
		expect(io.dataset[1]).toEqual(originalPage)
		expect(io.dataset[0]).toMatchObject({
			custom: 'retain me',
			folders: [
				{ _key: 'existing', pathname: '/empty', detail: 'keep me' },
				{ pathname: '/prepared' },
				{ pathname: '/prepared/team' },
			],
		})
		expect(await io.service.create('/prepared/team')).toEqual({
			status: 'synced',
			count: 0,
		})
		expect(io.mutate).toHaveBeenCalledOnce()
	})

	it('checks fresh access for creation and refuses unreadable inventory', async () => {
		const io = transport()
		io.grants([])
		expect(await io.service.create('/new')).toMatchObject({
			status: 'blocked',
			reason: 'unknown-read-access',
		})
		expect(io.fetch).not.toHaveBeenCalled()
		expect(io.mutate).not.toHaveBeenCalled()
		io.grants([{ filter: 'true', permissions: ['read'] }])
		expect(await io.service.create('/new')).toEqual({
			status: 'synced',
			count: 1,
		})
		expect(io.mutate).toHaveBeenCalledOnce()
	})

	it('prevents creation and synchronization from overlapping in either direction', async () => {
		const io = transport()
		const acl = deferred<unknown>()
		io.request.mockImplementationOnce(() => acl.promise)
		const first = io.service.create('/new')
		expect(await io.service.synchronize()).toEqual({
			status: 'blocked',
			reason: 'busy',
		})
		expect(await io.service.create('/other')).toEqual({
			status: 'blocked',
			reason: 'busy',
		})
		acl.resolve([{ filter: 'true', permissions: ['read'] }])
		expect(await first).toEqual({ status: 'synced', count: 1 })
		const nextAcl = deferred<unknown>()
		io.request.mockImplementationOnce(() => nextAcl.promise)
		const sync = io.service.synchronize()
		expect(await io.service.create('/other')).toEqual({
			status: 'blocked',
			reason: 'busy',
		})
		nextAcl.resolve([{ filter: 'true', permissions: ['read'] }])
		await sync
		expect(io.mutate).toHaveBeenCalledTimes(2)
	})

	it('keeps uncertain creation evidence when synchronization is requested', async () => {
		const io = transport()
		io.fail('before')
		expect(await io.service.create('/new')).toEqual({
			status: 'blocked',
			reason: 'outcome-unknown',
		})
		io.fail(undefined)
		expect(await io.service.synchronize()).toEqual({
			status: 'blocked',
			reason: 'outcome-unknown',
		})
		expect(await io.service.create('/other')).toEqual({
			status: 'blocked',
			reason: 'outcome-unknown',
		})
		expect(io.mutate).toHaveBeenCalledOnce()
	})

	it('reconciles an uncertain sync before creating a different folder', async () => {
		const io = transport()
		io.fail('after')
		await io.service.synchronize()
		io.fail(undefined)
		expect(await io.service.create('/new')).toEqual({
			status: 'synced',
			count: 1,
		})
		expect(io.mutate).toHaveBeenCalledTimes(2)
	})

	it('does not write again when retrying an acknowledged-lost creation', async () => {
		const io = transport()
		io.fail('after')
		await io.service.create('/new/team')
		io.fail(undefined)
		expect(await io.service.create('/new/team')).toEqual({
			status: 'synced',
			count: 0,
		})
		expect(io.mutate).toHaveBeenCalledOnce()
	})

	it('does no work at construction and adds missing folders without changing pages or metadata', async () => {
		const io = transport([saved(), page('/about/company/team')])
		const originalPage = structuredClone(io.dataset[1])
		expect(io.request).not.toHaveBeenCalled()
		expect(await io.service.synchronize()).toEqual({
			status: 'synced',
			count: 2,
		})
		expect(io.dataset[1]).toEqual(originalPage)
		expect(io.dataset[0]).toMatchObject({
			custom: 'retain me',
			folders: [
				{ _key: 'existing', pathname: '/empty', detail: 'keep me' },
				{ pathname: '/about' },
				{ pathname: '/about/company' },
			],
		})
		expect(await io.service.synchronize()).toEqual({
			status: 'synced',
			count: 0,
		})
		expect(io.mutate).toHaveBeenCalledTimes(1)
	})

	it('allows a read-only account to confirm that nothing needs saving', async () => {
		const io = transport([page('/team')])
		expect(await io.service.synchronize()).toEqual({
			status: 'synced',
			count: 0,
		})
		expect(io.mutate).not.toHaveBeenCalled()
		expect(io.dataset).toHaveLength(1)
	})

	it('requires proven read access before reading or writing the inventory', async () => {
		const io = transport()
		io.grants([
			{
				filter: '_type == "page" && !(_id in path("drafts.**"))',
				permissions: ['read'],
			},
		])
		const result = await io.service.synchronize()
		expect(result).toMatchObject({
			status: 'blocked',
			reason: 'unknown-read-access',
		})
		expect(io.fetch).not.toHaveBeenCalled()
		expect(io.mutate).not.toHaveBeenCalled()
	})

	it('accepts scoped custom grants and checks access again on the next run', async () => {
		const io = transport()
		io.grants([
			{
				filter: '_type == "page" || _id == "sanityKit.folders"',
				permissions: ['read'],
			},
		])
		expect(await io.service.synchronize()).toEqual({
			status: 'synced',
			count: 1,
		})
		io.grants([])
		expect(await io.service.synchronize()).toMatchObject({
			status: 'blocked',
			reason: 'unknown-read-access',
		})
		expect(io.mutate).toHaveBeenCalledTimes(1)
	})

	it('reports an ACL network failure without touching folders', async () => {
		const io = transport()
		io.request.mockRejectedValueOnce(new Error('offline'))
		expect(await io.service.synchronize()).toEqual({
			status: 'blocked',
			reason: 'access-unavailable',
		})
		expect(io.fetch).not.toHaveBeenCalled()
	})

	it('rejects malformed inventory and does not automatically retry server rejection', async () => {
		const malformed = transport([page('/about//team')])
		expect(await malformed.service.synchronize()).toEqual({
			status: 'blocked',
			reason: 'invalid-inventory',
		})
		expect(malformed.mutate).not.toHaveBeenCalled()
		const denied = transport()
		denied.fail('rejected')
		expect(await denied.service.synchronize()).toEqual({
			status: 'blocked',
			reason: 'permission-denied',
		})
		expect(denied.mutate).toHaveBeenCalledTimes(1)
	})

	it('does not overlap runs, then allows a later explicit attempt', async () => {
		const io = transport()
		const acl = deferred<unknown>()
		io.request.mockImplementationOnce(() => acl.promise)
		const first = io.service.synchronize()
		expect(await io.service.synchronize()).toEqual({
			status: 'blocked',
			reason: 'busy',
		})
		acl.resolve([{ filter: 'true', permissions: ['read'] }])
		expect(await first).toEqual({ status: 'synced', count: 1 })
		expect(await io.service.synchronize()).toEqual({
			status: 'synced',
			count: 0,
		})
		expect(io.mutate).toHaveBeenCalledTimes(1)
	})

	it('blocks blind retries after an uncertain write with no visible matching records', async () => {
		const io = transport()
		io.fail('before')
		expect(await io.service.synchronize()).toEqual({
			status: 'blocked',
			reason: 'outcome-unknown',
		})
		io.fail(undefined)
		expect(await io.service.synchronize()).toEqual({
			status: 'blocked',
			reason: 'outcome-unknown',
		})
		expect(io.mutate).toHaveBeenCalledTimes(1)
	})

	it('requires exact keys as well as paths when reconciling an uncertain write', async () => {
		const io = transport()
		io.fail('after')
		await io.service.synchronize()
		const registry = io.dataset.find(
			(document) => document._id === 'sanityKit.folders',
		)!
		const folder = (
			registry.folders as { _key: string; pathname: string }[]
		)[0]!
		const originalKey = folder._key
		folder._key = 'another-editors-key'
		io.fail(undefined)
		expect(await io.service.synchronize()).toEqual({
			status: 'blocked',
			reason: 'outcome-unknown',
		})
		folder._key = originalKey
		expect(await io.service.synchronize()).toEqual({
			status: 'synced',
			count: 0,
		})
		expect(io.mutate).toHaveBeenCalledTimes(1)
	})

	it('reconciles a committed write before saving subsequently imported paths', async () => {
		const io = transport()
		io.fail('after')
		await io.service.synchronize()
		io.fail(undefined)
		io.dataset.push({ ...page('/new/page'), _id: 'drafts.new' })
		expect(await io.service.synchronize()).toEqual({
			status: 'synced',
			count: 1,
		})
		expect(io.mutate).toHaveBeenCalledTimes(2)
	})

	it('cancels before dispatch without writing', async () => {
		const io = transport()
		const abort = new AbortController()
		abort.abort()
		expect(await io.service.synchronize(abort.signal)).toEqual({
			status: 'blocked',
			reason: 'aborted',
		})
		expect(io.request).not.toHaveBeenCalled()
	})

	it('preserves uncertain results when cancellation arrives after dispatch', async () => {
		const io = transport()
		const abort = new AbortController()
		io.afterWrite(() => abort.abort())
		io.fail('after')
		expect(await io.service.synchronize(abort.signal)).toEqual({
			status: 'blocked',
			reason: 'outcome-unknown',
		})
		io.fail(undefined)
		expect(await io.service.synchronize()).toEqual({
			status: 'synced',
			count: 0,
		})
		expect(io.mutate).toHaveBeenCalledTimes(1)
	})

	it('keeps a valid acknowledgment successful despite late cancellation', async () => {
		const io = transport()
		const abort = new AbortController()
		io.afterWrite(() => abort.abort())
		expect(await io.service.synchronize(abort.signal)).toEqual({
			status: 'synced',
			count: 1,
		})
	})

	it('keeps access and inventory scope consistent if caller configuration changes', async () => {
		const io = transport()
		const mutable = {
			pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
		}
		const service = createFolderSynchronizer(mutable, io.client)
		mutable.pages[0]!.schemaType = 'different'
		io.grants([
			{
				filter: '_type == "page" || _id == "sanityKit.folders"',
				permissions: ['read'],
			},
		])
		expect(await service.synchronize()).toEqual({ status: 'synced', count: 1 })
	})
})
