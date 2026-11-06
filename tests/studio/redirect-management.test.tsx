// @vitest-environment jsdom
import { act } from 'react'
import { ThemeProvider } from '@sanity/ui'
import { buildTheme } from '@sanity/ui/theme'
import { createRoot } from 'react-dom/client'
import { createClient } from '@sanity/client'
import {
	createMockAuthStore,
	createSourceFromConfig,
	createSchema,
	validateDocument,
	type DocumentActionComponent,
	type ObjectInputProps,
	type ObjectSchemaType,
	type SingleWorkspace,
	type ValidationContext,
	type LocaleSource,
	type SanityDocument,
} from 'sanity'
import { createStructureBuilder, structureTool } from 'sanity/structure'
import { describe, expect, it } from 'vitest'
import { withUrlPublication } from '../../src/studio/url/publication-plugin.js'
import { withCollectionRoutingSettings } from '../../src/studio/collections/settings.js'
import {
	COLLECTION_ROUTE_TYPE,
	type CollectionRoutingConfig,
} from '../../src/url/settings/resolve.js'
import {
	createRedirectSchema,
	redirectManagementItem,
	RedirectDraftInput,
	REDIRECT_MANUAL_TEMPLATE,
	validateRedirectPath,
} from '../../src/studio/redirects/schema.js'
import { loadRedirectSnapshot } from '../../src/redirect/load.js'
import { evaluate, parse } from 'groq-js'

const routes = {
	pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
	excludePaths: ['/health'],
	reservedPathPrefixes: ['/account'],
}
const row: SanityDocument = {
	_id: 'drafts.rule',
	_type: 'sanityKitRedirect',
	_rev: 'r1',
	_createdAt: '2026-11-05T00:00:00Z',
	_updatedAt: '2026-11-05T00:00:00Z',
	source: '/old',
	destination: '/new',
	status: 301,
	enabled: true,
	origin: 'manual',
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
async function validate(document: SanityDocument) {
	const schema = createSchema({
		name: 'redirect-test',
		types: [
			createRedirectSchema({
				editableDrafts: true,
				reservedPaths: ['/health'],
				reservedPathPrefixes: ['/account'],
			}),
		],
	})
	const client = createClient({
		projectId: 'abcdefgh',
		dataset: 'test',
		apiVersion: '2026-10-01',
		useCdn: false,
	})
	return validateDocument({
		document,
		workspace: {
			schema,
			getClient: () =>
				client as unknown as ReturnType<ValidationContext['getClient']>,
			i18n: {
				t: (key: string) => key,
				loadNamespaces: () => Promise.resolve(),
			} as unknown as LocaleSource,
		},
		environment: 'studio',
	})
}

describe('native redirect draft editor', () => {
	it('keeps readonly behavior unless explicitly enabled', () => {
		expect(createRedirectSchema().readOnly).toBe(true)
	})
	it('compiles one schema, one manual template, and a native searchable list', async () => {
		const resolved = await source(
			withUrlPublication(workspace(), { routes, redirectManagement: 'drafts' }),
		)
		const schema = resolved.schema.get('sanityKitRedirect') as ObjectSchemaType
		expect(schema.fields.map((field) => field.name)).toEqual([
			'source',
			'destination',
			'status',
			'enabled',
			'origin',
		])
		expect(
			schema.fields.find((field) => field.name === 'origin')?.type.readOnly,
		).toBe(true)
		expect(
			resolved.templates.filter(
				(template) => template.schemaType === 'sanityKitRedirect',
			),
		).toEqual([
			expect.objectContaining({
				id: REDIRECT_MANUAL_TEMPLATE,
				value: { status: 301, enabled: true, origin: 'manual' },
			}),
		])
		const item = redirectManagementItem(
			createStructureBuilder({
				source: resolved,
				perspectiveStack: ['drafts'],
			}),
		).serialize()
		expect(item).toMatchObject({
			title: 'Redirects',
			child: {
				type: 'documentList',
				options: {
					filter: '_type == $type',
					params: { type: 'sanityKitRedirect' },
				},
			},
		})
		expect(
			resolved.document
				.resolveNewDocumentOptions({
					type: 'structure',
					schemaType: 'sanityKitRedirect',
				})
				.map((choice) => choice.templateId),
		).toContain(REDIRECT_MANUAL_TEMPLATE)
	})
	it('preserves only native draft discard after built-in and consumer actions run', async () => {
		const config = workspace()
		config.document = {
			actions: (previous) => [
				...previous,
				action('publish'),
				action('delete'),
				action('schedule'),
			],
		}
		const resolved = await source(
			withUrlPublication(config, { routes, redirectManagement: 'drafts' }),
		)
		expect(
			resolved.document
				.actions({
					schemaType: 'sanityKitRedirect',
					versionType: 'draft',
					releaseId: undefined,
				})
				.map((item) => item.action),
		).toEqual(['discardChanges'])
		expect(
			resolved.document.actions({
				schemaType: 'sanityKitRedirect',
				versionType: 'version',
				releaseId: 'release',
			}),
		).toEqual([])
	})
	it.each([
		['settings outside publication', 'function'],
		['settings outside publication', 'array'],
		['publication outside settings', 'function'],
		['publication outside settings', 'array'],
	] as const)(
		'keeps both guards when composing %s with consumer %s actions',
		async (order, reducerKind) => {
			const consumerPublish = action('publish')
			const consumerSchedule = action('schedule')
			const consumerDelete = action('delete')
			const additions = [consumerPublish, consumerSchedule, consumerDelete]
			const base = workspace()
			base.schema = {
				types: [
					{
						name: 'page',
						type: 'document',
						fields: [{ name: 'pathname', type: 'slug' }],
					},
					{
						name: 'post',
						type: 'document',
						fields: [{ name: 'slug', type: 'slug' }],
					},
				],
			}
			base.document = {
				actions:
					reducerKind === 'array'
						? additions
						: (previous) => [...previous, ...additions],
			}
			const collection = {
				name: 'articles',
				title: 'Articles',
				index: { schemaType: 'page', pathname: '/insights' },
				routePrefix: '/articles',
				items: [{ schemaType: 'post', slugField: 'slug.current' }],
			}
			const resolvedRoutes = { ...routes, collections: [collection] }
			const settingsRoutes: CollectionRoutingConfig = {
				...routes,
				collections: [
					{
						...collection,
						settingsDocumentId: 'articles-settings',
						displayName: { mode: 'default', value: 'Articles' },
						routePrefix: { mode: 'locked', value: '/articles' },
					},
				],
			}
			const publicationOptions = {
				routes: resolvedRoutes,
				redirectManagement: 'drafts' as const,
			}
			const config =
				order === 'settings outside publication'
					? withCollectionRoutingSettings(
							withUrlPublication(base, publicationOptions),
							{ routes: settingsRoutes },
						)
					: withUrlPublication(
							withCollectionRoutingSettings(base, { routes: settingsRoutes }),
							publicationOptions,
						)
			const resolved = await source(config)
			const actionsFor = (schemaType: string) =>
				resolved.document.actions({
					schemaType,
					versionType: 'draft',
					releaseId: undefined,
				})
			for (const schemaType of ['sanityKitRedirect', COLLECTION_ROUTE_TYPE]) {
				expect(actionsFor(schemaType).map((item) => item.action)).toEqual([
					'discardChanges',
				])
			}
			for (const schemaType of ['page', 'post']) {
				const actions = actionsFor(schemaType)
				const publishers = actions.filter((item) => item.action === 'publish')
				expect(publishers.length).toBeGreaterThan(0)
				expect(publishers).not.toContain(consumerPublish)
				expect(actions.some((item) => item.action === 'schedule')).toBe(false)
				// Unrelated native/consumer actions stay available for page documents.
				expect(actions).toContain(consumerDelete)
			}
			expect(
				resolved.document.actions({
					schemaType: 'sanityKitRedirect',
					versionType: 'version',
					releaseId: 'release',
				}),
			).toEqual([])
			expect(
				resolved.templates
					.filter((template) => template.schemaType === 'sanityKitRedirect')
					.map((template) => template.id),
			).toEqual([REDIRECT_MANUAL_TEMPLATE])
			expect(
				resolved.templates.find(
					(template) => template.id === `${COLLECTION_ROUTE_TYPE}-articles`,
				)?.value,
			).toEqual({
				collection: 'articles',
				displayName: 'Articles',
				prefix: { _type: 'slug', current: '/articles' },
			})
			const globalChoices = resolved.document.resolveNewDocumentOptions({
				type: 'global',
			})
			expect(
				globalChoices.some(
					(choice) => choice.templateId === REDIRECT_MANUAL_TEMPLATE,
				),
			).toBe(true)
			expect(
				globalChoices.some(
					(choice) => choice.schemaType === COLLECTION_ROUTE_TYPE,
				),
			).toBe(false)
		},
	)

	it('makes release drafts readonly without locking ordinary drafts', () => {
		const readOnly = createRedirectSchema({ editableDrafts: true }).readOnly
		if (typeof readOnly !== 'function')
			throw new Error('Expected conditional readOnly')
		expect(readOnly({ document: row } as Parameters<typeof readOnly>[0])).toBe(
			false,
		)
		expect(
			readOnly({
				document: { ...row, _id: 'versions.release.rule' },
			} as Parameters<typeof readOnly>[0]),
		).toBe(true)
	})
	it.each(['/health', '/account', '/account/profile'])(
		'rejects reserved sources but allows their destinations: %s',
		(path) => {
			const policy = {
				reservedPaths: ['/health'],
				reservedPathPrefixes: ['/account'],
			}
			expect(validateRedirectPath(path, 'source', policy)).not.toBe(true)
			expect(validateRedirectPath(path, 'destination', policy)).toBe(true)
		},
	)
	it('uses real Sanity validation for safe paths, status, enabled and self redirects', async () => {
		expect(await validate(row)).toEqual([])
		for (const change of [
			{ source: 'https://outside.example' },
			{ destination: '/new//' },
			{ status: 307 },
			{ enabled: undefined },
			{ destination: '/old' },
		]) {
			const errors = await validate({ ...row, ...change })
			expect(errors.some((error) => error.level === 'error')).toBe(true)
		}
	})
	it('shows draft/live distinction while retaining the native form', async () => {
		Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
		const host = document.createElement('div')
		const root = createRoot(host)
		// Sanity UI is supplied by the Studio in production. Its primitives also
		// render without replacing the native form in this narrow component check.
		await act(async () => {
			await Promise.resolve()
			root.render(
				<ThemeProvider theme={buildTheme()}>
					<RedirectDraftInput
						{...({
							value: row,
							renderDefault: () => <input aria-label="Native source" />,
						} as unknown as ObjectInputProps)}
					/>
				</ThemeProvider>,
			)
		})
		expect(host.textContent).toContain('Any published version stays active')
		expect(host.querySelector('input')).not.toBeNull()
		await act(async () => {
			root.unmount()
			await Promise.resolve()
		})
	})
	it('keeps edited drafts and prepared retirements out of runtime published redirects', async () => {
		const dataset = [
			{ ...row, _id: 'rule' },
			{ ...row, destination: '/pending', enabled: false },
		]
		const client = {
			withConfig: () => ({
				fetch: async (query: string, params: Record<string, unknown>) =>
					(
						await evaluate(parse(query), { dataset, params })
					).get() as Promise<unknown>,
			}),
		}
		const result = await loadRedirectSnapshot(client, {
			destinations: 'unverified',
		})
		expect(result.ok && result.value.match('/old')).toEqual({
			kind: 'redirect',
			location: '/new',
			status: 301,
		})
	})
})

it('guarded management wraps every publish action and keeps unsafe live actions unavailable', async () => {
	const consumerPublish = action('publish'),
		nativePublish = action('publish')
	const resolved = await source(
		withUrlPublication(
			{
				...workspace(),
				document: {
					actions: [
						consumerPublish,
						action('delete'),
						action('unpublish'),
						action('schedule'),
					],
				},
			},
			{ routes, redirectManagement: 'publish' },
		),
	)
	const actions = resolved.document.actions({
		schemaType: 'sanityKitRedirect',
		versionType: 'draft',
		releaseId: undefined,
	})
	expect(actions.some((item) => item.action === 'publish')).toBe(true)
	expect(
		actions.every(
			(item) => item.action === 'publish' || item.action === 'discardChanges',
		),
	).toBe(true)
	expect(actions).not.toContain(consumerPublish)
	expect(actions).not.toContain(nativePublish)
	expect(
		resolved.document.actions({
			schemaType: 'sanityKitRedirect',
			versionType: 'version',
			releaseId: 'release',
		}),
	).toEqual([])
})
