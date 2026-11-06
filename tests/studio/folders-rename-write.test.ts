import { createClient, type ClientConfig } from '@sanity/client'
import { describe, expect, it, vi } from 'vitest'
import {
	createFolderRenameController,
	type FolderRenameClient,
	type FolderRenameMutation,
	type FolderRenameAuthorization,
} from '../../src/studio/folders/rename-write.js'
import type { FolderRenameRecoveryStorage } from '../../src/studio/folders/rename-pending.js'

const routes = {
	pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
}
const choice = { pathname: '/about', newName: 'company', createRedirects: true }
let sequence = 0
function storage(): FolderRenameRecoveryStorage & {
	values: Map<string, string>
} {
	const values = new Map<string, string>()
	return {
		values,
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => {
			values.set(key, value)
		},
		removeItem: (key) => {
			values.delete(key)
		},
	}
}
const page = (id: string, path: string) => ({
	_id: id,
	_type: 'page',
	_rev: `rev-${id}`,
	value: path,
})
const initial = () => ({
	registry: {
		_id: 'sanityKit.folders',
		_type: 'sanityKitFolderRegistry',
		_rev: 'folders-rev',
		schemaVersion: 1,
		folders: [
			{ _key: 'about', pathname: '/about', extra: 'retain' },
			{ _key: 'empty', pathname: '/about/empty' },
		],
		extra: { keep: true },
	},
	documents: [
		page('about', '/about'),
		page('team', '/about/team'),
		page('drafts.team', '/about/team'),
		page('drafts.new', '/about/new'),
		page('other', '/other'),
	],
})
const alias = () => ({
	_id: 'alias',
	_type: 'sanityKitRedirect',
	_rev: 'alias-rev',
	source: '/old-team',
	destination: '/about/team',
	status: 302,
	enabled: true,
	origin: 'manual',
})
function transport() {
	const data = initial()
	const redirects: Record<string, unknown>[] = [alias()]
	const receipts = new Map<string, Record<string, unknown>>()
	const saved = storage()
	const dataset = `rename${++sequence}`
	const fetch = vi.fn((query: string): Promise<unknown> =>
		Promise.resolve(
			query.includes('"registry"')
				? structuredClone(data)
				: structuredClone(redirects),
		),
	)
	const getDocument = vi.fn((id: string): Promise<unknown> =>
		Promise.resolve(receipts.get(id)),
	)
	const sent: FolderRenameMutation[][] = []
	const request = vi.fn(
		(
			options: Parameters<
				ReturnType<FolderRenameClient['withConfig']>['request']
			>[0],
		): Promise<unknown> => {
			if (options.url.includes('/data/doc/'))
				return getDocument(options.url.split('/').at(-1)!).then((document) => ({
					documents: document ? [document] : [],
				}))
			if (!options.body)
				return Promise.resolve([{ filter: 'true', permissions: ['read'] }])
			const values = options.body.mutations
			sent.push(structuredClone(values) as FolderRenameMutation[])
			for (const mutation of values)
				if (
					'create' in mutation &&
					mutation.create._type === 'sanityKitFolderRename'
				)
					receipts.set(mutation.create._id as string, { ...mutation.create })
			return Promise.resolve({
				transactionId: options.body.transactionId,
				results: values.map((mutation) =>
					'patch' in mutation
						? { id: mutation.patch.id, operation: 'update' }
						: { id: mutation.create._id, operation: 'create' },
				),
			})
		},
	)
	const client: FolderRenameClient = {
		withConfig: () => ({
			fetch,
			getDocument,
			request,
			config: () => ({ projectId: 'test1234', dataset }),
		}),
	}
	const authorize = vi.fn((): Promise<FolderRenameAuthorization> =>
		Promise.resolve({ ok: true }),
	)
	const options = { routes, authorize, recoveryStorage: saved }
	const controller = createFolderRenameController(options, client)
	return {
		data,
		redirects,
		receipts,
		saved,
		fetch,
		getDocument,
		request,
		client,
		authorize,
		options,
		controller,
		sent,
	}
}
async function ready(io: ReturnType<typeof transport>, override = {}) {
	const result = await io.controller.review({ ...choice, ...override })
	if (result.status !== 'ready')
		throw new Error(`Expected ready: ${JSON.stringify(result)}`)
	return result.review
}
const dispatch = (
	options: Parameters<
		ReturnType<FolderRenameClient['withConfig']>['request']
	>[0],
) => options.method === 'POST'

describe('private reviewed folder rename writer', () => {
	it('reviews without writes and atomically sends only guarded URL fields, folder paths, redirects and receipt', async () => {
		const io = transport()
		const before = structuredClone(io.data)
		const review = await ready(io)
		expect(io.request.mock.calls.some(([options]) => dispatch(options))).toBe(
			false,
		)
		expect(Object.isFrozen(review.plan.pageChanges[0])).toBe(true)
		const result = await io.controller.apply(review, { isCurrent: () => true })
		expect(result).toEqual({
			status: 'renamed',
			operationId: review.operationId,
		})
		expect(io.authorize).toHaveBeenCalledTimes(2)
		expect(io.sent).toHaveLength(1)
		const values = io.sent[0]!
		expect(values[0]).toEqual({
			patch: {
				id: 'sanityKit.folders',
				ifRevisionID: 'folders-rev',
				set: {
					'folders[_key=="about"].pathname': '/company',
					'folders[_key=="empty"].pathname': '/company/empty',
				},
			},
		})
		expect(values).toContainEqual({
			patch: {
				id: 'team',
				ifRevisionID: 'rev-team',
				set: { 'pathname.current': '/company/team' },
			},
		})
		expect(values).toContainEqual({
			patch: {
				id: 'drafts.team',
				ifRevisionID: 'rev-drafts.team',
				set: { 'pathname.current': '/company/team' },
			},
		})
		expect(values).toContainEqual({
			patch: {
				id: 'drafts.new',
				ifRevisionID: 'rev-drafts.new',
				set: { 'pathname.current': '/company/new' },
			},
		})
		expect(values).toContainEqual({
			patch: {
				id: 'alias',
				ifRevisionID: 'alias-rev',
				set: { destination: '/company/team' },
			},
		})
		const creates = values.flatMap((item) =>
			'create' in item ? [item.create] : [],
		)
		expect(
			creates.filter((item) => item._type === 'sanityKitRedirect'),
		).toHaveLength(2)
		expect(
			creates
				.filter((item) => item._type === 'sanityKitRedirect')
				.map((item) => item.source),
		).toEqual(['/about', '/about/team'])
		expect(creates.at(-1)).toMatchObject({
			_id: `sanityKit.folderRename.${review.operationId}`,
			_type: 'sanityKitFolderRename',
		})
		expect(JSON.stringify(values)).not.toContain('createOrReplace')
		expect(io.data).toEqual(before)
		expect(io.saved.values.size).toBe(0)
	})
	it('allows redirect opt-out while updating existing aliases and authorizing all concrete targets', async () => {
		const io = transport()
		const review = await ready(io, { createRedirects: false })
		await io.controller.apply(review, { isCurrent: () => true })
		expect(io.sent[0]?.filter((row) => 'create' in row)).toHaveLength(1)
		expect(io.sent[0]).toContainEqual({
			patch: {
				id: 'alias',
				ifRevisionID: 'alias-rev',
				set: { destination: '/company/team' },
			},
		})
		const calls = io.authorize.mock.calls as unknown as [
			{
				targets: readonly {
					id: string
					operation: string
					fields: readonly string[]
				}[]
			},
		][]
		expect(calls[0]?.[0].targets).toContainEqual(
			expect.objectContaining({
				id: 'drafts.team',
				operation: 'update',
				fields: ['pathname.current'],
			}),
		)
		expect(calls[0]?.[0].targets).toContainEqual(
			expect.objectContaining({
				id: `sanityKit.folderRename.${review.operationId}`,
				operation: 'create',
			}),
		)
	})
	it.each(['missing', 'unverified', 'protected'] as const)(
		'refuses %s write/readOnly eligibility without dispatch',
		async (reason) => {
			const io = transport()
			io.authorize.mockResolvedValue({ ok: false, reason, documentId: 'team' })
			expect(await io.controller.review(choice)).toMatchObject({
				status: 'blocked',
				reason: `write-access-${reason}`,
				documentId: 'team',
			})
			expect(io.sent).toHaveLength(0)
		},
	)
	it('requires complete read permissions before inventory queries', async () => {
		const io = transport()
		io.request.mockResolvedValue([
			{ filter: '_type == "page"', permissions: ['read'] },
		])
		expect(await io.controller.review(choice)).toMatchObject({
			status: 'blocked',
			reason: 'unknown-read-access',
		})
		expect(io.fetch).not.toHaveBeenCalled()
		expect(io.sent).toHaveLength(0)
	})
	it('checks write permissions again after review', async () => {
		const io = transport()
		const review = await ready(io)
		io.authorize.mockResolvedValue({
			ok: false,
			reason: 'missing',
			documentId: 'team',
		})
		expect(
			await io.controller.apply(review, { isCurrent: () => true }),
		).toMatchObject({ status: 'blocked', reason: 'write-access-missing' })
		expect(io.sent).toHaveLength(0)
	})
	it.each(['revision', 'new-page', 'new-release', 'redirect'] as const)(
		'refuses fresh %s changes after review',
		async (change) => {
			const io = transport()
			const review = await ready(io)
			if (change === 'revision') io.data.documents[1]!._rev = 'changed'
			if (change === 'new-page')
				io.data.documents.push(page('collision', '/company/team'))
			if (change === 'new-release')
				io.data.documents.push(page('versions.release.team', '/future/team'))
			if (change === 'redirect') io.redirects[0]!._rev = 'changed'
			expect(
				await io.controller.apply(review, { isCurrent: () => true }),
			).toMatchObject({ status: 'blocked' })
			expect(io.sent).toHaveLength(0)
		},
	)
	it('refuses cloned reviews and stale editor state', async () => {
		const io = transport()
		const review = await ready(io)
		expect(
			await io.controller.apply(structuredClone(review), {
				isCurrent: () => true,
			}),
		).toEqual({ status: 'blocked', reason: 'invalid-review' })
		expect(
			await io.controller.apply(review, { isCurrent: () => false }),
		).toEqual({ status: 'blocked', reason: 'review-stale' })
		expect(io.sent).toHaveLength(0)
	})
	it.each(['quota', 'readback'] as const)(
		'blocks before dispatch when recovery persistence fails: %s',
		async (mode) => {
			const io = transport()
			const review = await ready(io)
			io.saved.setItem =
				mode === 'quota'
					? () => {
							throw new Error('quota')
						}
					: () => {}
			expect(
				await io.controller.apply(review, { isCurrent: () => true }),
			).toEqual({ status: 'blocked', reason: 'recovery-unavailable' })
			expect(io.sent).toHaveLength(0)
		},
	)
	it('blocks corrupt recovery state rather than letting another operation start', async () => {
		const io = transport()
		io.saved.values.set(
			'sanity-kit.folder-rename:' +
				JSON.stringify([
					'test1234',
					io.client
						.withConfig({
							apiVersion: 'x',
							perspective: 'raw',
							useCdn: false,
							stega: false,
						})
						.config().dataset,
				]),
			'{broken',
		)
		expect(await io.controller.review(choice)).toEqual({
			status: 'blocked',
			reason: 'recovery-invalid',
		})
	})
	it('confirms a lost response only through the exact durable receipt', async () => {
		const io = transport()
		const review = await ready(io)
		const request = io.request.getMockImplementation()!
		io.request.mockImplementation(async (options) => {
			const result = await request(options)
			if (dispatch(options)) throw new Error('lost response')
			return result
		})
		expect(
			await io.controller.apply(review, { isCurrent: () => true }),
		).toEqual({ status: 'renamed', operationId: review.operationId })
		expect(io.getDocument).toHaveBeenCalledWith(
			`sanityKit.folderRename.${review.operationId}`,
		)
		expect(io.sent).toHaveLength(1)
	})
	it('retains unknown state and stable IDs across controllers without resending', async () => {
		const io = transport()
		const review = await ready(io)
		const request = io.request.getMockImplementation()!
		io.request.mockImplementation(async (options) => {
			if (dispatch(options)) throw new Error('timeout')
			return request(options)
		})
		expect(
			await io.controller.apply(review, { isCurrent: () => true }),
		).toEqual({ status: 'unknown', operationId: review.operationId })
		const pending = io.controller.getPending()!
		const restored = createFolderRenameController(io.options, io.client)
		expect(restored.getPending()).toEqual(pending)
		expect(await restored.review(choice)).toEqual({
			status: 'blocked',
			reason: 'outcome-unknown',
		})
		expect(await restored.reconcile()).toEqual({
			status: 'unknown',
			operationId: review.operationId,
		})
		io.receipts.set(pending._id, { ...pending, evidence: 'wrong' })
		expect(await restored.reconcile()).toMatchObject({ status: 'unknown' })
		io.receipts.set(pending._id, { ...pending })
		expect(await restored.reconcile()).toEqual({
			status: 'renamed',
			operationId: review.operationId,
		})
		expect(
			io.request.mock.calls.filter(([options]) => dispatch(options)),
		).toHaveLength(1)
	})
	it('restores the saved receipt after a module reload without resending the write', async () => {
		const io = transport()
		const review = await ready(io)
		const request = io.request.getMockImplementation()!
		io.request.mockImplementation(async (options) => {
			if (dispatch(options)) throw new Error('timeout')
			return request(options)
		})
		await io.controller.apply(review, { isCurrent: () => true })
		const receipt = io.controller.getPending()!
		vi.resetModules()
		const reloaded = await import('../../src/studio/folders/rename-write.js')
		const controller = reloaded.createFolderRenameController(
			io.options,
			io.client,
		)
		expect(controller.getPending()).toEqual(receipt)
		expect(await controller.review(choice)).toMatchObject({
			reason: 'outcome-unknown',
		})
		io.receipts.set(receipt._id, { ...receipt })
		expect(await controller.reconcile()).toEqual({
			status: 'renamed',
			operationId: review.operationId,
		})
		expect(io.saved.values.size).toBe(0)
		expect(
			io.request.mock.calls.filter(([options]) => dispatch(options)),
		).toHaveLength(1)
	})
	it('dispatches only one operation when two mounted controllers apply concurrently', async () => {
		const io = transport()
		const first = await ready(io)
		const other = createFolderRenameController(io.options, io.client)
		const second = await other.review(choice)
		if (second.status !== 'ready') throw new Error('Expected second review')
		const request = io.request.getMockImplementation()!
		let release!: () => void
		const waiting = new Promise<void>((resolve) => {
			release = resolve
		})
		io.request.mockImplementation(async (options) => {
			if (dispatch(options)) await waiting
			return request(options)
		})
		const results = [
			io.controller.apply(first, { isCurrent: () => true }),
			other.apply(second.review, { isCurrent: () => true }),
		]
		await vi.waitFor(() =>
			expect(
				io.request.mock.calls.filter(([options]) => dispatch(options)),
			).toHaveLength(1),
		)
		release()
		expect(await Promise.all(results)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ status: 'renamed' }),
				{ status: 'blocked', reason: 'outcome-unknown' },
			]),
		)
		expect(io.sent).toHaveLength(1)
	})
	it.each([400, 403, 409, 413, 429])(
		'settles definitive server rejection %s without receipt guessing',
		async (statusCode) => {
			const io = transport()
			const review = await ready(io)
			const request = io.request.getMockImplementation()!
			io.request.mockImplementation(async (options) => {
				if (dispatch(options))
					throw Object.assign(new Error('Rejected'), { statusCode })
				return request(options)
			})
			expect(
				await io.controller.apply(review, { isCurrent: () => true }),
			).toMatchObject({ status: 'rejected', operationId: review.operationId })
			expect(io.getDocument).not.toHaveBeenCalled()
			expect(io.controller.getPending()).toBeNull()
		},
	)
	it('does not report success from malformed acknowledgment alone', async () => {
		const io = transport()
		const review = await ready(io)
		const request = io.request.getMockImplementation()!
		io.request.mockImplementation(async (options) =>
			dispatch(options)
				? { transactionId: review.operationId, results: [] }
				: request(options),
		)
		expect(
			await io.controller.apply(review, { isCurrent: () => true }),
		).toMatchObject({ status: 'unknown' })
	})
	it('does not dispatch after cancellation, but preserves confirmed success after late cancellation', async () => {
		const io = transport()
		const review = await ready(io)
		const abort = new AbortController()
		abort.abort()
		expect(
			await io.controller.apply(review, {
				isCurrent: () => true,
				signal: abort.signal,
			}),
		).toEqual({ status: 'blocked', reason: 'aborted' })
		expect(io.sent).toHaveLength(0)
		const late = new AbortController()
		const request = io.request.getMockImplementation()!
		io.request.mockImplementation(async (options) => {
			const result = await request(options)
			if (dispatch(options)) late.abort()
			return result
		})
		expect(
			await io.controller.apply(review, {
				isCurrent: () => true,
				signal: late.signal,
			}),
		).toMatchObject({ status: 'renamed' })
	})
	it.each([false, true])(
		'passes raw patches and retry/cache controls through the actual Sanity SDK transport (failure=%s)',
		async (failure) => {
			const data = initial()
			const seen: { url: string; init: RequestInit }[] = []
			const fetch = vi.fn((input: unknown, init: unknown) => {
				const url = String(input)
				const options = init as RequestInit
				seen.push({ url, init: options })
				let body: unknown
				if (url.includes('/acl'))
					body = [{ filter: 'true', permissions: ['read'] }]
				else if (url.includes('/data/query/')) {
					const query = decodeURIComponent(url)
					body = { result: query.includes('"registry"') ? data : [alias()] }
				} else if (url.includes('/data/mutate/')) {
					if (typeof options.body !== 'string')
						throw new Error('Expected JSON body')
					const request = JSON.parse(options.body) as {
						mutations: FolderRenameMutation[]
						transactionId: string
					}
					if (failure)
						return Promise.resolve(
							new Response(
								JSON.stringify({ error: { description: 'Unavailable' } }),
								{
									status: 503,
									headers: { 'content-type': 'application/json' },
								},
							),
						)
					body = {
						transactionId: request.transactionId,
						results: request.mutations.map((mutation) =>
							'patch' in mutation
								? { id: mutation.patch.id, operation: 'update' }
								: { id: mutation.create._id, operation: 'create' },
						),
					}
				} else if (url.includes('/data/doc/')) body = { documents: [] }
				else throw new Error(`Unexpected request: ${url}`)
				return Promise.resolve(
					new Response(JSON.stringify(body), {
						status: 200,
						headers: { 'content-type': 'application/json' },
					}),
				)
			})
			const native = createClient({
				projectId: 'test1234',
				dataset: `sdk${++sequence}`,
				apiVersion: '2026-10-01',
				useCdn: true,
				perspective: 'drafts',
				maxRetries: 5,
				fetch: {
					cache: 'force-cache',
					next: { revalidate: 3600 },
				} as unknown as NonNullable<ClientConfig['fetch']>,
				resolveFetch: () => fetch,
			})
			const controller = createFolderRenameController(
				{
					routes,
					authorize: () => Promise.resolve({ ok: true }),
					recoveryStorage: storage(),
				},
				native,
			)
			const reviewed = await controller.review(choice)
			expect(reviewed.status).toBe('ready')
			if (reviewed.status !== 'ready') throw new Error(JSON.stringify(reviewed))
			expect(
				await controller.apply(reviewed.review, { isCurrent: () => true }),
			).toMatchObject({ status: failure ? 'unknown' : 'renamed' })
			expect(
				seen.filter((call) => call.url.includes('/data/mutate/')),
			).toHaveLength(1)
			if (failure) {
				const recovery = seen.find((call) => call.url.includes('/data/doc/'))!
				expect(recovery.init.cache).toBe('no-store')
				expect(recovery.init).not.toMatchObject({ next: { revalidate: 3600 } })
			}
			const write = seen.find((call) => call.url.includes('/data/mutate/'))!
			expect(write.init.cache).toBe('no-store')
			expect(write.init).not.toMatchObject({ next: { revalidate: 3600 } })
			expect(new URL(write.url).searchParams.get('visibility')).toBe('sync')
			expect(JSON.parse(write.init.body as string) as unknown).toMatchObject({
				transactionId: reviewed.review.operationId,
			})
			expect(JSON.parse(write.init.body as string) as unknown).toMatchObject({
				mutations: expect.arrayContaining([
					{
						patch: {
							id: 'drafts.team',
							ifRevisionID: 'rev-drafts.team',
							set: { 'pathname.current': '/company/team' },
						},
					},
				]) as unknown,
			})
			expect(native.config().perspective).toBe('drafts')
		},
	)
})
