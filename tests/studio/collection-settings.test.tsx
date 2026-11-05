// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createClient } from '@sanity/client'
import {
	createMockAuthStore,
	createSourceFromConfig,
	type DocumentActionComponent,
	type SingleWorkspace,
	type ObjectSchemaType,
} from 'sanity'
import { createStructureBuilder, structureTool } from 'sanity/structure'
import { describe, expect, it, vi } from 'vitest'
import {
	collectionRoutingSettings,
	collectionRoutingSettingsItems,
	validateCollectionPrefix,
	withCollectionRoutingSettings,
} from '../../src/studio/collections/settings.js'
import {
	COLLECTION_ROUTE_TYPE,
	type CollectionRoutingConfig,
} from '../../src/url/settings/resolve.js'

const workspaceMock = vi.hoisted(() => ({ actions: vi.fn() }))
vi.mock('sanity', async (importOriginal) => ({
	...(await importOriginal<typeof import('sanity')>()),
	useWorkspace: () => ({ document: { actions: workspaceMock.actions } }),
}))
const routes: CollectionRoutingConfig = {
	pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
	excludePaths: ['/health'],
	reservedPathPrefixes: ['/account'],
	collections: [
		{
			name: 'journal',
			title: 'Journal',
			routePrefix: { documentId: 'journal-routing' },
			overview: { schemaType: 'page', pathname: '/insights' },
			items: [{ schemaType: 'post', slugField: 'slug.current' }],
		},
		{
			name: 'people',
			title: 'People',
			routePrefix: '/people',
			overview: { schemaType: 'page', pathname: '/team' },
			items: [{ schemaType: 'person', slugField: 'slug.current' }],
		},
	],
}
function action(
	name: NonNullable<DocumentActionComponent['action']>,
): DocumentActionComponent {
	const component: DocumentActionComponent = () => ({ label: name })
	component.action = name
	return component
}
async function source(config: SingleWorkspace) {
	const client = createClient({
		projectId: 'abcdefgh',
		dataset: 'test',
		apiVersion: '2026-10-01',
		useCdn: false,
		maxRetries: 0,
		resolveFetch: () => () =>
			Promise.resolve(
				new Response(JSON.stringify({ grants: [] }), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				}),
			),
	})
	return createSourceFromConfig({
		...config,
		auth: createMockAuthStore({
			client: client as unknown as Parameters<
				typeof createMockAuthStore
			>[0]['client'],
			currentUser: null,
		}),
	})
}
function workspace(): SingleWorkspace {
	return {
		projectId: 'abcdefgh',
		dataset: 'test',
		plugins: [structureTool()],
		schema: {
			types: [
				{
					name: 'page',
					type: 'document',
					fields: [{ name: 'title', type: 'string' }],
				},
			],
		},
	}
}

describe('collection routing settings draft editor', () => {
	it.each(['/journal', '/news/articles', '/accounting'])(
		'accepts a canonical prefix %s',
		(value) => expect(validateCollectionPrefix(value, routes)).toBe(true),
	)
	it.each([
		undefined,
		'',
		'/',
		'journal',
		'/journal/',
		'/news//articles',
		'https://example.com/news',
		'/news?draft=true',
	])('rejects invalid prefix %s', (value) =>
		expect(validateCollectionPrefix(value, routes)).not.toBe(true),
	)
	it.each([
		'/health',
		'/account',
		'/account/profile',
		'/people',
		'/people/team',
	])('rejects a known reserved or fixed collection prefix %s', (value) =>
		expect(validateCollectionPrefix(value, routes)).not.toBe(true),
	)
	it('enforces prefix length', () =>
		expect(validateCollectionPrefix('/' + 'x'.repeat(2048), routes)).toContain(
			'2048',
		))
	it('validates routing registration before producing UI', () =>
		expect(() =>
			collectionRoutingSettings({
				routes: {
					...routes,
					collections: [
						{
							...routes.collections![0]!,
							routePrefix: { documentId: 'private.routing' },
						},
					],
				},
			}),
		).toThrow('non-dotted'))
	it('compiles one native schema and creates only configured settings singleton panes', async () => {
		const resolved = await source(
			withCollectionRoutingSettings(workspace(), { routes }),
		)
		const schema = resolved.schema.get(
			COLLECTION_ROUTE_TYPE,
		) as ObjectSchemaType
		expect(schema.fields.map((field) => field.name)).toEqual([
			'collection',
			'prefix',
		])
		expect(schema.fields[0]?.type.readOnly).toBe(true)
		expect(schema.fields[1]?.type.name).toBe('slug')
		const items = collectionRoutingSettingsItems(
			createStructureBuilder({
				source: resolved,
				perspectiveStack: ['drafts'],
			}),
			routes,
		)
		expect(items.map((item) => item.serialize())).toMatchObject([
			{
				id: 'journal-routing',
				title: 'Journal URL settings',
				child: {
					type: 'document',
					options: {
						id: 'journal-routing',
						type: COLLECTION_ROUTE_TYPE,
						template: `${COLLECTION_ROUTE_TYPE}-journal`,
					},
				},
			},
		])
		expect(
			resolved.templates.filter((t) => t.schemaType === COLLECTION_ROUTE_TYPE),
		).toEqual([expect.objectContaining({ value: { collection: 'journal' } })])
		expect(
			resolved.document
				.resolveNewDocumentOptions({ type: 'global' })
				.map((item) => item.schemaType),
		).not.toContain(COLLECTION_ROUTE_TYPE)
		expect(
			resolved.document.resolveNewDocumentOptions({
				type: 'structure',
				schemaType: COLLECTION_ROUTE_TYPE,
			}),
		).toEqual([])
	})
	it('locks wrong identities, collection bindings, and release versions', async () => {
		const resolved = await source(
			withCollectionRoutingSettings(workspace(), { routes }),
		)
		const readOnly = resolved.schema.get(COLLECTION_ROUTE_TYPE)?.readOnly
		if (typeof readOnly !== 'function')
			throw new Error('Expected identity guard')
		for (const [_id, collection, expected] of [
			['journal-routing', 'journal', false],
			['drafts.journal-routing', 'journal', false],
			['versions.release.journal-routing', 'journal', true],
			['random-id', 'journal', true],
			['drafts.journal-routing', 'people', true],
		] as const)
			expect(
				readOnly({
					document: {
						_id,
						_type: COLLECTION_ROUTE_TYPE,
						collection,
						_rev: 'r1',
						_createdAt: '2026-11-05T00:00:00Z',
						_updatedAt: '2026-11-05T00:00:00Z',
					},
					parent: undefined,
					value: undefined,
					currentUser: null,
					path: [],
				}),
			).toBe(expected)
	})
	it('runs its final action guard after application reducers and native tools', async () => {
		const config = withCollectionRoutingSettings(
			{
				...workspace(),
				document: {
					actions: (previous) => [
						...previous,
						action('publish'),
						action('schedule'),
						action('delete'),
						action('unpublish'),
						action('duplicate'),
					],
				},
			},
			{ routes },
		)
		const resolved = await source(config)
		expect(
			resolved.document
				.actions({
					schemaType: COLLECTION_ROUTE_TYPE,
					versionType: 'draft',
					releaseId: undefined,
				})
				.map((a) => a.action),
		).toEqual(['discardChanges'])
		expect(
			resolved.document
				.actions({
					schemaType: 'page',
					versionType: 'draft',
					releaseId: undefined,
				})
				.some((a) => a.action === 'publish'),
		).toBe(true)
		expect(
			resolved.document
				.actions({
					schemaType: COLLECTION_ROUTE_TYPE,
					versionType: 'version',
					releaseId: 'release',
				})
				.every((a) => a.action === 'discardChanges'),
		).toBe(true)
	})
	it('fails closed when a later workspace override restores Publish', async () => {
		const plugin = collectionRoutingSettings({ routes })
		const Layout = plugin.studio?.components?.layout
		if (!Layout) throw new Error('Missing layout')
		workspaceMock.actions.mockReturnValue([action('publish')])
		const host = document.createElement('div'),
			root = createRoot(host)
		Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
		try {
			await expect(
				act(async () => {
					root.render(<Layout renderDefault={() => <></>} />)
					await Promise.resolve()
				}),
			).rejects.toThrow('withCollectionRoutingSettings')
		} finally {
			await act(async () => {
				root.unmount()
				await Promise.resolve()
			})
		}
	})
})
