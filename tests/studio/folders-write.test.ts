import { createClient, type ClientConfig } from '@sanity/client'
import { describe, expect, it, vi } from 'vitest'
import { FOLDER_LIMITS } from '../../src/studio/folders/planner.js'
import { createFolderWriter } from '../../src/studio/folders/write.js'

const options = {
	routes: {
		pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
	},
}
const access = { readAccess: 'all-registered-versions' } as const
const registry = () => ({
	_id: 'sanityKit.folders',
	_type: 'sanityKitFolderRegistry',
	_rev: 'registry-rev',
	schemaVersion: 1,
	folders: [{ _key: 'about', pathname: '/about', custom: 'retain me' }],
	custom: { detail: 'retain this too' },
})
const acknowledgment = (operation = 'create') => ({
	transactionId: 'tx-1',
	results: [{ id: 'sanityKit.folders', operation }],
})

function transport(current: unknown = null, documents: unknown[] = []) {
	const fetch = vi.fn((): Promise<unknown> =>
		Promise.resolve({
			registry: current,
			documents,
		}),
	)
	const request = vi.fn((_options: unknown): Promise<unknown> => {
		void _options
		return Promise.resolve(
			acknowledgment(current === null ? 'create' : 'update'),
		)
	})
	const withConfig = vi.fn(() => ({
		fetch,
		request,
		config: () => ({ dataset: 'test' }),
	}))
	const client = { withConfig }
	return {
		fetch,
		request,
		withConfig,
		writer: createFolderWriter(options, client),
	}
}

describe('private additive folder persistence', () => {
	it('does no work until an explicit action, then creates a strict singleton with ancestors', async () => {
		const io = transport()
		expect(io.fetch).not.toHaveBeenCalled()
		expect(io.request).not.toHaveBeenCalled()
		const result = await io.writer.create({
			...access,
			pathname: '/about/team',
		})
		expect(result).toMatchObject({ status: 'written', transactionId: 'tx-1' })
		if (result.status !== 'written') throw new Error('Expected written')
		expect(result.added.map((folder) => folder.pathname)).toEqual([
			'/about',
			'/about/team',
		])
		expect(new Set(result.added.map((folder) => folder._key)).size).toBe(2)
		expect(io.request).toHaveBeenCalledExactlyOnceWith({
			url: '/data/mutate/test',
			method: 'POST',
			query: {
				visibility: 'sync',
				returnDocuments: 'false',
				returnIds: 'true',
				autoGenerateArrayKeys: 'false',
			},
			body: {
				mutations: [
					{
						create: {
							_id: 'sanityKit.folders',
							_type: 'sanityKitFolderRegistry',
							schemaVersion: 1,
							folders: result.added,
						},
					},
				],
			},
			maxRetries: 0,
			fetch: { cache: 'no-store', next: undefined },
			tag: 'sanity-kit.folders-write',
		})
	})

	it('patches by revision and appends only new records instead of replacing metadata', async () => {
		const current = registry()
		const before = structuredClone(current)
		const io = transport(current)
		const result = await io.writer.create({
			...access,
			pathname: '/about/team',
		})
		if (result.status !== 'written') throw new Error('Expected written')
		expect(result.added).toHaveLength(1)
		expect(io.request.mock.calls[0]?.[0]).toMatchObject({
			body: {
				mutations: [
					{
						patch: {
							id: 'sanityKit.folders',
							ifRevisionID: 'registry-rev',
							insert: { after: 'folders[-1]', items: result.added },
						},
					},
				],
			},
		})
		expect(current).toEqual(before)
	})

	it('does not write an existing folder or create an empty registry during synchronization', async () => {
		const existing = transport(registry())
		expect(
			await existing.writer.create({ ...access, pathname: '/about' }),
		).toEqual({
			status: 'unchanged',
			added: [],
		})
		expect(existing.request).not.toHaveBeenCalled()
		const empty = transport()
		expect(await empty.writer.synchronize(access)).toEqual({
			status: 'unchanged',
			added: [],
		})
		expect(empty.request).not.toHaveBeenCalled()
	})

	it('refuses malformed URL evidence during synchronization instead of pruning or guessing', async () => {
		const io = transport(registry(), [
			{ _id: 'a', _type: 'page', _rev: 'r', value: '/about//team' },
		])
		expect(await io.writer.synchronize(access)).toEqual({
			status: 'invalid',
			reason: 'invalid-inventory',
		})
		expect(io.request).not.toHaveBeenCalled()
	})

	it.each([undefined, '', '/', '/about/'])(
		'refuses invalid creation %s rather than running synchronization',
		async (pathname) => {
			const io = transport(null, [
				{ _id: 'a', _type: 'page', _rev: 'r', value: '/inferred/page' },
			])
			expect(
				await io.writer.create({ ...access, pathname: pathname as string }),
			).toEqual({ status: 'invalid', reason: 'invalid-folder' })
			expect(io.request).not.toHaveBeenCalled()
		},
	)

	it('refuses unknown read access, read failures, and invalid registries before mutation', async () => {
		const io = transport()
		expect(
			await io.writer.create({ readAccess: 'unknown', pathname: '/a' }),
		).toEqual({
			status: 'unavailable',
			reason: 'unknown-read-access',
		})
		expect(io.fetch).not.toHaveBeenCalled()
		io.fetch.mockRejectedValueOnce(new Error('offline'))
		expect(await io.writer.create({ ...access, pathname: '/a' })).toEqual({
			status: 'unavailable',
			reason: 'request-failed',
		})
		io.fetch.mockResolvedValueOnce({ registry: {}, documents: [] })
		expect(await io.writer.create({ ...access, pathname: '/a' })).toEqual({
			status: 'unavailable',
			reason: 'invalid-registry',
		})
		expect(io.request).not.toHaveBeenCalled()
	})

	it('bounds the actual patch payload, including an oversized revision', async () => {
		const current = registry()
		current._rev = 'r'.repeat(FOLDER_LIMITS.registryBytes)
		const io = transport(current)
		expect(
			await io.writer.create({ ...access, pathname: '/about/team' }),
		).toEqual({
			status: 'invalid',
			reason: 'limit-exceeded',
		})
		expect(io.request).not.toHaveBeenCalled()
	})

	it('reads again on every action and does not reuse earlier registry evidence', async () => {
		const io = transport()
		await io.writer.create({ ...access, pathname: '/about' })
		io.fetch.mockResolvedValueOnce({ registry: registry(), documents: [] })
		expect(await io.writer.create({ ...access, pathname: '/about' })).toEqual({
			status: 'unchanged',
			added: [],
		})
		expect(io.fetch).toHaveBeenCalledTimes(2)
		expect(io.request).toHaveBeenCalledTimes(1)
	})

	it('stops cancelled reads before dispatching a write', async () => {
		const controller = new AbortController()
		const io = transport()
		controller.abort()
		expect(
			await io.writer.create({
				...access,
				pathname: '/a',
				signal: controller.signal,
			}),
		).toEqual({
			status: 'unavailable',
			reason: 'aborted',
		})
		expect(io.fetch).not.toHaveBeenCalled()
		expect(io.request).not.toHaveBeenCalled()
		const pending = new AbortController()
		io.fetch.mockImplementationOnce(() => {
			pending.abort()
			return Promise.resolve({ registry: null, documents: [] })
		})
		expect(
			await io.writer.create({
				...access,
				pathname: '/a',
				signal: pending.signal,
			}),
		).toEqual({
			status: 'unavailable',
			reason: 'aborted',
		})
		expect(io.request).not.toHaveBeenCalled()
	})

	it.each([
		[409, 'conflict'],
		[401, 'permission-denied'],
		[403, 'permission-denied'],
		[400, 'request-rejected'],
		[429, 'request-rejected'],
	])(
		'reports HTTP %s as rejected without retry',
		async (statusCode, reason) => {
			const io = transport()
			io.request.mockRejectedValueOnce(
				Object.assign(new Error('rejected'), { statusCode }),
			)
			expect(await io.writer.create({ ...access, pathname: '/a' })).toEqual({
				status: 'rejected',
				reason,
			})
			expect(io.request).toHaveBeenCalledTimes(1)
		},
	)

	it.each([
		new Error('network'),
		Object.assign(new Error('server'), { statusCode: 503 }),
		Object.assign(new Error('timeout'), { statusCode: 408 }),
		Object.assign(new Error('client closed'), { statusCode: 499 }),
		new DOMException('cancelled', 'AbortError'),
	])('keeps ambiguous failure uncertain: %s', async (error) => {
		const io = transport()
		io.request.mockRejectedValueOnce(error)
		expect(await io.writer.create({ ...access, pathname: '/a' })).toMatchObject(
			{
				status: 'outcome-unknown',
				reason: 'request-failed',
				added: [{ pathname: '/a' }],
			},
		)
		expect(io.request).toHaveBeenCalledTimes(1)
	})

	it.each([
		null,
		{},
		{ ...acknowledgment(), transactionId: '' },
		{ ...acknowledgment(), results: [] },
		{ ...acknowledgment(), results: [{ id: 'other', operation: 'create' }] },
		acknowledgment('update'),
	])(
		'does not claim success for malformed acknowledgment %j',
		async (response) => {
			const io = transport()
			io.request.mockResolvedValueOnce(response)
			expect(
				await io.writer.create({ ...access, pathname: '/a' }),
			).toMatchObject({
				status: 'outcome-unknown',
				reason: 'invalid-response',
			})
		},
	)

	it('retains a confirmed result when cancellation arrives after the server applied it', async () => {
		const io = transport()
		const controller = new AbortController()
		io.request.mockImplementationOnce(() => {
			controller.abort()
			return Promise.resolve(acknowledgment())
		})
		expect(
			await io.writer.create({
				...access,
				pathname: '/a',
				signal: controller.signal,
			}),
		).toMatchObject({
			status: 'written',
			transactionId: 'tx-1',
		})
	})

	it.each(['429', '503', 'network'] as const)(
		'disables installed SDK retry behavior for %s mutation failures',
		async (failure) => {
			const fetch = vi.fn((url: unknown, _init?: RequestInit) => {
				void _init
				if (String(url).includes('/data/query/'))
					return Promise.resolve(
						new Response(
							JSON.stringify({ result: { registry: null, documents: [] } }),
							{
								status: 200,
								headers: { 'content-type': 'application/json' },
							},
						),
					)
				if (failure === 'network')
					return Promise.reject(new TypeError('Failed to fetch'))
				return Promise.resolve(
					new Response(
						JSON.stringify({
							error: { type: 'mutationError', description: 'rejected' },
						}),
						{
							status: Number(failure),
							headers: { 'content-type': 'application/json' },
						},
					),
				)
			})
			const client = createClient({
				projectId: 'test1234',
				dataset: 'test',
				apiVersion: '2025-02-19',
				useCdn: true,
				perspective: 'drafts',
				maxRetries: 3,
				retryDelay: () => 0,
				fetch: {
					cache: 'force-cache',
					next: { revalidate: 3600 },
				} as unknown as NonNullable<ClientConfig['fetch']>,
				resolveFetch: () => fetch,
			})
			const before = client.config()
			const result = await createFolderWriter(options, client).create({
				...access,
				pathname: '/a',
			})
			expect(result.status).toBe(
				failure === '429' ? 'rejected' : 'outcome-unknown',
			)
			expect(fetch).toHaveBeenCalledTimes(2)
			const [url, init] = fetch.mock.calls[1]!
			expect(String(url)).toContain(
				'test1234.api.sanity.io/v2026-10-01/data/mutate/test',
			)
			expect(String(url)).toContain('returnIds=true')
			expect(init?.method).toBe('POST')
			expect(init).toMatchObject({ cache: 'no-store' })
			expect(init).not.toHaveProperty('next.revalidate')
			expect(client.config()).toEqual(before)
		},
	)
})
