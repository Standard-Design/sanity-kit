// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from '@sanity/ui'
import { buildTheme } from '@sanity/ui/theme'
import type { ComponentType } from 'react'
import { createClient } from '@sanity/client'
import {
	createMockAuthStore,
	createSourceFromConfig,
	type DocumentActionComponent,
	type SingleWorkspace,
	type ObjectSchemaType,
	type StringInputProps,
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

const workspaceMock = vi.hoisted(() => ({
	actions: vi.fn(),
	document: { _id: 'drafts.journal-routing' },
}))
vi.mock('sanity', async (importOriginal) => ({
	...(await importOriginal<typeof import('sanity')>()),
	useWorkspace: () => ({ document: { actions: workspaceMock.actions } }),
	useFormValue: () => workspaceMock.document,
}))
const routes: CollectionRoutingConfig = {
	pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
	excludePaths: ['/health'],
	reservedPathPrefixes: ['/account'],
	collections: [
		{
			name: 'journal',
			title: 'Journal',
			settingsDocumentId: 'journal-routing',
			index: { schemaType: 'page', pathname: '/insights' },
			items: [{ schemaType: 'post', slugField: 'slug.current' }],
		},
		{
			name: 'people',
			title: 'People',
			routePrefix: '/people',
			index: { schemaType: 'page', pathname: '/team' },
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
							settingsDocumentId: 'private.routing',
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
			'displayName',
			'prefix',
			'collection',
		])
		expect(schema.fields[2]?.type.readOnly).toBe(true)
		expect(schema.fields[2]?.type.description).toBe(
			'Read-only string that identifies the collection',
		)
		expect(schema.fields[1]?.type.name).toBe('slug')
		expect(schema.preview?.prepare?.({ collection: 'journal' })).toMatchObject({
			title: 'Journal collection settings',
		})
		expect(
			schema.preview?.prepare?.({ id: 'drafts.journal-routing' }),
		).toMatchObject({ title: 'Journal collection settings' })
		expect(
			schema.preview?.prepare?.({
				collection: 'journal',
				displayName: 'Insights',
			}),
		).toMatchObject({ title: 'Insights collection settings' })

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
				title: 'Journal collection settings',
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
		).toEqual([
			expect.objectContaining({
				value: { collection: 'journal', displayName: 'Journal' },
			}),
		])
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
	it.each([
		['default', 'default'],
		['default', 'locked'],
		['locked', 'default'],
		['locked', 'locked'],
	] as const)(
		'supports %s names with %s prefixes independently',
		async (nameMode, prefixMode) => {
			const config: CollectionRoutingConfig = {
				...routes,
				collections: [
					{
						...routes.collections![0]!,
						displayName: { mode: nameMode, value: 'Articles' },
						settingsDocumentId: 'journal-routing',
						routePrefix: {
							mode: prefixMode,
							value: '/articles',
						},
					},
				],
			}
			const resolved = await source(
				withCollectionRoutingSettings(workspace(), { routes: config }),
			)
			const schema = resolved.schema.get(
				COLLECTION_ROUTE_TYPE,
			) as ObjectSchemaType
			const context = {
				document: {
					_id: 'drafts.journal-routing',
					_type: COLLECTION_ROUTE_TYPE,
					collection: 'journal',
					_rev: 'r',
					_createdAt: '',
					_updatedAt: '',
				},
				parent: undefined,
				value: undefined,
				path: [],
				currentUser: null,
			}
			for (const [name, locked] of [
				['displayName', nameMode === 'locked'],
				['prefix', prefixMode === 'locked'],
			] as const) {
				const readOnly = schema.fields.find((field) => field.name === name)!
					.type.readOnly
				expect(typeof readOnly === 'function' && readOnly(context)).toBe(locked)
			}
			expect(
				resolved.templates.find(
					(template) => template.id === `${COLLECTION_ROUTE_TYPE}-journal`,
				)?.value,
			).toEqual({
				collection: 'journal',
				displayName: 'Articles',
				prefix: { _type: 'slug', current: '/articles' },
			})
			expect(
				schema.preview?.prepare?.({
					id: 'drafts.journal-routing',
					collection: 'journal',
					displayName: 'Editor name',
					prefix: '/editor-prefix',
				}),
			).toMatchObject({
				title: `${nameMode === 'locked' ? 'Articles' : 'Editor name'} collection settings`,
				subtitle: prefixMode === 'locked' ? '/articles' : '/editor-prefix',
			})
		},
	)
	it('renders locked values from code as disabled inputs even with stale stored values', async () => {
		const config: CollectionRoutingConfig = {
			...routes,
			collections: [
				{
					...routes.collections![0]!,
					displayName: { mode: 'locked', value: 'Articles' },
					settingsDocumentId: 'journal-routing',
					routePrefix: {
						mode: 'locked',
						value: '/articles',
					},
				},
			],
		}
		const resolved = await source(
			withCollectionRoutingSettings(workspace(), { routes: config }),
		)
		const schema = resolved.schema.get(
			COLLECTION_ROUTE_TYPE,
		) as ObjectSchemaType
		const host = document.createElement('div'),
			root = createRoot(host)
		const renderDefault = vi.fn(() => <span>Editable input</span>)
		Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
		try {
			await act(async () => {
				root.render(
					<ThemeProvider theme={buildTheme()}>
						{schema.fields.map((field) => {
							const Input = field.type.components
								?.input as ComponentType<StringInputProps>
							return (
								<Input
									key={field.name}
									{...({
										value: 'stale',
										elementProps: { id: field.name },
										renderDefault,
									} as unknown as StringInputProps)}
								/>
							)
						})}
					</ThemeProvider>,
				)
				await Promise.resolve()
			})
			expect(
				[...host.querySelectorAll('input')].map((input) => ({
					value: input.value,
					disabled: input.disabled,
					readOnly: input.readOnly,
				})),
			).toEqual([
				{ value: 'Articles', disabled: true, readOnly: true },
				{ value: '/articles', disabled: true, readOnly: true },
				{ value: 'stale', disabled: true, readOnly: true },
			])
			expect(renderDefault).not.toHaveBeenCalled()
		} finally {
			await act(async () => {
				root.unmount()
				await Promise.resolve()
			})
		}
	})
	it('reserves explicitly locked prefixes from other collections without blocking their own field', () => {
		const config: CollectionRoutingConfig = {
			...routes,
			collections: [
				{
					...routes.collections![0]!,
					settingsDocumentId: 'journal-routing',
					routePrefix: {
						mode: 'locked',
						value: '/journal',
					},
				},
			],
		}
		expect(validateCollectionPrefix('/journal', config)).not.toBe(true)
		expect(validateCollectionPrefix('/journal/subfolder', config)).not.toBe(
			true,
		)
		expect(validateCollectionPrefix('/journal', config, 'journal')).toBe(true)
	})

	it('initializes a display-name-only settings document with an empty editable prefix', async () => {
		const config: CollectionRoutingConfig = {
			pages: routes.pages,
			collections: [
				{
					name: 'journal',
					settingsDocumentId: 'journal-routing',
					displayName: { mode: 'default', value: 'Articles' },
					index: { schemaType: 'page', pathname: '/insights' },
					items: [{ schemaType: 'post', slugField: 'slug.current' }],
				},
			],
		}
		const resolved = await source(
			withCollectionRoutingSettings(workspace(), { routes: config }),
		)
		expect(
			resolved.templates.find(
				(template) => template.id === `${COLLECTION_ROUTE_TYPE}-journal`,
			)?.value,
		).toEqual({ collection: 'journal', displayName: 'Articles' })
		const schema = resolved.schema.get(
			COLLECTION_ROUTE_TYPE,
		) as ObjectSchemaType
		expect(schema.preview?.prepare?.({ id: 'journal-routing' })).toMatchObject({
			title: 'Articles collection settings',
			subtitle: 'No prefix yet',
		})
		const readOnly = schema.fields.find((field) => field.name === 'prefix')!
			.type.readOnly
		expect(
			typeof readOnly === 'function' &&
				readOnly({
					document: {
						_id: 'journal-routing',
						_type: COLLECTION_ROUTE_TYPE,
						_rev: '',
						_createdAt: '',
						_updatedAt: '',
					},
					parent: undefined,
					value: undefined,
					path: [],
					currentUser: null,
				}),
		).toBe(false)
	})
	it('creates a settings entry for an editable name with a string-locked prefix', async () => {
		const config: CollectionRoutingConfig = {
			...routes,
			collections: [
				{
					...routes.collections![0]!,
					routePrefix: '/journal',
					displayName: { mode: 'default', value: 'Articles' },
				},
			],
		}
		const resolved = await source(
			withCollectionRoutingSettings(workspace(), { routes: config }),
		)
		expect(
			resolved.templates.find(
				(template) => template.id === `${COLLECTION_ROUTE_TYPE}-journal`,
			)?.value,
		).toEqual({
			collection: 'journal',
			displayName: 'Articles',
			prefix: { _type: 'slug', current: '/journal' },
		})
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
