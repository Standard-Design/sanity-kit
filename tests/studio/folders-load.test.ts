import { createClient, type ClientConfig } from '@sanity/client'
import { evaluate, parse } from 'groq-js'
import { describe, expect, it, vi } from 'vitest'
import { createFolderLoader } from '../../src/studio/folders/load.js'
import {
	createFolderPlanner,
	FOLDER_LIMITS,
} from '../../src/studio/folders/planner.js'
import type { PagesClient } from '../../src/studio/pages/data-source.js'
import type { PagesRouteConfig } from '../../src/url/registry.js'

const routes = {
	pages: [
		{ schemaType: 'page', pathnameField: 'pathname.current' },
		{ schemaType: 'landing', pathnameField: 'seo.url.current' },
	],
	collections: [
		{
			name: 'journal',
			title: 'Journal',
			routePrefix: '/posts',
			overview: { schemaType: 'page', pathname: '/journal' },
			items: [{ schemaType: 'post', slugField: 'slug.current' }],
		},
	],
	excludePaths: ['/reserved'],
} satisfies PagesRouteConfig
const options = { routes }
const access = { readAccess: 'all-registered-versions' } as const
const planner = createFolderPlanner(options)
const registry = () => ({
	_id: planner.id,
	_type: 'sanityKitFolderRegistry',
	_rev: 'r-registry',
	schemaVersion: 1,
	folders: [{ _key: 'about-key', pathname: '/about', custom: 'keep' }],
	custom: { description: 'Do not replace this document with the snapshot' },
})
const page = (_id: string, value: unknown = '/about/team') => ({
	_id,
	_type: 'page',
	_rev: `r-${_id}`,
	pathname: { current: value },
	body: 'Excluded',
})
const row = (_id = 'a') => ({
	_id,
	_type: 'page',
	_rev: 'r',
	_originalId: null,
	value: '/about/team',
})
const envelope = () => ({ registry: null, documents: [] as unknown[] })

/** Run the actual generated query against local fixtures; nothing contacts Sanity. */
function transport(
	dataset: object[] = [],
	config: { routes: PagesRouteConfig } = options,
) {
	const fetch = vi.fn(
		async (
			query: string,
			params: Record<string, unknown>,
			fetchOptions: unknown,
		): Promise<unknown> => {
			void fetchOptions
			return (await evaluate(parse(query), { dataset, params })).get()
		},
	)
	const withConfig = vi.fn(() => ({ fetch }))
	const client = { withConfig } as unknown as Pick<PagesClient, 'withConfig'>
	return { fetch, withConfig, client, load: createFolderLoader(config, client) }
}

describe('private folder evidence loader', () => {
	it('passes no-store to the real SDK transport without changing the supplied client', async () => {
		const fetch = vi.fn((_url: unknown, _init?: RequestInit) => {
			void _url
			void _init
			return Promise.resolve(
				new Response(JSON.stringify({ result: envelope() }), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				}),
			)
		})
		const client = createClient({
			projectId: 'test1234',
			dataset: 'test',
			apiVersion: '2025-02-19',
			useCdn: true,
			perspective: 'drafts',
			maxRetries: 0,
			// SDK supports inherited cache options at runtime; its public types
			// intentionally expose these only when Next augments RequestInit.
			fetch: {
				cache: 'force-cache',
				next: { revalidate: 3600 },
			} as unknown as NonNullable<ClientConfig['fetch']>,
			resolveFetch: () => fetch,
		})
		const before = client.config()
		expect(await createFolderLoader(options, client)(access)).toMatchObject({
			status: 'loaded',
		})
		expect(fetch).toHaveBeenCalledTimes(1)
		const [url, request] = fetch.mock.calls[0]!
		expect(String(url)).toContain(
			'test1234.api.sanity.io/v2026-10-01/data/query/test',
		)
		expect(String(url)).toContain('perspective=raw')
		expect(request).toMatchObject({ cache: 'no-store' })
		expect(request).not.toHaveProperty('next.revalidate')
		expect(client.config()).toEqual(before)
	})
	it('loads the singleton and all raw versions without collapsing identities', async () => {
		const dataset = [
			registry(),
			page('page'),
			page('drafts.page', '/draft/team'),
			page('versions.launch.page', '/future/team'),
			{
				_id: 'landing',
				_type: 'landing',
				_rev: 'r',
				seo: { url: { current: '/about/landing', title: 'Excluded' } },
			},
			{ _id: 'post', _type: 'post', _rev: 'r', slug: { current: 'story' } },
			{ _id: 'shared', _type: 'shared', _rev: 'r', body: 'Not registered' },
		]
		const { load } = transport(dataset)
		const result = await load(access)
		expect(result.status).toBe('loaded')
		if (result.status !== 'loaded') throw new Error('Expected snapshot')
		const { snapshot } = result
		expect(snapshot.registry).toEqual({
			_id: planner.id,
			_type: 'sanityKitFolderRegistry',
			_rev: 'r-registry',
			schemaVersion: 1,
			folders: [{ _key: 'about-key', pathname: '/about' }],
		})
		expect(snapshot.inventory).toMatchObject({
			perspective: 'raw',
			complete: true,
			readAccess: 'all-registered-versions',
		})
		expect(snapshot.inventory.documents).toHaveLength(5)
		expect(snapshot.inventory.documents).toContainEqual({
			_id: 'landing',
			_type: 'landing',
			_rev: 'r',
			seo: { url: { current: '/about/landing' } },
		})
		expect(snapshot.inventory.documents).toContainEqual({
			_id: 'post',
			_type: 'post',
			_rev: 'r',
			slug: { current: 'story' },
		})
		for (const id of ['page', 'drafts.page', 'versions.launch.page'])
			expect(snapshot.inventory.documents).toContainEqual(
				expect.objectContaining({ _id: id, _rev: `r-${id}` }),
			)
		expect(
			planner.planRemove(snapshot.registry, '/about', snapshot.inventory),
		).toEqual({ ok: false, reason: 'folder-not-empty' })
	})

	it('forces raw, direct API, unencoded filtered results and passes cancellation', async () => {
		const { load, fetch, withConfig } = transport()
		const signal = new AbortController().signal
		await load(access, signal)
		expect(withConfig).toHaveBeenCalledWith({
			apiVersion: '2026-10-01',
			perspective: 'raw',
			useCdn: false,
			stega: false,
		})
		expect(fetch.mock.calls[0]![2]).toEqual({
			perspective: 'raw',
			useCdn: false,
			stega: false,
			filterResponse: true,
			cache: 'no-store',
			tag: 'sanity-kit.folders-load',
			signal,
		})
		expect(fetch.mock.calls[0]![0]).not.toContain('body')
		expect(fetch.mock.calls[0]![1]).toMatchObject({
			registryId: planner.id,
			types: ['page', 'landing', 'post'],
		})
	})

	it('refuses unknown access before querying; an empty visible set cannot prove access', async () => {
		const { load, fetch } = transport()
		expect(await load({ readAccess: 'unknown' })).toEqual({
			status: 'unavailable',
			reason: 'unknown-read-access',
		})
		expect(fetch).not.toHaveBeenCalled()
		expect(await load(access)).toMatchObject({
			status: 'loaded',
			snapshot: { registry: null, inventory: { documents: [] } },
		})
	})

	it('does not mutate metadata, adopt inferred folders, or return a replacement document', async () => {
		const dataset = [registry(), page('a', '/new/folder/page')]
		const before = structuredClone(dataset)
		const { load, fetch } = transport(dataset)
		const result = await load(access)
		if (result.status !== 'loaded') throw new Error('Expected snapshot')
		expect(result.snapshot.registry!.folders).toEqual([
			{ _key: 'about-key', pathname: '/about' },
		])
		expect(result.snapshot.registry).not.toHaveProperty('custom')
		expect(result.snapshot.registry!.folders[0]).not.toHaveProperty('custom')
		Object.assign(result.snapshot.registry!.folders[0]!, {
			pathname: '/changed',
		})
		expect(dataset).toEqual(before)
		expect(fetch).toHaveBeenCalledTimes(1)
	})

	it.each(['/about//team', '/about/team/', 42, {}, [], ''])(
		'keeps malformed or empty URL values visible to the planner: %j',
		async (value) => {
			const { load } = transport([registry(), page('a', value)])
			const result = await load(access)
			if (result.status !== 'loaded') throw new Error('Expected snapshot')
			expect(result.snapshot.inventory.documents).toContainEqual(
				expect.objectContaining({ pathname: { current: value } }),
			)
			if (value !== '')
				expect(
					planner.planRemove(
						result.snapshot.registry,
						'/about',
						result.snapshot.inventory,
					),
				).toEqual({ ok: false, reason: 'invalid-inventory' })
		},
	)

	it('keeps missing URL documents, excluded paths, and collection ownership mistakes', async () => {
		const { load } = transport([
			{ _id: 'missing', _type: 'page', _rev: 'r' },
			page('reserved', '/reserved'),
			{
				_id: 'bad-slug',
				_type: 'post',
				_rev: 'r',
				slug: { current: 'nested/story' },
			},
		])
		const result = await load(access)
		if (result.status !== 'loaded') throw new Error('Expected snapshot')
		expect(result.snapshot.inventory.documents).toHaveLength(3)
		expect(result.snapshot.inventory.documents).toContainEqual({
			_id: 'missing',
			_type: 'page',
			_rev: 'r',
			pathname: { current: null },
		})
		expect(
			planner.planSynchronize(null, result.snapshot.inventory, () => 'key'),
		).toEqual({ ok: false, reason: 'invalid-inventory' })
	})

	it.each([
		FOLDER_LIMITS.inventoryDocuments,
		FOLDER_LIMITS.inventoryDocuments + 1,
		FOLDER_LIMITS.inventoryDocuments + 20,
	])(
		'detects inventory overflow without returning a truncated snapshot (%i records)',
		async (count) => {
			const { load } = transport(
				Array.from({ length: count }, (_, i) => page(`p${i}`, null)),
			)
			const result = await load(access)
			if (count === FOLDER_LIMITS.inventoryDocuments) {
				expect(result.status).toBe('loaded')
				if (result.status === 'loaded')
					expect(result.snapshot.inventory.documents).toHaveLength(count)
			} else
				expect(result).toEqual({
					status: 'unavailable',
					reason: 'limit-exceeded',
				})
		},
	)

	it('detects excessive folder records rather than silently cropping them', async () => {
		const { load } = transport([
			{
				...registry(),
				folders: Array.from({ length: 1100 }, (_, i) => ({
					_key: `k${i}`,
					pathname: `/p${i}`,
				})),
			},
		])
		expect(await load(access)).toEqual({
			status: 'unavailable',
			reason: 'limit-exceeded',
		})
	})

	it.each([
		null,
		{},
		{ documents: [] },
		{ registry: null, documents: null },
		{ registry: undefined, documents: [] },
	])('refuses invalid envelopes %j', async (response) => {
		const { load, fetch } = transport()
		fetch.mockResolvedValueOnce(response)
		expect(await load(access)).toMatchObject({ status: 'unavailable' })
	})

	it.each([
		{},
		{ ...registry(), _rev: '' },
		{ ...registry(), _id: 'wrong' },
		{ ...registry(), schemaVersion: 2 },
		{ ...registry(), folders: 'bad' },
	])('validates registry before exposing it %j', async (current) => {
		const { load, fetch } = transport()
		fetch.mockResolvedValueOnce({ ...envelope(), registry: current })
		expect(await load(access)).toEqual({
			status: 'unavailable',
			reason: 'invalid-registry',
		})
	})

	it.each([
		null,
		{},
		{ ...row(), _type: 'other' },
		{ ...row(), _rev: '' },
		{ ...row(), value: undefined },
		{ ...row(), _originalId: 'drafts.a' },
		{ ...row(), _originalId: 4 },
		{ ...row(), _id: 'drafts.' },
		{ ...row(), _id: 'versions.launch' },
		{ ...row(), _id: 'drafts.drafts.a' },
	])('rejects malformed row or merged identity %j', async (document) => {
		const { load, fetch } = transport()
		fetch.mockResolvedValueOnce({ ...envelope(), documents: [document] })
		expect(await load(access)).toEqual({
			status: 'unavailable',
			reason: 'invalid-response',
		})
	})

	it('rejects duplicate raw rows and effective registry identity', async () => {
		const { load, fetch } = transport()
		fetch.mockResolvedValueOnce({ ...envelope(), documents: [row(), row()] })
		expect(await load(access)).toEqual({
			status: 'unavailable',
			reason: 'invalid-response',
		})
		fetch.mockResolvedValueOnce({
			...envelope(),
			registry: { ...registry(), _originalId: `drafts.${planner.id}` },
		})
		expect(await load(access)).toEqual({
			status: 'unavailable',
			reason: 'invalid-response',
		})
	})

	it('accepts absent original identity and preserves matching original identity', async () => {
		const { load, fetch } = transport()
		fetch.mockResolvedValueOnce({
			...envelope(),
			documents: [
				{ ...row(), _originalId: 'a' },
				{ ...row('b'), _originalId: undefined },
			],
		})
		const result = await load(access)
		if (result.status !== 'loaded') throw new Error('Expected snapshot')
		expect(result.snapshot.inventory.documents[0]).toHaveProperty(
			'_originalId',
			'a',
		)
		expect(result.snapshot.inventory.documents[1]).not.toHaveProperty(
			'_originalId',
		)
	})

	it('does not turn request errors into a missing registry or empty inventory', async () => {
		const { load, fetch } = transport()
		fetch.mockRejectedValueOnce(new Error('Private transport details'))
		expect(await load(access)).toEqual({
			status: 'unavailable',
			reason: 'request-failed',
		})
	})

	it('honors cancellation before, during, and after fetch even if the adapter ignores it', async () => {
		const { load, fetch } = transport()
		const before = new AbortController()
		before.abort()
		expect(await load(access, before.signal)).toEqual({
			status: 'unavailable',
			reason: 'aborted',
		})
		expect(fetch).not.toHaveBeenCalled()
		for (const reject of [false, true]) {
			const controller = new AbortController()
			fetch.mockImplementationOnce(() => {
				controller.abort()
				return reject
					? Promise.reject(new Error('Canceled'))
					: Promise.resolve(envelope())
			})
			expect(await load(access, controller.signal)).toEqual({
				status: 'unavailable',
				reason: 'aborted',
			})
		}
	})

	it('quotes validated paths and snapshots config; repeated loads remain independent', async () => {
		const config = {
			routes: {
				pages: [{ schemaType: 'page', pathnameField: 'select.current' }],
			},
		}
		const { load, fetch } = transport(
			[{ _id: 'a', _type: 'page', _rev: 'r', select: { current: '/a' } }],
			config,
		)
		config.routes.pages[0]!.pathnameField = 'changed'
		const first = await load(access)
		expect(first).toMatchObject({
			status: 'loaded',
			snapshot: {
				inventory: { documents: [{ select: { current: '/a' } }] },
			},
		})
		expect(fetch.mock.calls[0]![0]).toContain('@["select"]["current"]')
		fetch.mockResolvedValueOnce(envelope())
		expect(await load(access)).toMatchObject({
			status: 'loaded',
			snapshot: { inventory: { documents: [] } },
		})
		expect(fetch).toHaveBeenCalledTimes(2)
	})

	it.each([
		'_id',
		'_type',
		'_rev',
		'_originalId',
		'_custom.value',
		'a.__proto__.value',
		'bad[0]',
	])('rejects unsafe or metadata field mappings %s', (pathnameField) => {
		const { client } = transport()
		expect(() =>
			createFolderLoader(
				{
					routes: { pages: [{ schemaType: 'page', pathnameField }] },
				},
				client,
			),
		).toThrow()
	})
})
