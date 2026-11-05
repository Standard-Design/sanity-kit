import { evaluate, parse } from 'groq-js'
import { describe, expect, it, vi } from 'vitest'
import { createFolderSynchronizer } from '../../src/studio/folders/synchronize.js'
import type { PagesClient } from '../../src/studio/pages/data-source.js'

const routes = {
	pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
}
const folder = { _key: 'original', pathname: '/empty', custom: 'retain' }
const registry = () => ({
	_id: 'sanityKit.folders',
	_type: 'sanityKitFolderRegistry',
	_rev: 'r1',
	schemaVersion: 1,
	folders: [{ ...folder }, { _key: 'other', pathname: '/other' }],
	custom: 'keep',
})
const page = (id: string, path: unknown) => ({
	_id: id,
	_type: 'page',
	_rev: 'p1',
	pathname: { current: path },
})

/** Real GROQ, planner, access and writer; only the Content Lake transport is simulated. */
function transport(documents: Record<string, unknown>[] = []) {
	const current = registry()
	const dataset: Record<string, unknown>[] = [current, ...documents]
	let failure: 'before' | 'after' | number | undefined
	let grants: unknown = [{ filter: 'true', permissions: ['read'] }]
	let beforeWrite: (() => void) | undefined
	const fetch = vi.fn(
		async (query: string, params: Record<string, unknown>): Promise<unknown> =>
			(await evaluate(parse(query), { dataset, params })).get(),
	)
	const mutate = vi.fn(
		(options: {
			body: {
				mutations: {
					patch: { id: string; ifRevisionID: string; unset: string[] }
				}[]
			}
		}) => {
			beforeWrite?.()
			if (typeof failure === 'number')
				throw Object.assign(new Error('rejected'), { statusCode: failure })
			if (failure === 'before') throw new Error('lost request')
			const patch = options.body.mutations[0]!.patch
			if (patch.ifRevisionID !== current._rev)
				throw Object.assign(new Error('stale'), { statusCode: 409 })
			for (const selector of patch.unset) {
				const key = JSON.parse(
					selector.slice('folders[_key=='.length, -1),
				) as string
				current.folders = current.folders.filter((item) => item._key !== key)
			}
			current._rev = 'r2'
			if (failure === 'after') throw new Error('lost response')
			return Promise.resolve({
				transactionId: 'tx1',
				results: [{ id: current._id, operation: 'update' }],
			})
		},
	)
	const request = vi.fn((options: { url: string }): Promise<unknown> =>
		options.url.endsWith('/acl')
			? Promise.resolve(grants)
			: mutate(options as unknown as Parameters<typeof mutate>[0]),
	)
	const source = {
		fetch,
		request,
		config: () => ({ projectId: 'project1', dataset: 'test' }),
	}
	const service = createFolderSynchronizer(routes, {
		withConfig: () => source,
	} as unknown as PagesClient)
	return {
		current,
		dataset,
		fetch,
		mutate,
		request,
		service,
		fail(value: typeof failure) {
			failure = value
		},
		grants(value: unknown) {
			grants = value
		},
		beforeWrite(value: () => void) {
			beforeWrite = value
		},
	}
}

describe('empty-only folder removal', () => {
	it('unsets only the saved folder key with a revision guard and never changes content', async () => {
		const doc = page('published', '/elsewhere')
		const io = transport([doc])
		expect(io.request).not.toHaveBeenCalled()
		expect(await io.service.remove('/empty')).toEqual({
			status: 'synced',
			count: 1,
		})
		expect(io.mutate).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({
				maxRetries: 0,
				body: {
					mutations: [
						{
							patch: {
								id: 'sanityKit.folders',
								ifRevisionID: 'r1',
								unset: ['folders[_key=="original"]'],
							},
						},
					],
				},
			}),
		)
		expect(io.current.folders).toEqual([{ _key: 'other', pathname: '/other' }])
		expect(io.current.custom).toBe('keep')
		expect(io.dataset[1]).toEqual(doc)
	})
	it.each(['page', 'drafts.page', 'versions.release1.page'])(
		'blocks an exact index or descendant in version %s',
		async (id) => {
			for (const path of ['/empty', '/empty/deep/page']) {
				const io = transport([page(id, path)])
				expect(await io.service.remove('/empty')).toEqual({
					status: 'blocked',
					reason: 'folder-not-empty',
				})
				expect(io.mutate).not.toHaveBeenCalled()
			}
		},
	)
	it('blocks saved subfolders even when they contain no pages', async () => {
		const io = transport()
		io.current.folders.push({ _key: 'child', pathname: '/empty/child' })
		expect(await io.service.remove('/empty')).toEqual({
			status: 'blocked',
			reason: 'folder-not-empty',
		})
		expect(io.mutate).not.toHaveBeenCalled()
	})
	it('does not mistake a sibling with a similar prefix for a descendant', async () => {
		const io = transport([page('page', '/emptyish/page')])
		expect(await io.service.remove('/empty')).toEqual({
			status: 'synced',
			count: 1,
		})
	})
	it.each(['/', '/missing', '/empty/'])(
		'does not remove an implicit, missing, or invalid folder %s',
		async (path) => {
			const io = transport()
			expect(await io.service.remove(path)).toMatchObject({ status: 'blocked' })
			expect(io.mutate).not.toHaveBeenCalled()
		},
	)
	it('requires fresh complete access even when the visible folder appears empty', async () => {
		const io = transport()
		io.grants([])
		expect(await io.service.remove('/empty')).toMatchObject({
			status: 'blocked',
			reason: 'unknown-read-access',
		})
		expect(io.fetch).not.toHaveBeenCalled()
		expect(io.mutate).not.toHaveBeenCalled()
		io.grants([{ filter: 'true', permissions: ['read'] }])
		io.dataset.push(page('drafts.new', '/empty/new'))
		expect(await io.service.remove('/empty')).toEqual({
			status: 'blocked',
			reason: 'folder-not-empty',
		})
		expect(io.mutate).not.toHaveBeenCalled()
	})
	it('fails closed for malformed inventory and connection failures', async () => {
		const io = transport([page('page', '/empty//child')])
		expect(await io.service.remove('/empty')).toEqual({
			status: 'blocked',
			reason: 'invalid-inventory',
		})
		io.fetch.mockRejectedValueOnce(new Error('offline'))
		expect(await io.service.remove('/empty')).toEqual({
			status: 'blocked',
			reason: 'request-failed',
		})
		expect(io.mutate).not.toHaveBeenCalled()
	})
	it('does not overwrite a concurrent registry change', async () => {
		const io = transport()
		io.beforeWrite(() => {
			io.current._rev = 'changed'
			io.current.folders.push({ _key: 'child', pathname: '/empty/child' })
		})
		expect(await io.service.remove('/empty')).toEqual({
			status: 'blocked',
			reason: 'conflict',
		})
		expect(io.current.folders).toContainEqual(folder)
		expect(io.mutate).toHaveBeenCalledOnce()
	})
	it('reports denied mutation permission without retrying', async () => {
		const io = transport()
		io.fail(403)
		expect(await io.service.remove('/empty')).toEqual({
			status: 'blocked',
			reason: 'permission-denied',
		})
		expect(io.mutate).toHaveBeenCalledOnce()
	})
	it('reconciles a lost acknowledgment without repeating the removal', async () => {
		const io = transport()
		io.fail('after')
		expect(await io.service.remove('/empty')).toEqual({
			status: 'blocked',
			reason: 'outcome-unknown',
		})
		io.fail(undefined)
		expect(await io.service.remove('/empty')).toEqual({
			status: 'synced',
			count: 1,
		})
		expect(io.mutate).toHaveBeenCalledOnce()
	})
	it('blocks removal, creation and automatic sync while an uncertain removal is still present', async () => {
		const io = transport()
		io.fail('before')
		await io.service.remove('/empty')
		io.fail(undefined)
		for (const result of [
			await io.service.remove('/empty'),
			await io.service.create('/new'),
			await io.service.synchronize(),
		])
			expect(result).toEqual({ status: 'blocked', reason: 'outcome-unknown' })
		expect(io.mutate).toHaveBeenCalledOnce()
	})
	it.each(['same-path-new-key', 'same-key-new-path'])(
		'never removes a replacement while reconciling %s',
		async (variant) => {
			const io = transport()
			io.fail('after')
			await io.service.remove('/empty')
			io.fail(undefined)
			io.current.folders.push(
				variant === 'same-path-new-key'
					? { _key: 'replacement', pathname: '/empty' }
					: { _key: 'original', pathname: '/moved' },
			)
			expect(await io.service.remove('/empty')).toEqual({
				status: 'blocked',
				reason: 'outcome-unknown',
			})
			expect(await io.service.synchronize()).toEqual({
				status: 'blocked',
				reason: 'outcome-unknown',
			})
			expect(io.mutate).toHaveBeenCalledOnce()
		},
	)
})
