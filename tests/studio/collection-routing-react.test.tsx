// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/require-await -- act flushes React effects. */
import { act, useEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isObservable, of } from 'rxjs'
import type { InputProps } from 'sanity'
import type { DocumentLocationsState } from 'sanity/presentation'
import {
	CollectionRoutingProvider,
	useCollectionRouting,
} from '../../src/studio/collections/use-routing.js'
import { createCollectionLocationBridge } from '../../src/studio/collections/location-resolver.js'
import type { CollectionRoutingConfig } from '../../src/url/settings/resolve.js'

const native = vi.hoisted(() => ({
	client: {
		withConfig: vi.fn(),
		config: vi.fn(),
		fetch: vi.fn(),
		listen: vi.fn(),
		request: vi.fn(),
	},
	documentStore: { listenQuery: vi.fn() },
}))
vi.mock('sanity', () => ({
	useClient: () => native.client,
	useDocumentStore: () => native.documentStore,
	useDocumentPreviewStore: () => native.documentStore,
	isDocumentSchemaType: () => true,
}))
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
const setting = (id: string, prefix: string) => ({
	_id: id,
	_type: 'sanityKitCollectionRoute',
	_rev: prefix,
	collection: 'journal',
	prefix: { _type: 'slug', current: prefix },
})
let records = [
	setting('journal-settings', '/journal'),
	setting('drafts.journal-settings', '/blog'),
]
let host: HTMLDivElement
let root: Root
let observers: Array<{
	next: (event: { type: string }) => void
	error: () => void
}>
let unsubscribe: ReturnType<typeof vi.fn>
function Read({ stack = ['drafts'] }: { stack?: string[] }) {
	const state = useCollectionRouting(config, stack)
	return (
		<output>
			{state.snapshot.status === 'ready'
				? state.snapshot.value.routes.collections?.[0]?.routePrefix
				: state.snapshot.status}
		</output>
	)
}
beforeEach(() => {
	;(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true
	vi.clearAllMocks()
	observers = []
	unsubscribe = vi.fn()
	records = [
		setting('journal-settings', '/journal'),
		setting('drafts.journal-settings', '/blog'),
	]
	native.client.withConfig.mockReturnValue(native.client)
	native.client.config.mockReturnValue({ projectId: 'abc123', dataset: 'test' })
	native.client.request.mockResolvedValue([
		{ filter: 'true', permissions: ['read'] },
	])
	native.client.fetch.mockImplementation(
		(_query: string, params: { ids: string[] }) =>
			Promise.resolve(
				records.filter((record) => params.ids.includes(record._id)),
			),
	)
	native.client.listen.mockImplementation(() => ({
		subscribe: (observer: (typeof observers)[number]) => {
			observers.push(observer)
			return { unsubscribe }
		},
	}))
	native.documentStore.listenQuery.mockReturnValue(
		of({ title: 'Story', pathname: 'story' }),
	)
	host = document.createElement('div')
	document.body.append(host)
	root = createRoot(host)
})
afterEach(async () => {
	await act(async () => root.unmount())
	host.remove()
})

describe('shared collection routing React integration', () => {
	it('shares one same-perspective subscription within a provider and stops it on unmount', async () => {
		await act(async () =>
			root.render(
				<CollectionRoutingProvider configuration={config}>
					<Read />
					<Read />
				</CollectionRoutingProvider>,
			),
		)
		expect(host.textContent).toBe('/blog/blog')
		expect(native.client.listen).toHaveBeenCalledTimes(1)
		await act(async () => root.unmount())
		expect(unsubscribe).toHaveBeenCalledTimes(1)
		root = createRoot(host)
	})
	it('works standalone and switches between separate published and draft URLs', async () => {
		await act(async () => root.render(<Read />))
		expect(host.textContent).toBe('/blog')
		await act(async () => root.render(<Read stack={['published']} />))
		expect(host.textContent).toBe('/journal')
	})
	it('does not use configured defaults when settings are missing or draft access is unknown', async () => {
		records = []
		await act(async () => root.render(<Read />))
		expect(host.textContent).toBe('unavailable')
		native.client.request.mockResolvedValue([])
		await act(async () => observers.at(-1)!.next({ type: 'mutation' }))
		expect(host.textContent).toBe('unavailable')
	})
	it('keeps fixed hooks optional without creating a store', async () => {
		function Fixed() {
			return (
				<output>
					{useCollectionRouting(undefined) === undefined
						? 'fixed'
						: 'unexpected'}
				</output>
			)
		}
		await act(async () => root.render(<Fixed />))
		expect(host.textContent).toBe('fixed')
		expect(native.client.listen).not.toHaveBeenCalled()
	})
})

describe('native document location middleware', () => {
	it('does not report missing URLs for settings or other unregistered documents', () => {
		const bridge = createCollectionLocationBridge(config)
		for (const type of [
			'sanityKitCollectionRoute',
			'sanityKitRedirect',
			'footer',
		]) {
			expect(
				bridge.locations(
					{
						id: 'document',
						type,
						version: undefined,
						perspectiveStack: ['drafts'],
					},
					{ documentStore: native.documentStore as never },
				),
			).toBeNull()
		}
		expect(native.client.listen).not.toHaveBeenCalled()
		const custom = {
			locations: [{ title: 'Custom location', href: '/custom' }],
		}
		const overridden = createCollectionLocationBridge(config, {
			footer: custom,
		})
		expect(
			overridden.locations(
				{
					id: 'footer',
					type: 'footer',
					version: undefined,
					perspectiveStack: ['drafts'],
				},
				{ documentStore: native.documentStore as never },
			),
		).toBe(custom)
	})
	it('updates native location links without remounting the document input and clears them when disconnected', async () => {
		const bridge = createCollectionLocationBridge(config)
		let mounts = 0
		function NativeInput() {
			const [state, setState] = useState<DocumentLocationsState>()
			useEffect(() => {
				mounts++
				const result = bridge.locations(
					{
						id: 'story',
						type: 'post',
						version: undefined,
						perspectiveStack: ['drafts'],
					},
					{ documentStore: native.documentStore as never },
				)
				if (!isObservable(result))
					throw new Error('Expected native Observable resolver')
				const subscription = result.subscribe((value) =>
					setState(value ?? undefined),
				)
				return () => subscription.unsubscribe()
			}, [])
			return (
				<output>
					{state?.locations?.[0]?.href ?? state?.message ?? 'waiting'}
				</output>
			)
		}
		const Input = bridge.wrap(NativeInput)
		const props = {
			value: { _id: 'drafts.story' },
			schemaType: { name: 'post' },
		} as unknown as InputProps
		await act(async () =>
			root.render(
				<CollectionRoutingProvider configuration={config}>
					<Input {...props} />
				</CollectionRoutingProvider>,
			),
		)
		expect(host.textContent).toBe('/blog/story')
		// Native schema wrappers can change identity without replacing the document.
		await act(async () =>
			root.render(
				<CollectionRoutingProvider configuration={config}>
					<Input
						{...({
							...props,
							schemaType: { ...props.schemaType },
						} as InputProps)}
					/>
				</CollectionRoutingProvider>,
			),
		)
		expect(host.textContent).toBe('/blog/story')
		records[1] = setting('drafts.journal-settings', '/news')
		await act(async () => observers.at(-1)!.next({ type: 'mutation' }))
		expect(host.textContent).toBe('/news/story')
		expect(mounts).toBe(1)
		await act(async () => observers.at(-1)!.error())
		expect(host.textContent).toContain('Collection URLs are unavailable')
		expect(host.textContent).not.toContain('/news')
	})
})
