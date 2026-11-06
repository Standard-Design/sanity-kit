// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type {
	ConfigContext,
	DocumentActionComponent,
	DocumentActionsContext,
	DocumentActionProps,
	SingleWorkspace,
	LayoutProps,
	SlugInputProps,
} from 'sanity'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '@sanity/client'
import { createSourceFromConfig, createMockAuthStore } from 'sanity'
import { structureTool } from 'sanity/structure'
import type { PagesRouteConfig } from '../../src/url/registry.js'
import { defineSanityUrlField } from '../../src/studio/url/field.js'
import {
	urlPublication,
	withUrlPublication,
} from '../../src/studio/url/publication-plugin.js'
import { createUrlPublishAction } from '../../src/studio/url/publication-action.js'

const workspaceMock = vi.hoisted(() => ({ actions: vi.fn() }))
vi.mock('sanity', async (importOriginal) => ({
	...(await importOriginal<typeof import('sanity')>()),
	useWorkspace: () => ({ document: { actions: workspaceMock.actions } }),
}))
const layoutPlugins = new Set<ReturnType<typeof urlPublication>>()

// This suite renders only the publication pairing, outside a document form.
// Native create-intent decoding and document identity have their own tests.
vi.mock('../../src/studio/url/creation-presentation.js', () => ({
	useUrlCreationContext: () => undefined,
}))
vi.mock('../../src/studio/url/input.js', () => ({
	SanityUrlInput: ({
		allowPublishedDrafts,
	}: {
		allowPublishedDrafts: boolean
	}) => <output>{allowPublishedDrafts ? 'enabled' : 'disabled'}</output>,
}))
vi.mock('../../src/studio/url/publication-action.js', () => ({
	createUrlPublishAction: vi.fn(() => {
		const action: DocumentActionComponent = () => ({ label: 'URL Publish' })
		action.action = 'publish'
		return action
	}),
}))

const routes: PagesRouteConfig = {
	pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
	collections: [
		{
			name: 'journal',
			title: 'Journal',
			routePrefix: '/journal',
			index: { schemaType: 'page', pathname: '/journal' },
			items: [{ schemaType: 'post', slugField: 'slug.current' }],
		},
	],
}
function action(name: NonNullable<DocumentActionComponent['action']>) {
	const result: DocumentActionComponent = () => ({ label: name ?? 'Custom' })
	result.action = name
	return result
}
function withLayout(
	plugin: ReturnType<typeof urlPublication>,
	child: ReactNode,
) {
	layoutPlugins.add(plugin)
	workspaceMock.actions.mockImplementation(
		(context: DocumentActionsContext) => {
			let resolved = [action('publish'), action('schedule')]
			for (const installed of layoutPlugins)
				resolved = reduceActions(installed)(resolved, context.schemaType)
			return resolved
		},
	)
	const Layout = plugin.studio?.components?.layout
	if (!Layout) throw new Error('Expected publication layout')
	return <Layout {...({ renderDefault: () => child } as LayoutProps)} />
}
function input(config: PagesRouteConfig) {
	const Input = defineSanityUrlField({ name: 'pathname', routes: config })
		.components?.input
	if (!Input) throw new Error('Expected URL input')
	return <Input {...({} as SlugInputProps)} />
}
function reduceActions(plugin: ReturnType<typeof urlPublication>) {
	const reducer = plugin.document?.actions
	if (typeof reducer !== 'function') throw new Error('Expected action reducer')
	return (previous: DocumentActionComponent[], schemaType: string) =>
		reducer(previous, { schemaType } as DocumentActionsContext)
}

describe('URL publication plugin and field pairing', () => {
	let root: Root
	let host: HTMLDivElement
	beforeEach(() => {
		vi.clearAllMocks()
		layoutPlugins.clear()
		Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
		host = document.createElement('div')
		document.body.append(host)
		root = createRoot(host)
	})
	afterEach(async () => {
		await act(async () => {
			root.unmount()
			await Promise.resolve()
		})
		host.remove()
	})
	async function show(element: ReactNode) {
		await act(async () => {
			root.render(element)
			await Promise.resolve()
		})
	}

	it('enables published-draft editing only inside the matching plugin layout', async () => {
		const field = input(routes)
		await show(field)
		expect(host.textContent).toBe('disabled')
		await show(withLayout(urlPublication({ routes }), field))
		expect(host.textContent).toBe('enabled')
		const different = { ...routes, excludePaths: ['/reserved'] }
		await show(withLayout(urlPublication({ routes: different }), field))
		expect(host.textContent).toBe('disabled')
	})

	it('accepts a separately constructed matching route registration', async () => {
		const equivalent = structuredClone(routes)
		await show(
			withLayout(urlPublication({ routes: equivalent }), input(routes)),
		)
		expect(host.textContent).toBe('enabled')
	})

	it('normalizes equivalent route definitions rather than depending on property insertion order or omitted defaults', async () => {
		const reordered: PagesRouteConfig = {
			excludePaths: [],
			collections: [
				{
					items: [
						{
							titleField: 'title',
							slugField: 'slug.current',
							schemaType: 'post',
						},
					],
					index: { pathname: '/journal', schemaType: 'page' },
					routePrefix: '/journal',
					itemsTitle: 'Journal',
					title: 'Journal',
					name: 'journal',
				},
			],
			pages: [
				{
					titleField: 'title',
					pathnameField: 'pathname.current',
					schemaType: 'page',
				},
			],
		}
		await show(withLayout(urlPublication({ routes: reordered }), input(routes)))
		expect(host.textContent).toBe('enabled')
	})

	it('snapshots pairing and lazy action configuration before callers mutate route objects', async () => {
		const mutable = {
			pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
		}
		const reservedPaths = ['/health']
		const plugin = urlPublication({ routes: mutable, reservedPaths })
		const field = input(mutable)
		mutable.pages[0]!.pathnameField = 'other.current'
		reservedPaths.push('/later')
		await show(withLayout(plugin, field))
		expect(host.textContent).toBe('enabled')
		reduceActions(plugin)([action('publish')], 'page')
		expect(createUrlPublishAction).toHaveBeenCalledWith(
			expect.any(Function),
			{ pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }] },
			{ reservedPaths: ['/health'] },
		)
		await show(withLayout(plugin, input(mutable)))
		expect(host.textContent).toBe('disabled')
	})

	it('keeps an outer matching provider when layouts compose with another registration', async () => {
		const other = {
			pages: [{ schemaType: 'other', pathnameField: 'url.current' }],
		}
		await show(
			withLayout(
				urlPublication({ routes }),
				withLayout(urlPublication({ routes: other }), input(routes)),
			),
		)
		expect(host.textContent).toBe('enabled')
	})

	it('registers inspectable read-only redirects without create templates or mutation actions', () => {
		const plugin = urlPublication({ routes })
		const types = plugin.schema?.types
		expect(Array.isArray(types)).toBe(true)
		expect(types).toEqual([
			expect.objectContaining({
				name: 'sanityKitRedirect',
				type: 'document',
				readOnly: true,
				fields: expect.arrayContaining([
					expect.objectContaining({ name: 'source', type: 'string' }),
					expect.objectContaining({ name: 'destination', type: 'string' }),
				]) as unknown,
			}),
		])
		const templates = plugin.schema?.templates
		if (typeof templates !== 'function')
			throw new Error('Expected template reducer')
		const page = { id: 'page', title: 'Page', schemaType: 'page', value: {} }
		const redirect = {
			id: 'redirect',
			title: 'Redirect',
			schemaType: 'sanityKitRedirect',
			value: {},
		}
		expect(templates([page, redirect], {} as ConfigContext)).toEqual([page])
		expect(
			reduceActions(plugin)(
				[action('publish'), action('delete')],
				'sanityKitRedirect',
			),
		).toEqual([])
	})

	it('wraps registered publish actions with stable identity and preserves unrelated actions', () => {
		const plugin = urlPublication({ routes, reservedPaths: ['/health'] })
		const reduce = reduceActions(plugin)
		const publish = action('publish')
		const duplicate = action('duplicate')
		const schedule = action('schedule')
		const previous = [publish, duplicate, schedule]
		const first = reduce(previous, 'page')
		const second = reduce(previous, 'post')
		expect(first).toHaveLength(2)
		expect(first[0]).not.toBe(publish)
		expect(first[0]?.action).toBe('publish')
		expect(first[1]).toBe(duplicate)
		expect(second[0]).toBe(first[0])
		expect(reduce(first, 'page')[0]).toBe(first[0])
		expect(createUrlPublishAction).toHaveBeenCalledOnce()
		expect(createUrlPublishAction).toHaveBeenCalledWith(
			publish,
			expect.any(Object),
			expect.objectContaining({ reservedPaths: ['/health'] }),
		)
		expect(previous).toEqual([publish, duplicate, schedule])
	})

	it('leaves unregistered types and their scheduling behavior untouched', () => {
		const previous = [action('publish'), action('schedule'), action('delete')]
		const result = reduceActions(urlPublication({ routes }))(previous, 'author')
		expect(result).toBe(previous)
		expect(createUrlPublishAction).not.toHaveBeenCalled()
	})
	it.each(['function', 'array'] as const)(
		'wraps actual resolved Sanity actions after native plugins, built-ins, and a root %s',
		async (kind) => {
			const custom = action('duplicate')
			const prior =
				kind === 'function'
					? (previous: DocumentActionComponent[]) => [...previous, custom]
					: [custom]
			const config = withUrlPublication(
				{
					projectId: 'abcdefgh',
					dataset: 'test',
					schema: {
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
					},
					plugins: [structureTool()],
					document: { actions: prior },
				},
				{ routes },
			)
			const source = await resolveSource(config)
			const result = source.document.actions({
				schemaType: 'page',
				versionType: 'draft',
				releaseId: undefined,
			})
			expect(result.filter((item) => item.action === 'publish')).toHaveLength(1)
			expect(
				result.find((item) => item.action === 'publish')?.(
					{} as DocumentActionProps,
				)?.label,
			).toBe('URL Publish')
			expect(result.some((item) => item.action === 'schedule')).toBe(false)
			expect(result).toContain(custom)
			expect(
				source.document.actions({
					schemaType: 'sanityKitRedirect',
					versionType: 'draft',
					releaseId: undefined,
				}),
			).toEqual([])
			const plugin = config.plugins?.at(-1)
			if (!plugin?.studio?.components?.layout)
				throw new Error('Missing integration layout')
			workspaceMock.actions.mockImplementation(source.document.actions)
			const Layout = plugin.studio.components.layout
			await show(<Layout renderDefault={() => input(routes)} />)
			expect(host.textContent).toBe('enabled')
		},
	)

	it('fails closed if a later root override replaces the wrapped Publish action', async () => {
		const config = withUrlPublication(
			{
				projectId: 'abcdefgh',
				dataset: 'test',
				schema: {
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
				},
				plugins: [structureTool()],
			},
			{ routes },
		)
		const finalizer = config.document?.actions
		if (typeof finalizer !== 'function') throw new Error('Expected finalizer')
		config.document = {
			...config.document,
			actions: (previous, context) =>
				finalizer(previous, context).map((item) =>
					item.action === 'publish' ? action('publish') : item,
				),
		}
		const source = await resolveSource(config)
		workspaceMock.actions.mockImplementation(source.document.actions)
		const Layout = config.plugins?.at(-1)?.studio?.components?.layout
		if (!Layout) throw new Error('Missing integration layout')
		await expect(
			show(<Layout renderDefault={() => input(routes)} />),
		).rejects.toThrow('withUrlPublication')
	})

	it.each(['before', 'after'] as const)(
		'fails closed for plugin-only configuration %s Structure',
		async (position) => {
			const plugin = urlPublication({ routes })
			const source = await resolveSource({
				projectId: 'abcdefgh',
				dataset: 'test',
				schema: {
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
				},
				plugins:
					position === 'before'
						? [plugin, structureTool()]
						: [structureTool(), plugin],
			})
			workspaceMock.actions.mockImplementation(source.document.actions)
			const Layout = plugin.studio?.components?.layout
			if (!Layout) throw new Error('Missing integration layout')
			await expect(
				show(<Layout renderDefault={() => input(routes)} />),
			).rejects.toThrow('withUrlPublication')
			expect(host.textContent).not.toContain('enabled')
		},
	)
})

async function resolveSource(config: SingleWorkspace) {
	// Resolve the actual Sanity configuration without contacting a project. The
	// only optional background request is the schema-upload grant check.
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
