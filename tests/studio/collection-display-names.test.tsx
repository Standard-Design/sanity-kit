// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/require-await -- React act flushes asynchronous effects. */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	CollectionDisplayNamesProvider,
	resolveCollectionDisplayNames,
	useCollectionDisplayNames,
} from '../../src/studio/collections/display-names.js'
import {
	COLLECTION_ROUTE_TYPE,
	MAX_COLLECTION_DISPLAY_NAME_LENGTH,
	type CollectionRoutingConfig,
} from '../../src/url/settings/resolve.js'

const native = vi.hoisted(() => ({
	fetch:
		vi.fn<
			(
				query: string,
				params: { ids: string[] },
				options: { signal: AbortSignal },
			) => Promise<unknown[]>
		>(),
	listen: vi.fn(),
	withConfig: vi.fn(),
	unsubscribe: vi.fn(),
}))
vi.mock('sanity', () => ({ useClient: () => native }))
const routes: CollectionRoutingConfig = {
	pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
	collections: [
		{
			name: 'articles',
			title: 'Articles',
			index: { schemaType: 'page', pathname: '/articles' },
			settingsDocumentId: 'articles-settings',
			items: [{ schemaType: 'article', slugField: 'slug.current' }],
		},
		{
			name: 'constructor',
			title: 'People',
			index: { schemaType: 'page', pathname: '/people' },
			routePrefix: '/people',
			items: [{ schemaType: 'person', slugField: 'slug.current' }],
		},
	],
}
const published = {
	_id: 'articles-settings',
	_type: COLLECTION_ROUTE_TYPE,
	collection: 'articles',
	displayName: 'Published name',
}
const draft = {
	...published,
	_id: 'drafts.articles-settings',
	displayName: 'Draft name',
}
function ReadNames() {
	return <output>{JSON.stringify(useCollectionDisplayNames())}</output>
}
let root: Root
let host: HTMLDivElement
let observer: { next: () => void; error: () => void }
async function render(config = routes) {
	await act(async () =>
		root.render(
			<CollectionDisplayNamesProvider routes={config}>
				<ReadNames />
			</CollectionDisplayNamesProvider>,
		),
	)
}
function displayed() {
	return JSON.parse(host.textContent || '{}') as Record<string, string>
}
beforeEach(() => {
	;(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true
	vi.clearAllMocks()
	native.withConfig.mockReturnValue(native)
	native.fetch.mockResolvedValue([])
	native.listen.mockImplementation(() => ({
		subscribe: (value: typeof observer) => {
			observer = value
			return { unsubscribe: native.unsubscribe }
		},
	}))
	host = document.createElement('div')
	document.body.append(host)
	root = createRoot(host)
})
afterEach(async () => {
	await act(async () => root.unmount())
	host.remove()
})

describe('Studio collection display names', () => {
	it('uses a draft before published metadata and leaves code-fixed names unchanged', () => {
		const names = resolveCollectionDisplayNames(routes, [published, draft])
		expect(names.articles).toBe('Draft name')
		expect(names.constructor).toBe('People')
		expect(Object.getPrototypeOf(names)).toBeNull()
		expect(resolveCollectionDisplayNames(routes, [published]).articles).toBe(
			'Published name',
		)
		expect(resolveCollectionDisplayNames(routes, []).articles).toBe('Articles')
	})
	it.each([
		{ displayName: '' },
		{ displayName: 23 },
		{ displayName: 'x'.repeat(MAX_COLLECTION_DISPLAY_NAME_LENGTH + 1) },
		{ collection: 'wrong' },
		{ _type: 'wrong' },
	])('falls back for invalid bound draft metadata: %j', (change) => {
		expect(
			resolveCollectionDisplayNames(routes, [
				published,
				{ ...draft, ...change },
			]).articles,
		).toBe('Articles')
	})
	it('ignores stray and release documents even when their collection matches', () => {
		expect(
			resolveCollectionDisplayNames(routes, [
				{ ...draft, _id: 'stray' },
				{ ...draft, _id: 'versions.release.articles-settings' },
			]).articles,
		).toBe('Articles')
	})
	it('uses an explicit default name until valid editorial metadata overrides it', () => {
		const configured: CollectionRoutingConfig = {
			...routes,
			collections:
				routes.collections?.map((collection) => ({
					...collection,
					displayName: { mode: 'default' as const, value: 'Stories' },
				})) ?? [],
		}
		expect(resolveCollectionDisplayNames(configured, []).articles).toBe(
			'Stories',
		)
		expect(
			resolveCollectionDisplayNames(configured, [published]).articles,
		).toBe('Published name')
		expect(
			resolveCollectionDisplayNames(configured, [published, draft]).articles,
		).toBe('Draft name')
		expect(
			resolveCollectionDisplayNames(configured, [
				published,
				{ ...draft, displayName: '' },
			]).articles,
		).toBe('Stories')
	})
	it('never overrides a locked name with draft or published metadata', async () => {
		const configured: CollectionRoutingConfig = {
			...routes,
			collections:
				routes.collections?.map((collection) => ({
					...collection,
					displayName: { mode: 'locked' as const, value: 'Stories' },
				})) ?? [],
		}
		expect(
			resolveCollectionDisplayNames(configured, [published, draft]).articles,
		).toBe('Stories')
		await render(configured)
		expect(displayed().articles).toBe('Stories')
		expect(native.fetch).not.toHaveBeenCalled()
		expect(native.listen).not.toHaveBeenCalled()
	})
	it('allows a default name to change independently of a locked prefix', async () => {
		const configured: CollectionRoutingConfig = {
			...routes,
			collections: [
				{
					...routes.collections![0]!,
					displayName: { mode: 'default', value: 'Stories' },
					routePrefix: {
						mode: 'locked',
						value: '/fixed',
					},
				},
			],
		}
		native.fetch.mockResolvedValue([draft])
		await render(configured)
		expect(displayed().articles).toBe('Draft name')
		expect(native.fetch).toHaveBeenCalledOnce()
	})
	it.each(['default', 'locked'] as const)(
		'uses the configured %s name when no settings document is bound',
		async (mode) => {
			const configured: CollectionRoutingConfig = {
				...routes,
				collections: [
					{
						name: 'articles',
						index: { schemaType: 'page', pathname: '/articles' },
						items: [{ schemaType: 'article', slugField: 'slug.current' }],
						displayName: { mode, value: 'Stories' },
						routePrefix: '/articles',
					},
				],
			}
			expect(resolveCollectionDisplayNames(configured, [draft]).articles).toBe(
				'Stories',
			)
			await render(configured)
			expect(displayed().articles).toBe('Stories')
			expect(native.fetch).not.toHaveBeenCalled()
		},
	)
	it.each([
		{},
		{ routePrefix: '/fixed' },
		{ routePrefix: { mode: 'default' as const, value: '/default' } },
	])(
		'reads names from the explicit binding independently of prefix configuration: %j',
		async (prefix) => {
			const configured: CollectionRoutingConfig = {
				pages: [],
				collections: [
					{
						name: 'articles',
						index: { schemaType: 'page', pathname: '/articles' },
						settingsDocumentId: 'articles-settings',
						items: [{ schemaType: 'article', slugField: 'slug.current' }],
						...prefix,
					},
				],
			}
			expect(resolveCollectionDisplayNames(configured, []).articles).toBe(
				'articles',
			)
			native.fetch.mockResolvedValue([draft])
			await render(configured)
			expect(displayed().articles).toBe('Draft name')
			expect(native.fetch).toHaveBeenCalledOnce()
		},
	)
	it('queries exact IDs with raw perspective and no routing fields', async () => {
		native.fetch.mockResolvedValue([draft])
		await render()
		expect(displayed().articles).toBe('Draft name')
		expect(native.withConfig).toHaveBeenCalledWith({
			useCdn: false,
			perspective: 'raw',
		})
		expect(native.fetch).toHaveBeenCalledWith(
			'*[_id in $ids]{_id, _type, collection, displayName}',
			{ ids: ['articles-settings', 'drafts.articles-settings'] },
			expect.objectContaining({
				signal: native.fetch.mock.calls[0]?.[2].signal,
			}),
		)
	})
	it('waits for query visibility so a saved name cannot get stuck on the previous query result', async () => {
		let queryDocuments: unknown[] = [published]
		let visibility: string | undefined
		native.fetch.mockImplementation(async () => queryDocuments)
		native.listen.mockImplementation(
			(_query, _params, options: { visibility?: string }) => {
				visibility = options.visibility
				return {
					subscribe: (value: typeof observer) => {
						observer = value
						return { unsubscribe: native.unsubscribe }
					},
				}
			},
		)
		await render()
		expect(displayed().articles).toBe('Published name')
		// A committed save can precede GROQ indexing. Default listeners deliver
		// here, so a refresh reads the previous name with no later event to fix it.
		if (visibility !== 'query') await act(async () => observer.next())
		queryDocuments = [published, draft]
		if (visibility === 'query') await act(async () => observer.next())
		expect(displayed().articles).toBe('Draft name')
	})

	it('updates after mutations and reverts after draft deletion', async () => {
		native.fetch
			.mockResolvedValueOnce([published])
			.mockResolvedValueOnce([published, draft])
			.mockResolvedValueOnce([published])
		await render()
		expect(displayed().articles).toBe('Published name')
		await act(async () => observer.next())
		expect(displayed().articles).toBe('Draft name')
		await act(async () => observer.next())
		expect(displayed().articles).toBe('Published name')
	})
	it('ignores a response overtaken by a mutation and refreshes once', async () => {
		let finish!: (documents: unknown[]) => void
		native.fetch
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						finish = resolve
					}),
			)
			.mockResolvedValue([draft])
		await render()
		await act(async () => {
			observer.next()
			observer.next()
			finish([published])
		})
		expect(displayed().articles).toBe('Draft name')
		expect(native.fetch).toHaveBeenCalledTimes(2)
	})
	it('uses configured labels when reading metadata fails', async () => {
		native.fetch.mockRejectedValue(new Error('offline'))
		await render()
		expect(displayed().articles).toBe('Articles')
		native.fetch.mockResolvedValue([draft])
		await act(async () => observer.next())
		expect(displayed().articles).toBe('Draft name')
		await act(async () => observer.error())
		expect(displayed().articles).toBe('Articles')
	})
	it('cleans up on registration changes and never carries old labels to new bindings', async () => {
		native.fetch.mockResolvedValueOnce([draft]).mockResolvedValueOnce([])
		await render()
		const next = {
			...routes,
			collections: routes.collections?.map((collection) => ({
				...collection,
				title: 'Replacement',
				settingsDocumentId: 'replacement',
			})),
		} as CollectionRoutingConfig
		await render(next)
		expect(displayed().articles).toBe('Replacement')
		expect(native.unsubscribe).toHaveBeenCalledOnce()
		expect(native.fetch.mock.calls[0]?.[2].signal.aborted).toBe(true)
	})
	it('does not request any data when no settings document is bound', async () => {
		await render({
			pages: routes.pages,
			collections:
				routes.collections?.filter(
					(collection) => !collection.settingsDocumentId,
				) ?? [],
		})
		expect(native.fetch).not.toHaveBeenCalled()
		expect(native.listen).not.toHaveBeenCalled()
		expect(displayed().constructor).toBe('People')
	})
})
