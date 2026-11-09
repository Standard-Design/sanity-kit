import { createClient } from '@sanity/client'
import { describe, expect, it, vi } from 'vitest'
import {
	createCollectionRoutingGuard,
	createCollectionFolderAuthorizer,
} from '../../src/studio/collections/routing-guard.js'
import type { CollectionRoutingConfig } from '../../src/url/settings/resolve.js'
import type { PagesClient } from '../../src/studio/pages/data-source.js'
import type {
	FolderRenameAuthorization,
	FolderRenameWriteTarget,
} from '../../src/studio/folders/rename-write.js'

const config: CollectionRoutingConfig = {
	pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
	collections: [
		{
			name: 'articles',
			title: 'Articles',
			settingsDocumentId: 'article-settings',
			routePrefix: { mode: 'default', value: '/seed-only' },
			index: { schemaType: 'page', pathname: '/insights' },
			items: [{ schemaType: 'article', slugField: 'slug.current' }],
		},
	],
	excludePaths: ['/account'],
	reservedPathPrefixes: ['/system'],
}
const routes = {
	...config,
	collections: [
		{ ...config.collections![0]!, title: 'Articles', routePrefix: '/articles' },
	],
}
const setting = (prefix = '/articles', draft = false) => ({
	_id: `${draft ? 'drafts.' : ''}article-settings`,
	_type: 'sanityKitCollectionRoute',
	_rev: draft ? 'draft-rev' : 'published-rev',
	collection: 'articles',
	prefix: { _type: 'slug', current: prefix },
})
function transport() {
	const rows = [setting()]
	const fetch = vi.fn((): Promise<unknown> =>
		Promise.resolve(structuredClone(rows)),
	)
	const request = vi.fn((): Promise<unknown> =>
		Promise.resolve([{ filter: 'true', permissions: ['read'] }]),
	)
	const source = {
		config: () => ({ projectId: 'test1234', dataset: 'development' }),
		fetch,
		request,
	}
	const client = { withConfig: vi.fn(() => source) } as unknown as Pick<
		PagesClient,
		'withConfig'
	>
	const guard = createCollectionRoutingGuard(config, routes, client)
	const authorize = vi.fn((): Promise<FolderRenameAuthorization> =>
		Promise.resolve({ ok: true }),
	)
	const wrapped = createCollectionFolderAuthorizer({
		configuration: config,
		routes,
		client,
		authorize,
	})
	return { rows, fetch, request, client, guard, authorize, wrapped }
}
const targets: FolderRenameWriteTarget[] = [
	{
		id: 'page1',
		schemaType: 'page',
		operation: 'update',
		revision: 'r',
		fields: ['pathname.current'],
	},
]

describe('fresh collection routing write guard', () => {
	it('accepts the public Sanity client', () => {
		const client = createClient({
			projectId: 'test1234',
			dataset: 'development',
			apiVersion: '2026-10-01',
		})
		expect(createCollectionRoutingGuard(config, routes, client)).toBeTypeOf(
			'function',
		)
	})
	it('allows a separate draft prefix only for an explicit native content-only check', async () => {
		const io = transport()
		io.rows.push(setting('/blog', true))
		const contentOnly = createCollectionRoutingGuard(
			config,
			routes,
			io.client,
			{ allowDifferentDraftRoutes: true },
		)
		expect(await contentOnly()).toMatchObject({ ok: true })
		expect(await io.guard()).toEqual({
			ok: false,
			reason: 'collection-prefix-unpublished',
		})
		io.rows[0] = setting('/changed')
		expect(await contentOnly()).toEqual({
			ok: false,
			reason: 'routing-changed',
		})
	})
	it('proves exact settings visibility then reads both views without caches', async () => {
		const io = transport()
		io.request.mockResolvedValue([
			{
				filter: '_id in ["article-settings", "drafts.article-settings"]',
				permissions: ['read'],
			},
		])
		expect(await io.guard()).toMatchObject({
			ok: true,
			fingerprint: expect.any(String) as unknown,
		})
		expect(io.request).toHaveBeenCalledWith(
			expect.objectContaining({
				url: '/projects/test1234/datasets/development/acl',
				maxRetries: 0,
				fetch: { cache: 'no-store', next: undefined },
			}),
		)
		expect(io.fetch).toHaveBeenCalledWith(
			expect.any(String),
			{ ids: ['article-settings', 'drafts.article-settings'] },
			expect.objectContaining({
				perspective: 'raw',
				useCdn: false,
				cache: 'no-store',
			}),
		)
	})
	it('does not mistake a hidden draft for an absent draft', async () => {
		const io = transport()
		io.request.mockResolvedValue([
			{ filter: '_id == "article-settings"', permissions: ['read'] },
		])
		expect(await io.guard()).toMatchObject({
			ok: false,
			reason: 'unknown-read-access',
			accessIssues: [
				expect.objectContaining({
					key: 'routing-settings:drafts.article-settings',
				}),
			],
		})
		expect(io.fetch).not.toHaveBeenCalled()
	})
	it.each(['missing', 'invalid', 'failed'] as const)(
		'blocks %s settings without using their configured default',
		async (mode) => {
			const io = transport()
			if (mode === 'missing') io.rows.length = 0
			if (mode === 'invalid') io.rows[0]!.prefix.current = '/bad//path'
			if (mode === 'failed') io.fetch.mockRejectedValue(new Error('offline'))
			expect(await io.guard()).toMatchObject({ ok: false })
			expect(io.authorize).not.toHaveBeenCalled()
		},
	)
	it('distinguishes a pending prefix change from an obsolete captured runtime', async () => {
		const io = transport()
		io.rows.push(setting('/blog', true))
		expect(await io.guard()).toEqual({
			ok: false,
			reason: 'collection-prefix-unpublished',
		})
		io.rows.splice(0, io.rows.length, setting('/blog'))
		expect(await io.guard()).toEqual({ ok: false, reason: 'routing-changed' })
	})
	it('allows matching draft/published prefixes and ignores presentation labels', async () => {
		const io = transport()
		io.rows.push(setting('/articles', true))
		const expected = {
			...routes,
			collections: [
				{
					...routes.collections[0]!,
					title: 'Editorial name',
					itemsTitle: 'Stories',
				},
			],
		}
		expect(
			await createCollectionRoutingGuard(config, expected, io.client)(),
		).toMatchObject({ ok: true })
	})
	it('compares path ownership and reservations, not just the prefix', async () => {
		const io = transport()
		for (const expected of [
			{ ...routes, excludePaths: ['/changed'] },
			{ ...routes, reservedPathPrefixes: ['/changed'] },
			{
				...routes,
				pages: [{ schemaType: 'page', pathnameField: 'other.current' }],
			},
			{
				...routes,
				collections: [
					{
						...routes.collections[0]!,
						index: { schemaType: 'page', pathname: '/changed' },
					},
				],
			},
		])
			expect(
				await createCollectionRoutingGuard(config, expected, io.client)(),
			).toEqual({ ok: false, reason: 'routing-changed' })
	})
	it('needs no settings network request for locked prefixes', async () => {
		const io = transport()
		const fixed = {
			...config,
			collections: [
				{
					...config.collections![0]!,
					routePrefix: { mode: 'locked' as const, value: '/articles' },
				},
			],
		}
		expect(
			await createCollectionRoutingGuard(fixed, routes, io.client)(),
		).toMatchObject({ ok: true })
		expect(io.request).not.toHaveBeenCalled()
		expect(io.fetch).not.toHaveBeenCalled()
	})
	it('honors cancellation even if a transport returns late', async () => {
		const io = transport()
		const abort = new AbortController()
		io.fetch.mockImplementation(() => {
			abort.abort()
			return Promise.resolve(io.rows)
		})
		expect(await io.guard(abort.signal)).toEqual({
			ok: false,
			reason: 'aborted',
		})
		io.fetch.mockClear()
		expect(await io.guard(abort.signal)).toEqual({
			ok: false,
			reason: 'aborted',
		})
		expect(io.fetch).not.toHaveBeenCalled()
	})
	it('delegates native folder authorization without weakening its denial', async () => {
		const io = transport()
		const signal = new AbortController().signal
		expect(await io.wrapped({ targets, signal })).toEqual({ ok: true })
		expect(io.authorize).toHaveBeenCalledWith({ targets, signal })
		expect(io.fetch).toHaveBeenCalledTimes(2)
		io.authorize.mockResolvedValue({
			ok: false,
			reason: 'protected',
			documentId: 'page1',
		})
		expect(await io.wrapped({ targets })).toEqual({
			ok: false,
			reason: 'protected',
			documentId: 'page1',
		})
	})
	it('blocks a folder rename before native authorization when prefixes differ', async () => {
		const io = transport()
		io.rows.push(setting('/blog', true))
		expect(await io.wrapped({ targets })).toEqual({
			ok: false,
			reason: 'unverified',
		})
		expect(io.authorize).not.toHaveBeenCalled()
	})
	it('rechecks settings revisions after native grants are evaluated', async () => {
		const io = transport()
		io.authorize.mockImplementation(() => {
			io.rows[0]!._rev = 'changed-during-authorization'
			return Promise.resolve({ ok: true })
		})
		expect(await io.wrapped({ targets })).toEqual({
			ok: false,
			reason: 'unverified',
		})
		expect(io.fetch).toHaveBeenCalledTimes(2)
		expect(io.request).toHaveBeenCalledTimes(2)
	})
})

// The guard must run after the writer's own complete occupancy read too. A UI
// check before opening the confirmation cannot protect this dispatch boundary.
describe('empty-folder removal routing guard', () => {
	async function fixture(
		beforeRemove: (signal?: AbortSignal) => Promise<boolean>,
	) {
		const { createFolderWriter } =
			await import('../../src/studio/folders/write.js')
		const events: string[] = []
		const fetch = vi.fn(() => {
			events.push('inventory')
			return Promise.resolve({
				registry: {
					_id: 'sanityKit.folders',
					_type: 'sanityKitFolderRegistry',
					_rev: 'r',
					schemaVersion: 1,
					folders: [{ _key: 'empty', pathname: '/empty' }],
				},
				documents: [],
			})
		})
		const request = vi.fn(() => {
			events.push('write')
			return Promise.resolve({
				transactionId: 'tx',
				results: [{ id: 'sanityKit.folders', operation: 'update' }],
			})
		})
		const guard = vi.fn((signal?: AbortSignal) => {
			events.push('guard')
			return beforeRemove(signal)
		})
		const writer = createFolderWriter(
			{
				routes: {
					pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
				},
				beforeRemove: guard,
			},
			{
				withConfig: () => ({
					config: () => ({ dataset: 'test' }),
					fetch,
					request,
				}),
			},
		)
		return { writer, fetch, request, events, guard }
	}
	it('checks routing before inventory and again immediately before removal', async () => {
		const io = await fixture(() => Promise.resolve(true))
		expect(
			await io.writer.remove({
				pathname: '/empty',
				readAccess: 'all-registered-versions',
			}),
		).toMatchObject({ status: 'written' })
		expect(io.events).toEqual(['guard', 'inventory', 'guard', 'write'])
	})
	it('does not remove a folder if settings changed during the occupancy read', async () => {
		let count = 0
		const io = await fixture(() => Promise.resolve(++count === 1))
		expect(
			await io.writer.remove({
				pathname: '/empty',
				readAccess: 'all-registered-versions',
			}),
		).toEqual({ status: 'blocked', reason: 'routing-changed' })
		expect(io.fetch).toHaveBeenCalledOnce()
		expect(io.request).not.toHaveBeenCalled()
	})
	it('fails closed if the routing check throws, without changing additive operations', async () => {
		const io = await fixture(() => Promise.reject(new Error('offline')))
		expect(
			await io.writer.remove({
				pathname: '/empty',
				readAccess: 'all-registered-versions',
			}),
		).toEqual({ status: 'blocked', reason: 'routing-changed' })
		expect(io.fetch).not.toHaveBeenCalled()
		io.guard.mockClear()
		expect(
			await io.writer.create({
				pathname: '/new',
				readAccess: 'all-registered-versions',
			}),
		).toMatchObject({ status: 'written' })
		expect(io.guard).not.toHaveBeenCalled()
	})
})
