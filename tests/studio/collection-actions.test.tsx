// @vitest-environment jsdom
import { act, forwardRef, memo, type ComponentType } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ThemeProvider } from '@sanity/ui'
import { buildTheme } from '@sanity/ui/theme'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	createPagesRuntime,
	type PagesRuntime,
	type PagesToolOptions,
} from '../../src/studio/pages/runtime.js'
import {
	CollectionSettingsContext,
	collectionSettingsTarget,
	collectionDisplayTitle,
} from '../../src/studio/collections/settings-context.js'
import type { CollectionRoutingConfig } from '../../src/url/settings/resolve.js'
import {
	CollectionActions,
	CollectionCreateButton,
} from '../../src/studio/pages/collection-actions.js'
import { PageCreationContent } from '../../src/studio/pages/page-create-dialog.js'

const native = vi.hoisted(() => ({
	runtime: undefined as unknown as PagesRuntime,
	showCollectionCreate: vi.fn(),
	setPickerOpen: vi.fn(),
	intent: vi.fn(),
	navigate: vi.fn(),
	denied: [] as string[],
	loading: false,
	permissionError: false,
}))
vi.mock('../../src/studio/pages/browser-context.js', () => ({
	useBrowserState: () => native,
}))
vi.mock('sanity/presentation', () => ({
	usePresentationParams: () => ({
		preview: '/about?preview=true',
		viewport: 'mobile',
		perspective: 'drafts',
		id: 'footer',
		type: 'shared',
		path: 'title',
		parentRefPath: 'shared',
	}),
}))
vi.mock('sanity/router', () => ({
	useRouter: () => ({
		navigateIntent: native.intent,
		navigate: native.navigate,
	}),
}))
vi.mock('sanity', () => {
	const templates = [
		{ id: 'post', schemaType: 'post', title: 'Post' },
		{ id: 'postWithIntro', schemaType: 'post', title: 'Post with intro' },
	]
	const schema = { get: () => ({ type: { name: 'document' }, title: 'Post' }) }
	return {
		useSchema: () => schema,
		useTemplates: () => templates,
		usePerspective: () => ({ selectedVariantNames: [] }),
		useTemplatePermissions: ({
			templateItems,
		}: {
			templateItems: { id: string; schemaType: string; templateId: string }[]
		}) => {
			if (native.permissionError) throw new Error('Grant read failed')
			return [
				templateItems.map((item) => ({
					...item,
					granted: !native.denied.includes(item.templateId),
					resolvedInitialValue: { _type: item.schemaType },
				})),
				native.loading,
			]
		},
	}
})
const routes = {
	pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
	collections: [
		{
			name: 'journal',
			title: 'Journal',
			itemsTitle: 'Posts',
			routePrefix: '/journal',
			index: { schemaType: 'page', pathname: '/journal' },
			items: [{ schemaType: 'post', slugField: 'slug.current' }],
		},
	],
} as const
const settings: CollectionRoutingConfig = {
	...routes,
	collections: [
		{
			...routes.collections[0],
			settingsDocumentId: 'journal-settings',
		},
	],
}
const options: PagesToolOptions = {
	...routes,
	previewUrl: 'http://localhost:3334',
	collectionUi: {
		journal: {
			itemTitle: 'post',
			create: [
				{ schemaType: 'post', templateId: 'post' },
				{ schemaType: 'post', templateId: 'postWithIntro' },
			],
		},
	},
}
const theme = buildTheme()

describe('collection UI configuration and settings binding', () => {
	it('keeps UI icons and choices out of the pure routing snapshot', () => {
		const icon = () => null
		const runtime = createPagesRuntime({
			...options,
			collectionUi: {
				journal: { icon, create: { schemaType: 'post', templateId: 'post' } },
			},
		})
		expect(runtime.collectionUi.journal?.itemTitle).toBe('item')
		expect(runtime.collectionUi.journal?.icon).toBe(icon)
		expect(runtime.routes).not.toHaveProperty('collectionUi')
		expect(runtime.registry.collections[0]).not.toHaveProperty('icon')
		expect(runtime.collectionUi.constructor).toBeUndefined()
		expect(Reflect.get(runtime.collectionUi, 'toString')).toBeUndefined()
	})
	it('accepts native memo and forwardRef icons', () => {
		for (const icon of [
			memo(() => null),
			forwardRef<SVGSVGElement>((_, ref) => <svg ref={ref} />),
		])
			expect(() =>
				createPagesRuntime({ ...options, collectionUi: { journal: { icon } } }),
			).not.toThrow()
	})
	it.each([
		{},
		{ $$typeof: Symbol.for('react.element') },
		{ $$typeof: Symbol('invalid') },
		'folder',
	])('rejects invalid icons %#', (icon) =>
		expect(() =>
			createPagesRuntime({
				...options,
				collectionUi: { journal: { icon: icon as ComponentType } },
			}),
		).toThrow('React component'),
	)
	it('rejects item choices outside the named collection and unknown names', () => {
		expect(() =>
			createPagesRuntime({
				...options,
				collectionUi: {
					journal: { create: { schemaType: 'page', templateId: 'page' } },
				},
			}),
		).toThrow('registered schemaType')
		expect(() =>
			createPagesRuntime({ ...options, collectionUi: { missing: {} } }),
		).toThrow('unregistered collection')
	})
	it('uses saved names only for matching bindings and always honors a locked name', () => {
		const collection = routes.collections[0]
		expect(
			collectionDisplayTitle(collection, settings, { journal: 'Insights' }),
		).toBe('Insights')
		expect(
			collectionDisplayTitle(
				{
					...collection,
					items: [
						{ schemaType: 'legacyPost', pathnameField: 'pathname.current' },
					],
				},
				settings,
				{ journal: 'Insights' },
			),
		).toBe('Journal')
		expect(
			collectionDisplayTitle(collection, undefined, { journal: 'Insights' }),
		).toBe('Journal')
		const locked: CollectionRoutingConfig = {
			...settings,
			collections: [
				{
					...settings.collections![0]!,
					displayName: { mode: 'locked', value: 'News' },
					settingsDocumentId: 'journal-settings',
					routePrefix: {
						mode: 'locked',
						value: '/journal',
					},
				},
			],
		}
		expect(
			collectionDisplayTitle(collection, locked, { journal: 'Stale name' }),
		).toBe('News')
		expect(collectionSettingsTarget(collection, locked)?.documentId).toBe(
			'journal-settings',
		)
	})

	it('binds only matching slug collection registrations, never by name alone', () => {
		expect(collectionSettingsTarget(routes.collections[0], settings)).toEqual({
			documentId: 'journal-settings',
			schemaType: 'sanityKitCollectionRoute',
			templateId: 'sanityKitCollectionRoute-journal',
		})
		expect(
			collectionSettingsTarget(
				{
					...routes.collections[0],
					items: [{ schemaType: 'post', pathnameField: 'pathname.current' }],
				},
				settings,
			),
		).toBeUndefined()
		expect(
			collectionSettingsTarget(routes.collections[0], routes),
		).toBeUndefined()
		expect(
			collectionSettingsTarget(
				{
					...routes.collections[0],
					items: [{ schemaType: 'other', slugField: 'slug.current' }],
				},
				settings,
			),
		).toBeUndefined()
	})
})

describe('native collection actions', () => {
	let root: Root, host: HTMLDivElement
	beforeEach(() => {
		vi.clearAllMocks()
		native.denied = []
		native.loading = false
		native.permissionError = false
		native.runtime = createPagesRuntime(options)
		Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
		vi.stubGlobal('matchMedia', () => ({
			matches: false,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		}))
		vi.stubGlobal(
			'ResizeObserver',
			class {
				observe() {}
				unobserve() {}
				disconnect() {}
			},
		)
		vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
			x: 20,
			y: 20,
			top: 20,
			left: 20,
			right: 220,
			bottom: 60,
			width: 200,
			height: 40,
			toJSON: () => ({}),
		})
		vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(
			1024,
		)
		vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(
			768,
		)
		host = document.createElement('div')
		document.body.append(host)
		root = createRoot(host)
	})
	afterEach(() => {
		act(() => root.unmount())
		host.remove()
		vi.restoreAllMocks()
		vi.unstubAllGlobals()
	})
	async function render(
		registered: CollectionRoutingConfig | undefined = settings,
	) {
		await act(async () => {
			root.render(
				<ThemeProvider theme={theme}>
					<CollectionSettingsContext.Provider value={registered}>
						<CollectionActions name="journal" />
						<CollectionCreateButton name="journal" />
					</CollectionSettingsContext.Provider>
				</ThemeProvider>,
			)
			await Promise.resolve()
		})
	}
	async function click(element: Element | null) {
		expect(element).not.toBeNull()
		await act(async () => {
			;(element as HTMLElement).click()
			await new Promise((resolve) => setTimeout(resolve, 20))
		})
	}
	function textElement(text: string) {
		return [
			...host.querySelectorAll<HTMLElement>('[role="menuitem"],button,a'),
		].find((element) => element.textContent === text)
	}
	it('opens settings in the same editor with its initial template and unchanged preview', async () => {
		await render()
		await click(
			host.querySelector('[aria-label="Collection options: Journal"]'),
		)
		expect(textElement('Settings')?.tagName).toBe('BUTTON')
		await click(textElement('Settings') ?? null)
		expect(native.navigate).toHaveBeenCalledWith({
			id: 'journal-settings',
			type: 'sanityKitCollectionRoute',
			_searchParams: [
				['preview', '/about?preview=true'],
				['viewport', 'mobile'],
				['perspective', 'drafts'],
				['template', 'sanityKitCollectionRoute-journal'],
			],
		})
		expect(native.setPickerOpen).toHaveBeenCalledWith(false)
		expect(native.intent).not.toHaveBeenCalled()
		expect(host.textContent).not.toContain('Remove folder')
		expect(host.textContent).not.toContain('Rename folder')
	})
	it('hides Settings for fixed prefixes and exposes an accessible collection menu', async () => {
		await render(routes)
		await click(
			host.querySelector('[aria-label="Collection options: Journal"]'),
		)
		expect(textElement('Settings')).toBeUndefined()
		expect(textElement('Create post')?.getAttribute('aria-haspopup')).toBe(
			'menu',
		)
	})
	it('uses a direct action when only one template is permitted', async () => {
		native.denied = ['postWithIntro']
		await render()
		await click(
			host.querySelector('[aria-label="Collection options: Journal"]'),
		)
		const item = textElement('Create post')
		expect(item?.getAttribute('aria-haspopup')).not.toBe('menu')
		await click(item ?? null)
		expect(native.showCollectionCreate).toHaveBeenCalledWith(
			expect.any(HTMLButtonElement),
			'journal',
		)
	})
	it('uses the same collection choices from the browse header +', async () => {
		await render()
		await click(host.querySelector('[aria-label="Create post"]'))
		expect(native.showCollectionCreate).toHaveBeenCalledWith(
			expect.any(HTMLButtonElement),
			'journal',
		)
	})
	it('keyboard opening a multi-template submenu does not create a document', async () => {
		await render()
		await click(
			host.querySelector('[aria-label="Collection options: Journal"]'),
		)
		const item = textElement('Create post')!
		await act(async () => {
			item.focus()
			item.dispatchEvent(
				new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
			)
			await new Promise((resolve) => setTimeout(resolve, 20))
		})
		expect(host.textContent).toContain('Post with intro')
		expect(native.intent).not.toHaveBeenCalled()
		expect(native.showCollectionCreate).not.toHaveBeenCalled()
	})
	it('creates a collection draft through native intent without folder URL parameters', async () => {
		const runtime = {
			...native.runtime,
			createChoices: native.runtime.collectionUi.journal!.createChoices,
		}
		await act(async () => {
			root.render(
				<ThemeProvider theme={theme}>
					<PageCreationContent
						runtime={runtime}
						autoOpenSingle={true}
						onCreated={() => {}}
					/>
				</ThemeProvider>,
			)
			await Promise.resolve()
		})
		await click(textElement('Post with intro') ?? null)
		expect(native.intent).toHaveBeenCalledWith('create', {
			type: 'post',
			template: 'postWithIntro',
			presentation: 'pages',
		})
	})
	it('keeps grant-check failures local with a retry notice', async () => {
		native.permissionError = true
		const runtime = {
			...native.runtime,
			createChoices: native.runtime.collectionUi.journal!.createChoices,
		}
		await act(async () => {
			root.render(
				<ThemeProvider theme={theme}>
					<PageCreationContent
						runtime={runtime}
						autoOpenSingle={true}
						onCreated={() => {}}
					/>
				</ThemeProvider>,
			)
			await Promise.resolve()
		})
		expect(host.textContent).toContain('Page creation could not be checked')
		expect(textElement('Retry')).toBeDefined()
		expect(native.intent).not.toHaveBeenCalled()
	})
})
