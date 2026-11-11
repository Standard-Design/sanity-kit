// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/require-await -- act flushes React effects. */
import { act, useEffect, type ComponentProps, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Tool } from 'sanity'
import type { PresentationPluginOptions } from 'sanity/presentation'
import { CollectionPagesTool } from '../../src/studio/pages/routing-tool.js'
import { createPagesRuntime } from '../../src/studio/pages/runtime.js'
import type { CollectionRoutingSnapshot } from '../../src/studio/collections/routing-session.js'
import {
	createCollectionRouting,
	type CollectionRoutingConfig,
} from '../../src/url/settings/resolve.js'

const native: {
	snapshot: CollectionRoutingSnapshot
	stack: string[]
	variants: string[]
	search: [string, string][]
	id?: string | undefined
	type?: string | undefined
	mounts: number
	prefix: string
	ready: boolean
} = vi.hoisted(() => ({
	snapshot: {
		status: 'loading',
		perspective: 'drafts',
	},
	stack: ['drafts'],
	variants: [] as string[],
	search: [] as [string, string][],
	mounts: 0,
	prefix: '',
	ready: false,
}))
vi.mock('sanity', () => ({
	usePerspective: () => ({
		perspectiveStack: native.stack,
		selectedVariantNames: native.variants,
	}),
	useSchema: () => ({
		get: () => ({
			type: { name: 'document' },
			jsonType: 'object',
			fields: [
				{ name: 'title', type: { jsonType: 'string' } },
				...['slug', 'pathname'].map((name) => ({
					name,
					type: {
						jsonType: 'object',
						fields: [{ name: 'current', type: { jsonType: 'string' } }],
					},
				})),
			],
		}),
	}),
}))
vi.mock('sanity/router', () => ({
	useRouter: () => ({
		state: { id: native.id, type: native.type, _searchParams: native.search },
	}),
}))
vi.mock('sanity/presentation', () => ({ usePresentationParams: () => ({}) }))
vi.mock('../../src/studio/collections/use-routing.js', () => ({
	useCollectionRouting: () => ({
		snapshot: native.snapshot,
		retry: () => {},
		settingsDocuments: [],
	}),
}))
vi.mock('../../src/studio/collections/settings-context.js', async () => {
	const { createContext } = await import('react')
	return { CollectionSettingsContext: createContext(undefined) }
})
vi.mock('../../src/studio/pages/browser-state.js', () => ({
	BrowserStateProvider: ({
		children,
		runtime,
		routingReady,
	}: {
		children: ReactNode
		runtime: ReturnType<typeof createPagesRuntime>
		routingReady: boolean
	}) => {
		native.ready = routingReady
		native.prefix = runtime.registry.collections[0]!.routePrefix
		return children
	},
}))
vi.mock('../../src/studio/pages/browser.js', () => ({
	PagesBrowser: () => null,
}))
vi.mock('../../src/studio/pages/header.js', () => ({ PagesHeader: () => null }))
const config: CollectionRoutingConfig = {
	pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
	collections: [
		{
			name: 'journal',
			title: 'Journal',
			settingsDocumentId: 'journal-settings',
			index: { schemaType: 'page', pathname: '/journal' },
			items: [{ schemaType: 'post', slugField: 'slug.current' }],
		},
	],
}
const options = {
	previewUrl: 'http://localhost:3334',
	pages: config.pages,
	collections: [
		{
			...config.collections![0]!,
			title: 'Journal',
			routePrefix: '/registered-only',
		},
	],
	collectionRouting: config,
}
const registration = createPagesRuntime(options)
function ready(prefix: string): CollectionRoutingSnapshot {
	const result = createCollectionRouting(config).resolve(
		{
			status: 'available',
			perspective: 'raw',
			coverage: 'published-and-drafts',
			complete: true,
			documents: [
				{
					_id: 'journal-settings',
					_rev: prefix,
					_type: 'sanityKitCollectionRoute',
					collection: 'journal',
					prefix: { _type: 'slug', current: prefix },
				},
			],
		},
		'drafts',
	)
	if (!result.ok) throw new Error(result.reason)
	return { status: 'ready', perspective: 'drafts', value: result.value }
}
let host: HTMLDivElement
let root: Root
let resolve: PresentationPluginOptions['resolve']
function NativeTool(props: ComponentProps<Tool['component']>) {
	useEffect(() => {
		native.mounts++
	}, [])
	resolve = (props.tool.options as PresentationPluginOptions).resolve
	return <output>Native editor</output>
}
const tool = {
	name: 'pages',
	title: 'Pages',
	component: NativeTool,
	options: {},
} as Tool
async function render() {
	await act(async () =>
		root.render(
			<CollectionPagesTool
				tool={tool}
				NativeTool={NativeTool}
				options={options}
				registration={registration}
			/>,
		),
	)
}
beforeEach(() => {
	;(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true
	native.mounts = 0
	native.id = undefined
	native.type = undefined
	native.search = []
	native.snapshot = { status: 'loading', perspective: 'drafts' }
	host = document.createElement('div')
	document.body.append(host)
	root = createRoot(host)
})
afterEach(async () => {
	await act(async () => root.unmount())
	host.remove()
})
it('keeps the editor mounted and removes native lookup while routing refreshes', async () => {
	await render()
	expect(native.ready).toBe(false)
	expect(resolve?.mainDocuments).toEqual([])
	native.snapshot = ready('/blog')
	await render()
	expect(native.ready).toBe(true)
	expect(native.prefix).toBe('/blog')
	const old = resolve?.mainDocuments
	expect(old).toHaveLength(1)
	native.snapshot = { status: 'loading', perspective: 'drafts' }
	await render()
	expect(native.ready).toBe(false)
	expect(resolve?.mainDocuments).toEqual([])
	native.snapshot = ready('/news')
	await render()
	expect(native.prefix).toBe('/news')
	expect(resolve?.mainDocuments).not.toBe(old)
	expect(native.mounts).toBe(1)
	expect(host.textContent).toBe('Native editor')
})

it('keeps settings selected through prefix refreshes without freezing live routes', async () => {
	native.id = 'journal-settings'
	native.type = 'sanityKitCollectionRoute'
	native.search = [['preview', 'http://localhost:3334/journal/post']]
	native.snapshot = ready('/journal')
	await render()
	expect(resolve?.mainDocuments).toEqual([])
	const suspended = resolve?.mainDocuments
	native.snapshot = { status: 'loading', perspective: 'drafts' }
	await render()
	expect(resolve?.mainDocuments).toBe(suspended)
	native.snapshot = {
		status: 'unavailable',
		perspective: 'drafts',
		reason: 'settings-invalid',
	}
	await render()
	expect(resolve?.mainDocuments).toBe(suspended)
	native.snapshot = ready('/news')
	await render()
	expect(native.prefix).toBe('/news')
	expect(resolve?.mainDocuments).toEqual([])
	expect(resolve?.locations).toBeDefined()
	// Refresh/perspective search parameters are not a choice of another page.
	native.search = [
		[
			'preview',
			'http://localhost:3334/journal/post?sanity-preview-perspective=published',
		],
	]
	await render()
	expect(resolve?.mainDocuments).toEqual([])
	expect(native.mounts).toBe(1)
	// A real preview navigation restores native page-to-editor navigation.
	native.search = [['preview', 'http://localhost:3334/news/post']]
	await render()
	expect(resolve?.mainDocuments).toHaveLength(1)
	// Do not re-pin during an in-flight native lookup or a quick Back action.
	native.search = [['preview', 'http://localhost:3334/journal/post']]
	await render()
	expect(resolve?.mainDocuments).toHaveLength(1)
})

it('adopts the initial preview URL without dismissing an already selected settings document', async () => {
	native.id = 'journal-settings'
	native.type = 'sanityKitCollectionRoute'
	native.snapshot = ready('/news')
	await render()
	expect(resolve?.mainDocuments).toEqual([])
	native.search = [['preview', '/news/post']]
	await render()
	expect(resolve?.mainDocuments).toEqual([])
	native.search = []
	await render()
	expect(resolve?.mainDocuments).toEqual([])
	native.search = [['preview', '/about']]
	await render()
	expect(resolve?.mainDocuments).toHaveLength(1)
})

it('restores native lookup on explicit document selection and protects settings on reentry', async () => {
	native.id = 'journal-settings'
	native.type = 'sanityKitCollectionRoute'
	native.snapshot = ready('/news')
	await render()
	expect(resolve?.mainDocuments).toEqual([])
	native.id = 'post-one'
	native.type = 'post'
	await render()
	expect(resolve?.mainDocuments).toHaveLength(1)
	native.id = 'journal-settings'
	native.type = 'sanityKitCollectionRoute'
	native.search = [['preview', '/news/post']]
	await render()
	expect(resolve?.mainDocuments).toEqual([])
	// An unrelated document of the same schema type is not a registered setting.
	native.id = 'unregistered-settings'
	await render()
	expect(resolve?.mainDocuments).toHaveLength(1)
	expect(native.mounts).toBe(1)
})
