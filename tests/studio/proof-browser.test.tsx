// @vitest-environment jsdom

import { act, useState } from 'react'
import { evaluate, parse } from 'groq-js'
import { createRoot, type Root } from 'react-dom/client'
import { ThemeProvider } from '@sanity/ui'
import { buildTheme } from '@sanity/ui/theme'
import type { PreviewHeaderProps } from 'sanity/presentation'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface TestRequest {
	url: string
	method?: string
	body?: {
		mutations: {
			patch: { insert: { items: { _key: string; pathname: string }[] } }
		}[]
	}
}

const native = vi.hoisted(() => ({
	navigate: vi.fn(),
	creationLoading: false,
	creationRelease: undefined as string | undefined,
	creationError: false,
	deniedTemplates: [] as string[],
	intent: vi.fn(),
	fetch:
		vi.fn<
			(
				query: string,
				params: Record<string, unknown>,
				options: Record<string, unknown>,
			) => Promise<unknown>
		>(),
	listen: vi.fn(),
	mutate: vi.fn(),
	request: vi.fn<(options: TestRequest) => Promise<unknown>>(),
	unsubscribe: vi.fn(),
	perspective: ['drafts'],
	observer: undefined as
		{ next(event: { type: string }): void; error(): void } | undefined,
	params: { preview: '/about', id: 'shared', type: 'kitProofShared' },
}))

vi.mock('sanity', () => {
	const client = {
		fetch: native.fetch,
		listen: native.listen,
		mutate: native.mutate,
		request: native.request,
		withConfig: () => client,
		config: () => ({ projectId: 'testproject', dataset: 'test' }),
	}
	const templates = ['kitProofPage', 'kitProofLanding'].map((name) => ({
		id: name,
		schemaType: name,
		title: name === 'kitProofPage' ? 'Page' : 'Landing page',
	}))
	templates.push({
		id: 'kitProofPageWithIntro',
		schemaType: 'kitProofPage',
		title: 'Page with intro',
	})
	const schema = {
		get: (name: string) => ({
			name,
			title: name,
			type: { name: 'document' },
			fields:
				name === 'kitProofPage'
					? [
							{
								name: 'pathname',
								type: {
									name: 'slug',
									options: { __sanityKitUrlField: true },
									fields: [{ name: 'current', type: { name: 'string' } }],
								},
							},
						]
					: [],
		}),
	}
	return {
		useTemplates: () => templates,
		useSchema: () => schema,
		useTemplatePermissions: ({
			templateItems,
		}: {
			templateItems: { id: string; templateId: string; schemaType: string }[]
		}) => {
			if (native.creationError)
				throw new Error('Permission service unavailable')
			return [
				templateItems.map((item) => ({
					...item,
					granted: !native.deniedTemplates.includes(item.templateId),
					resolvedInitialValue: { _type: item.schemaType },
				})),
				native.creationLoading,
			]
		},
		definePlugin: (factory: unknown) => factory,
		useClient: () => client,
		usePerspective: () => ({
			perspectiveStack: [...native.perspective],
			selectedReleaseId: native.creationRelease,
			selectedVariantNames: [],
		}),
		useDocumentVersions: () => ({ versions: [], loading: false }),
		isDraftVersion: () => false,
		isPublishedVersion: () => false,
		isReleaseVersion: () => false,
		DocumentVersionsStatusIndicator: () => (
			<span aria-label="Native document status" />
		),
	}
})
vi.mock('sanity/presentation', () => ({
	presentationTool: vi.fn(),
	usePresentationParams: () => native.params,
	usePresentationNavigate: () => native.navigate,
}))
vi.mock('sanity/router', () => ({
	useRouter: () => ({ navigateIntent: native.intent }),
}))

import { BrowserStateProvider } from '../fixtures/pages-studio/browser-state.js'
import { PagesBrowser as ProofBrowser } from '../../src/studio/pages/browser.js'
import { PagesHeader as ProofHeader } from '../../src/studio/pages/header.js'
import { BrowserStateProvider as ConfiguredProvider } from '../../src/studio/pages/browser-state.js'
import { createPagesRuntime } from '../../src/studio/pages/runtime.js'
import { FOLDER_SYNC_DELAY_MS } from '../../src/studio/folders/sync-controller.js'

const theme = buildTheme()

// This harness simulates the native mount boundary, not Sanity's editor or iframe.
// Real Studio acceptance is still required before promoting the adapter to src/.
function NativeShell() {
	const [navigatorEnabled, setNavigatorEnabled] = useState(true)
	const props = {
		navigatorEnabled,
		toggleNavigator: () => setNavigatorEnabled((value) => !value),
		renderDefault: (header: PreviewHeaderProps) => (
			<>
				{header.toggleNavigator && (
					<button onClick={header.toggleNavigator}>Toggle navigator</button>
				)}
				<button>Native refresh</button>
			</>
		),
	} as PreviewHeaderProps
	return (
		<>
			<ProofHeader {...props} />
			{navigatorEnabled && <ProofBrowser />}
		</>
	)
}

describe('Pages Presentation adapter lifecycle', () => {
	let container: HTMLDivElement
	let root: Root
	beforeEach(() => {
		vi.clearAllMocks()
		native.request.mockReset()
		native.creationLoading = false
		native.creationRelease = undefined
		native.creationError = false
		native.deniedTemplates = []
		native.params = { preview: '/about', id: 'shared', type: 'kitProofShared' }
		native.perspective = ['drafts']
		native.observer = undefined
		native.listen.mockImplementation(() => ({
			subscribe: (observer: typeof native.observer) => {
				native.observer = observer
				return { unsubscribe: native.unsubscribe }
			},
		}))
		// JSDOM has no layout. Give the real Popover a visible anchor and viewport
		// so Floating UI does not hide it before we exercise the real focus lock.
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
		const pages = [
			{
				_id: 'about',
				_type: 'kitProofPage',
				title: 'About',
				pathname: '/about',
			},
			{
				_id: 'team',
				_type: 'kitProofPage',
				title: 'Team',
				pathname: '/about/team',
			},
			{
				_id: 'unfinished',
				_type: 'kitProofPage',
				title: 'Unfinished',
				pathname: null,
			},
		]
		native.fetch.mockImplementation((query: string, params) =>
			Promise.resolve(
				params.registryId
					? null
					: query.includes('"total":')
						? { total: 0, documents: [] }
						: params.id
							? pages.filter(
									(page) =>
										page._id === params.id && page._type === params.type,
								)
							: params.path
								? pages.filter((page) => page.pathname === params.path)
								: pages,
			),
		)
		container = document.createElement('div')
		document.body.append(container)
		root = createRoot(container)
	})
	afterEach(() => {
		act(() => root.unmount())
		container.remove()
		vi.useRealTimers()
		vi.restoreAllMocks()
		vi.unstubAllGlobals()
	})
	async function render() {
		await act(async () => {
			root.render(
				<ThemeProvider theme={theme}>
					<BrowserStateProvider>
						<NativeShell />
					</BrowserStateProvider>
				</ThemeProvider>,
			)
			await Promise.resolve()
		})
	}
	function button(text: string) {
		const found = [...document.querySelectorAll('button')].find(
			(element) =>
				element.textContent?.includes(text) ||
				element.getAttribute('aria-label')?.includes(text),
		)
		if (!found) throw new Error(`Missing button: ${text}`)
		return found
	}
	async function click(text: string) {
		await act(async () => {
			button(text).click()
			await Promise.resolve()
		})
	}
	function fillSearch(text: string) {
		act(() => {
			const input = document.querySelector('input')!
			Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				'value',
			)!.set!.call(input, text)
			input.dispatchEvent(new Event('input', { bubbles: true }))
		})
	}
	function collectionFixture(count: number) {
		const dataset = [
			{
				_id: 'overview',
				_type: 'kitProofPage',
				title: 'Journal overview',
				pathname: { current: '/journal' },
				_updatedAt: '2026-10-29T00:00:00Z',
			},
			...Array.from({ length: count }, (_, index) => ({
				_id: `post-${String(index).padStart(3, '0')}`,
				_type: 'kitProofPost',
				title: `Post ${index}`,
				pathname: { current: `/journal/post-${index}` },
				_updatedAt: '2026-10-29T00:00:00Z',
			})),
		]
		native.fetch.mockImplementation(async (query, params): Promise<unknown> => {
			const result = await evaluate(parse(query), { dataset, params })
			return (await result.get()) as unknown
		})
	}

	function savedFolderFixture(paths: string[], extraPages: object[] = []) {
		const folders = {
			_id: 'sanityKit.folders',
			_type: 'sanityKitFolderRegistry',
			_rev: 'folder-revision',
			schemaVersion: 1,
			folders: paths.map((pathname, index) => ({
				_key: `folder-${index}`,
				pathname,
			})),
		}
		const dataset: object[] = [
			folders,
			{
				_id: 'about',
				_type: 'kitProofPage',
				title: 'About',
				pathname: { current: '/about' },
			},
			...extraPages,
		]
		native.fetch.mockImplementation(async (query, params): Promise<unknown> =>
			(await evaluate(parse(query), { dataset, params })).get(),
		)
		return { folders, dataset }
	}

	async function openFolderSync() {
		await click('Pages options')
		await act(async () => {
			const item = [
				...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
			].find((element) => element.textContent === 'Sync folders')
			expect(item).toBeTruthy()
			item!.click()
			await Promise.resolve()
		})
	}
	function syncDialog() {
		return (
			document.querySelector('[data-ui="Dialog"][id="pages-folder-sync"]') ??
			[...document.querySelectorAll('[role="dialog"]')].find((element) =>
				element.textContent?.includes('Sync folders'),
			)
		)
	}
	function readableFolderFixture() {
		const fixture = savedFolderFixture(['/about'])
		for (const value of fixture.dataset)
			Object.assign(value, { _rev: 'fixture-revision' })
		native.request.mockResolvedValue([
			{ filter: 'true', permissions: ['read'] },
		])
		return fixture
	}

	async function openFolderCreate(menu = 'Pages options') {
		await click(menu)
		await act(async () => {
			const item = [
				...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
			].find((element) => element.textContent === 'New subfolder')
			expect(item).toBeTruthy()
			item!.click()
			await Promise.resolve()
		})
	}
	// The scheduled safety sync may read permissions during any browsing test.
	// Assert the real boundary: opening or expanding UI does not write folders.
	function expectNoFolderWrites() {
		expect(native.mutate).not.toHaveBeenCalled()
		for (const [request] of native.request.mock.calls) {
			expect(request.url).toBe('/projects/testproject/datasets/test/acl')
			expect(request.method ?? 'GET').toBe('GET')
			expect(request.body).toBeUndefined()
		}
	}
	function createFolderDialog() {
		return [...document.querySelectorAll('[data-ui="Dialog"]')].find(
			(element) => element.textContent?.includes('New subfolder'),
		)
	}
	function fillFolderName(value: string) {
		act(() => {
			const input = document.querySelector<HTMLInputElement>(
				'input[placeholder="team or company/team"]',
			)!
			Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				'value',
			)!.set!.call(input, value)
			input.dispatchEvent(new Event('input', { bubbles: true }))
		})
	}

	it('opens navigator folder creation at root without moving the preview or edited document', async () => {
		vi.useFakeTimers()
		readableFolderFixture()
		await render()
		await openFolderCreate()
		await act(async () => {
			await vi.advanceTimersByTimeAsync(FOLDER_SYNC_DELAY_MS)
		})
		expect(native.request).toHaveBeenCalledOnce()
		expect(createFolderDialog()).toBeTruthy()
		expect(button('Nest inside: /').getAttribute('aria-label')).toBe(
			'Nest inside: /',
		)
		expect(button('Create folder').disabled).toBe(true)
		expect(native.navigate).not.toHaveBeenCalled()
		expect(native.intent).not.toHaveBeenCalled()
		expectNoFolderWrites()
		await click('Cancel')
		expect(createFolderDialog()).toBeUndefined()
	})

	it('locks the ordinary folder parent and keeps creation open after closing the page picker', async () => {
		readableFolderFixture()
		await render()
		await click('Toggle navigator')
		await click('Choose page')
		await openFolderCreate('Folder options: /about')
		expect(button('Choose page').getAttribute('aria-expanded')).toBe('false')
		expect(createFolderDialog()).toBeTruthy()
		expect(
			createFolderDialog()?.querySelector('[aria-label^="Nest inside:"]'),
		).toBeNull()
		expect(createFolderDialog()?.textContent).toContain('/about')
		fillFolderName('company/team')
		expect(createFolderDialog()?.querySelector('output')?.textContent).toBe(
			'/about/company/team',
		)
		expect(native.navigate).not.toHaveBeenCalled()
		expect(native.intent).not.toHaveBeenCalled()
		expectNoFolderWrites()
	})

	it('refreshes and expands new navigator folders without changing document selection or preview', async () => {
		const fixture = readableFolderFixture()
		native.request.mockImplementation((options) => {
			if (options.url.endsWith('/acl'))
				return Promise.resolve([{ filter: 'true', permissions: ['read'] }])
			const patch = options.body!.mutations[0]!.patch
			fixture.folders.folders.push(...patch.insert.items)
			fixture.folders._rev = 'created-revision'
			return Promise.resolve({
				transactionId: 'created-folders',
				results: [{ id: 'sanityKit.folders', operation: 'update' }],
			})
		})
		await render()
		await click('Collapse About')
		await openFolderCreate('Folder options: /about')
		fillFolderName('company/team')
		await click('Create folder')
		expect(createFolderDialog()).toBeUndefined()
		expect(button('Collapse About')).toBeTruthy()
		expect(button('Collapse Company')).toBeTruthy()
		expect(button('Collapse Team')).toBeTruthy()
		expect(container.textContent).toContain('No pages in this folder.')
		expect(fixture.folders.folders.map((folder) => folder.pathname)).toContain(
			'/about/company/team',
		)
		expect(
			native.request.mock.calls.filter(
				([options]) => options.method === 'POST',
			),
		).toHaveLength(1)
		expect(native.navigate).not.toHaveBeenCalled()
		expect(native.intent).not.toHaveBeenCalled()
		expect(native.mutate).not.toHaveBeenCalled()
		expect(native.params).toEqual({
			preview: '/about',
			id: 'shared',
			type: 'kitProofShared',
		})
	})

	it('does not offer ordinary folder actions on collection rows', async () => {
		collectionFixture(1)
		await render()
		expect(button('Collapse Journal')).toBeTruthy()
		expect(
			document.querySelector('[aria-label="Folder options: /journal"]'),
		).toBeNull()
	})

	it('keeps navigator creation open with missing access requirements and sends no mutation', async () => {
		readableFolderFixture()
		native.request.mockResolvedValueOnce([])
		await render()
		await openFolderCreate('Folder options: /about')
		fillFolderName('team')
		await click('Create folder')
		expect(createFolderDialog()?.textContent).toContain(
			'Read the folder registry (not granted)',
		)
		expect(
			document.querySelector<HTMLInputElement>(
				'input[placeholder="team or company/team"]',
			)?.value,
		).toBe('team')
		expect(
			native.request.mock.calls.every(([options]) => options.method !== 'POST'),
		).toBe(true)
		expect(native.mutate).not.toHaveBeenCalled()
		expect(native.navigate).not.toHaveBeenCalled()
		expect(native.intent).not.toHaveBeenCalled()
	})

	it('runs Sync folders from the navigator and reports an up-to-date list without a mutation', async () => {
		readableFolderFixture()
		await render()
		await openFolderSync()
		expect(syncDialog()?.textContent).toContain('Folders are up to date.')
		expect(native.request).toHaveBeenCalledOnce()
		expect(native.request.mock.calls[0]![0].url).toContain('/acl')
		expect(native.mutate).not.toHaveBeenCalled()
		await click('Close')
		expect(syncDialog()).toBeUndefined()
		expect(button('About · /about').disabled).toBe(false)
	})

	it('closes the page picker while keeping its requested folder-sync dialog mounted', async () => {
		readableFolderFixture()
		let allowAccess!: (value: unknown) => void
		native.request.mockReturnValueOnce(
			new Promise((resolve) => {
				allowAccess = resolve
			}),
		)
		await render()
		await click('Toggle navigator')
		await click('Choose page')
		expect(button('Choose page').getAttribute('aria-expanded')).toBe('true')
		await openFolderSync()
		expect(button('Choose page').getAttribute('aria-expanded')).toBe('false')
		expect(syncDialog()?.textContent).toContain('Checking folders…')
		await act(async () => {
			allowAccess([{ filter: 'true', permissions: ['read'] }])
			await Promise.resolve()
		})
		expect(syncDialog()?.textContent).toContain('Folders are up to date.')
		expect(native.request).toHaveBeenCalledOnce()
		expect(native.navigate).not.toHaveBeenCalled()
	})

	it('explains missing access without mutating, then retries within the same dialog', async () => {
		readableFolderFixture()
		native.request.mockResolvedValueOnce([])
		await render()
		await openFolderSync()
		expect(syncDialog()?.textContent).toContain('Folder sync needs attention')
		expect(syncDialog()?.textContent).toContain(
			'Read the folder registry (not granted)',
		)
		expect(native.request).toHaveBeenCalledOnce()
		expect(
			native.request.mock.calls.every(([options]) => options.method !== 'POST'),
		).toBe(true)
		expect(native.mutate).not.toHaveBeenCalled()
		await click('Retry')
		expect(syncDialog()?.textContent).toContain('Folders are up to date.')
		expect(native.request).toHaveBeenCalledTimes(2)
		expect(
			native.request.mock.calls.every(([options]) => options.method !== 'POST'),
		).toBe(true)
	})

	it('keeps one sync operation when the document perspective changes during its access check', async () => {
		readableFolderFixture()
		let allowAccess!: (value: unknown) => void
		native.request.mockReturnValueOnce(
			new Promise((resolve) => {
				allowAccess = resolve
			}),
		)
		await render()
		await openFolderSync()
		native.perspective = ['published']
		await render()
		expect(syncDialog()?.textContent).toContain('Checking folders…')
		expect(native.request).toHaveBeenCalledOnce()
		await act(async () => {
			allowAccess([{ filter: 'true', permissions: ['read'] }])
			await Promise.resolve()
		})
		expect(syncDialog()?.textContent).toContain('Folders are up to date.')
		expect(native.request).toHaveBeenCalledOnce()
	})

	it('reports saved folders and refreshes the navigator after an explicit sync', async () => {
		const fixture = readableFolderFixture()
		fixture.dataset.push({
			_id: 'new-page',
			_type: 'kitProofPage',
			_rev: 'new-revision',
			title: 'New page',
			pathname: { current: '/new-folder/child' },
		})
		native.request.mockImplementation((options) => {
			if (options.url.endsWith('/acl'))
				return Promise.resolve([{ filter: 'true', permissions: ['read'] }])
			const patch = options.body!.mutations[0]!.patch
			fixture.folders.folders.push(...patch.insert.items)
			fixture.folders._rev = 'saved-revision'
			return Promise.resolve({
				transactionId: 'saved-folders',
				results: [{ id: 'sanityKit.folders', operation: 'update' }],
			})
		})
		await render()
		await openFolderSync()
		expect(syncDialog()?.textContent).toContain('1 folder saved.')
		expect(button('Collapse New-folder')).toBeTruthy()
		expect(
			native.request.mock.calls.filter(
				([options]) => options.method === 'POST',
			),
		).toHaveLength(1)
		expect(native.mutate).not.toHaveBeenCalled()
	})

	it('checks folders after startup even when the navigator and picker are closed', async () => {
		readableFolderFixture()
		await render()
		await click('Toggle navigator')
		expect(button('Choose page').getAttribute('aria-expanded')).toBe('false')
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 1100))
		})
		expect(native.request).toHaveBeenCalledOnce()
		expect(native.request.mock.calls[0]![0].url).toContain('/acl')
		expect(syncDialog()).toBeUndefined()
		expect(native.mutate).not.toHaveBeenCalled()
		expect(
			native.request.mock.calls.every(([options]) => options.method !== 'POST'),
		).toBe(true)
	})

	it('keeps legacy navigation usable when its collection paths cannot be saved as folders', async () => {
		const runtime = createPagesRuntime({
			previewUrl: 'https://preview.test',
			pages: [
				{ schemaType: 'kitProofPage', pathnameField: 'pathname.current' },
			],
			collections: [
				{
					name: 'journal',
					title: 'Journal',
					overview: { schemaType: 'kitProofPage', pathname: '/journal/' },
					routePrefix: '/journal',
					items: [
						{ schemaType: 'kitProofPost', pathnameField: 'pathname.current' },
					],
				},
			],
		})
		await act(async () => {
			root.render(
				<ThemeProvider theme={theme}>
					<ConfiguredProvider runtime={runtime}>
						<NativeShell />
					</ConfiguredProvider>
				</ThemeProvider>,
			)
			await Promise.resolve()
		})
		expect(button('About · /about').disabled).toBe(false)
		await click('About · /about')
		expect(native.navigate).toHaveBeenCalledWith('/about', {
			id: 'about',
			type: 'kitProofPage',
		})
		await openFolderSync()
		expect(syncDialog()?.textContent).toContain(
			'This Pages configuration can be browsed, but is not ready to save folders.',
		)
		expect(native.request).not.toHaveBeenCalled()
		expect(native.mutate).not.toHaveBeenCalled()
	})

	it('shows saved empty folders without inventing a page or navigating when expanded', async () => {
		savedFolderFixture(['/empty'])
		await render()
		expect(button('Collapse Empty')).toBeTruthy()
		expect(container.textContent).toContain('No pages in this folder.')
		expect(document.querySelector('[aria-label="Empty · /empty"]')).toBeNull()
		await click('Collapse Empty')
		expect(container.textContent).not.toContain('No pages in this folder.')
		await click('Expand Empty')
		expect(container.textContent).toContain('No pages in this folder.')
		expect(native.navigate).not.toHaveBeenCalled()
		expect(native.mutate).not.toHaveBeenCalled()
		expectNoFolderWrites()
	})

	it('places an existing page inside its saved folder even without descendant pages', async () => {
		savedFolderFixture(['/about'])
		await render()
		expect(button('Collapse About')).toBeTruthy()
		expect(button('About · /about')).toBeTruthy()
		expect(container.textContent).not.toContain('No pages in this folder.')
		await click('Collapse About')
		expect(document.querySelector('[aria-label="About · /about"]')).toBeNull()
		await click('Expand About')
		await click('About · /about')
		expect(native.navigate).toHaveBeenCalledWith('/about', {
			id: 'about',
			type: 'kitProofPage',
		})
	})

	it('keeps pages selectable when saved-folder loading fails and recovers through its retry action', async () => {
		const fixture = savedFolderFixture(['/empty'])
		fixture.folders.schemaVersion = 2
		await render()
		expect(container.textContent).toContain(
			'The folder list may be incomplete.',
		)
		expect(button('About · /about').disabled).toBe(false)
		await click('About · /about')
		expect(native.navigate).toHaveBeenCalledWith('/about', {
			id: 'about',
			type: 'kitProofPage',
		})
		fixture.folders.schemaVersion = 1
		await click('Retry loading folders')
		expect(button('Collapse Empty')).toBeTruthy()
		expect(container.textContent).not.toContain(
			'The folder list may be incomplete.',
		)
		expect(native.listen).toHaveBeenCalledTimes(1)
		expect(native.mutate).not.toHaveBeenCalled()
		expectNoFolderWrites()
	})

	it('does not delay ordinary page browsing while saved-folder metadata is still loading', async () => {
		savedFolderFixture(['/empty'])
		const read = native.fetch.getMockImplementation()!
		native.fetch.mockImplementation((query, params, options) =>
			params.registryId ? new Promise(() => {}) : read(query, params, options),
		)
		await render()
		expect(button('About · /about').disabled).toBe(false)
		await click('About · /about')
		expect(native.navigate).toHaveBeenCalledWith('/about', {
			id: 'about',
			type: 'kitProofPage',
		})
		expect(native.mutate).not.toHaveBeenCalled()
		expectNoFolderWrites()
	})

	it('refreshes saved folders through the shared listener and preserves expansion in the picker', async () => {
		const fixture = savedFolderFixture(['/empty'])
		await render()
		await click('Collapse Empty')
		fixture.folders.folders.push({ _key: 'added', pathname: '/planned' })
		fixture.folders._rev = 'folder-revision-2'
		await act(async () => {
			native.observer!.next({ type: 'mutation' })
			await new Promise((resolve) => setTimeout(resolve, 200))
		})
		expect(button('Collapse Planned')).toBeTruthy()
		expect(button('Expand Empty')).toBeTruthy()
		await click('Toggle navigator')
		await click('Choose page')
		const dialog = document.querySelector('[role="dialog"]')!
		expect(dialog.contains(button('Expand Empty'))).toBe(true)
		expect(dialog.contains(button('Collapse Planned'))).toBe(true)
		expect(native.listen).toHaveBeenCalledTimes(1)
		expect(native.unsubscribe).not.toHaveBeenCalled()
		expect(native.mutate).not.toHaveBeenCalled()
		expectNoFolderWrites()
	})

	it('does not show saved-folder rows from the previous perspective while its new session loads', async () => {
		savedFolderFixture(['/empty'])
		await render()
		expect(button('Collapse Empty')).toBeTruthy()
		native.fetch.mockReturnValue(new Promise(() => {}))
		native.perspective = ['published']
		await render()
		expect(document.querySelector('[aria-label="Collapse Empty"]')).toBeNull()
		expect(native.unsubscribe).toHaveBeenCalledTimes(1)
	})

	it('uses full URLs throughout the browser while collection documents store only slugs', async () => {
		const runtime = createPagesRuntime({
			previewUrl: 'https://preview.test',
			pages: [{ schemaType: 'page', pathnameField: 'path' }],
			collections: [
				{
					name: 'journal',
					title: 'Journal',
					itemsTitle: 'Posts',
					overview: { schemaType: 'page', pathname: '/journal' },
					routePrefix: '/journal',
					items: [{ schemaType: 'post', slugField: 'slug.current' }],
				},
			],
		})
		const dataset = [
			{
				_id: 'overview',
				_type: 'page',
				title: 'Journal overview',
				path: '/journal',
				_updatedAt: '2026-10-30',
			},
			{
				_id: 'post',
				_type: 'post',
				title: 'First post',
				slug: { current: 'first' },
				_updatedAt: '2026-10-30',
			},
		]
		native.params = { preview: '/journal/first', id: 'shared', type: 'shared' }
		native.fetch.mockImplementation(
			async (query, params): Promise<unknown> =>
				(
					await evaluate(parse(query), { dataset, params })
				).get() as Promise<unknown>,
		)
		await act(async () => {
			root.render(
				<ThemeProvider theme={theme}>
					<ConfiguredProvider runtime={runtime}>
						<NativeShell />
					</ConfiguredProvider>
				</ThemeProvider>,
			)
			await Promise.resolve()
		})
		expect(button('First post · /journal/first')).toBeTruthy()
		await click('Browse all posts')
		fillSearch('/journal/first')
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 250))
		})
		expect(button('First post · /journal/first')).toBeTruthy()
		await click('Toggle navigator')
		expect(button('Choose page: First post')).toBeTruthy()
		await click('Choose page')
		await click('First post · /journal/first')
		expect(native.navigate).toHaveBeenCalledWith('/journal/first', {
			id: 'post',
			type: 'post',
		})
		expect(dataset[1]).not.toHaveProperty('path')
	})

	it('finds a preview title outside the loaded collection batch, independently of the edited document', async () => {
		collectionFixture(70)
		native.params.preview = '/journal/post-69'
		await render()
		await click('Toggle navigator')
		expect(button('Choose page: Post 69')).toBeTruthy()
		expect(container.textContent).not.toContain(
			'Preview unavailable for this document',
		)
		expect(native.navigate).not.toHaveBeenCalled()
	})
	it('loads the edited page separately and clears its missing-URL notice on navigation', async () => {
		native.params = {
			preview: '/about',
			id: 'unfinished',
			type: 'kitProofPage',
		}
		await render()
		await click('Toggle navigator')
		expect(button('Choose page: About')).toBeTruthy()
		expect(container.textContent).toContain(
			'Preview unavailable for this document',
		)
		native.fetch.mockReturnValue(new Promise(() => {}))
		native.params = { preview: '/about/team', id: 'team', type: 'kitProofPage' }
		await render()
		expect(button('Choose page: /about/team')).toBeTruthy()
		expect(container.textContent).not.toContain(
			'Preview unavailable for this document',
		)
	})
	it('does not retain a title or missing-URL notice from the previous perspective', async () => {
		native.params = {
			preview: '/about',
			id: 'unfinished',
			type: 'kitProofPage',
		}
		await render()
		await click('Toggle navigator')
		expect(button('Choose page: About')).toBeTruthy()
		native.fetch.mockReturnValue(new Promise(() => {}))
		native.perspective = ['published']
		await render()
		expect(button('Choose page: /about')).toBeTruthy()
		expect(container.textContent).not.toContain(
			'Preview unavailable for this document',
		)
	})

	it('shows folders separately from named index pages without Index badges', async () => {
		await render()
		expect(button('Collapse About').getAttribute('aria-expanded')).toBe('true')
		expect(button('About · /about')).toBeTruthy()
		expect(container.textContent).not.toContain('Index')
		await click('Collapse About')
		expect(document.querySelector('[aria-label="About · /about"]')).toBeNull()
		expect(native.navigate).not.toHaveBeenCalled()
		await click('Toggle navigator')
		await click('Choose page')
		expect(button('Expand About').getAttribute('aria-expanded')).toBe('false')
		await click('Expand About')
		expect(button('Team · /about/team')).toBeTruthy()
	})
	it('separates expanded groups from following siblings but keeps collapsed groups compact', async () => {
		const pages = [
			{
				_id: 'about',
				_type: 'kitProofPage',
				title: 'About',
				pathname: '/about',
			},
			{
				_id: 'team',
				_type: 'kitProofPage',
				title: 'Team',
				pathname: '/about/team',
			},
			{
				_id: 'journal',
				_type: 'kitProofPage',
				title: 'Journal',
				pathname: '/journal',
			},
			{ _id: 'last', _type: 'kitProofPage', title: 'Last', pathname: '/last' },
		]
		const dataset = pages.map((page) => ({
			...page,
			pathname: { current: page.pathname },
		}))
		native.fetch.mockImplementation(async (query, params): Promise<unknown> => {
			const result = await evaluate(parse(query), { dataset, params })
			return (await result.get()) as unknown
		})
		await render()
		for (const title of ['About', 'Journal']) {
			expect(
				getComputedStyle(
					button(`Collapse ${title}`).parentElement!.closest(
						'[data-ui="Box"]',
					)!,
				).paddingBottom,
			).toBe('0.75rem')
			await click(`Collapse ${title}`)
			expect(
				getComputedStyle(
					button(`Expand ${title}`).parentElement!.closest('[data-ui="Box"]')!,
				).paddingBottom,
			).toBe('0px')
		}
		expect(native.navigate).not.toHaveBeenCalled()
	})
	it('separates pages without preview URLs from valid ungrouped paths', async () => {
		const dataset = [
			{ _id: 'missing', _type: 'kitProofPage', title: 'Missing URL' },
			{
				_id: 'unusual',
				_type: 'kitProofPage',
				title: 'Unusual URL',
				pathname: { current: '/about//team' },
			},
		]
		native.fetch.mockImplementation(async (query, params): Promise<unknown> => {
			const result = await evaluate(parse(query), { dataset, params })
			return (await result.get()) as unknown
		})
		await render()
		const labels = [...container.querySelectorAll('[data-ui="Text"]')]
		const missing = labels.find(
			(element) => element.textContent === 'Pages without URLs',
		)!
		const ungrouped = labels.find(
			(element) => element.textContent === 'Ungrouped pages',
		)!
		expect(
			missing.parentElement!.parentElement!.contains(
				button('Missing URL · Preview unavailable'),
			),
		).toBe(true)
		expect(
			ungrouped.parentElement!.parentElement!.contains(
				button('Unusual URL · /about//team'),
			),
		).toBe(true)
		expect(container.textContent).not.toContain('Other pages')
		await click('Unusual URL · /about//team')
		expect(native.navigate).toHaveBeenCalledWith('/about//team', {
			id: 'unusual',
			type: 'kitProofPage',
		})
	})

	it('shows a Sanity tooltip for keyboard focus without a browser title', async () => {
		await render()
		const create = button('Create page')
		expect(create.hasAttribute('title')).toBe(false)
		await act(async () => {
			create.focus()
			await new Promise((resolve) => setTimeout(resolve, 450))
		})
		await vi.waitFor(() => {
			const tooltip = [
				...document.querySelectorAll<HTMLElement>('[data-ui="Tooltip"]'),
			].find((element) => element.textContent === 'Create page')!
			expect(tooltip).toBeTruthy()
			expect(getComputedStyle(tooltip).display).not.toBe('none')
		})
	})

	it('uses compact header typography and clears search without navigating', async () => {
		await render()
		const header = container.querySelector('[data-pages-header]')!
		const title = [
			...header.querySelectorAll<HTMLElement>('[data-ui="Text"]'),
		].find((element) => element.textContent === 'Pages')!
		expect(getComputedStyle(title).fontWeight).toBe('600')
		expect(getComputedStyle(title).fontSize).toBe(
			getComputedStyle(header.querySelector('input')!).fontSize,
		)
		expect(
			button('Pages options').querySelector(
				'[data-sanity-icon="ellipsis-horizontal"]',
			),
		).not.toBeNull()
		fillSearch('Team')
		await click('Clear')
		expect(header.querySelector('input')!.value).toBe('')
		expect(button('Collapse About')).toBeTruthy()
		expect(native.navigate).not.toHaveBeenCalled()
	})
	it('uses native selectable cards and Structure spacing for navigation rows', async () => {
		await render()
		const row = button('Team · /about/team')
		const texts = [...row.querySelectorAll<HTMLElement>('[data-ui="Text"]')]
		const title = texts.find((element) => element.textContent === 'Team')!
		const path = texts.find((element) => element.textContent === '/about/team')!
		expect(getComputedStyle(title).fontWeight).toBe('500')
		expect(getComputedStyle(path).fontWeight).toBe('400')
		expect(getComputedStyle(title).fontSize).toBe(
			getComputedStyle(path).fontSize,
		)
		// Native Card owns hover, selected, disabled, and keyboard focus colors.
		// No captured parent palette may override its state-specific foreground.
		expect(row.getAttribute('data-ui')).toBe('Card')
		expect(row.getAttribute('data-as')).toBe('button')
		expect(title.style.color).toBe('')
		expect(path.style.color).toBe('')
		expect(row.style.minHeight).toBe('49px')
		expect(button('About · /about').hasAttribute('data-selected')).toBe(true)
		expect(row.hasAttribute('data-selected')).toBe(false)
		const folder = button('Collapse About')
		expect(folder.getAttribute('data-ui')).toBe('Card')
		expect(folder.style.minHeight).toBe('33px')
		expect(
			getComputedStyle(folder.querySelector('[data-ui="Text"]')!).fontWeight,
		).toBe('500')
	})
	it('search finds pages inside collapsed folders without changing expansion', async () => {
		await render()
		await click('Collapse About')
		fillSearch('Team')
		expect(button('Team · /about/team')).toBeTruthy()
		fillSearch('')
		expect(button('Expand About')).toBeTruthy()
		expect(
			document.querySelector('[aria-label="Team · /about/team"]'),
		).toBeNull()
	})
	it('keeps the Pages options menu inside the modal focus boundary', async () => {
		await render()
		await click('Toggle navigator')
		await click('Choose page')
		await click('Pages options')
		const dialog = document.querySelector('[role="dialog"]')!
		const menu = document.querySelector('[role="menu"]')!
		expect(dialog.contains(menu)).toBe(true)
		const collapse = [
			...menu.querySelectorAll<HTMLElement>('[role="menuitem"]'),
		].find((item) => item.textContent?.includes('Collapse all'))!
		act(() => collapse.click())
		expect(button('Expand About')).toBeTruthy()
		expect(native.navigate).not.toHaveBeenCalled()
	})
	it('loads another collection batch when scrolling near the bottom', async () => {
		collectionFixture(70)
		await render()
		await click('Browse all posts')
		const scroller = document.querySelector<HTMLElement>(
			'[data-pages-scroll="collection"]',
		)!
		Object.defineProperty(scroller, 'scrollHeight', { value: 2000 })
		Object.defineProperty(scroller, 'clientHeight', { value: 400 })
		await act(async () => {
			scroller.scrollTop = 1500
			scroller.dispatchEvent(new Event('scroll', { bubbles: true }))
			await Promise.resolve()
		})
		expect(button('Post 69 · /journal/post-69')).toBeTruthy()
		expect(
			native.fetch.mock.calls.some((call) => call[1]?.hasCursor === true),
		).toBe(true)
	})
	it('labels recent items separately and puts the total in the browse row', async () => {
		collectionFixture(70)
		await render()
		const label = [
			...container.querySelectorAll<HTMLElement>('[data-ui="Text"]'),
		].find((element) => element.textContent === 'Recent posts')!
		const browse = button('Browse all posts')
		const count = [
			...browse.querySelectorAll<HTMLElement>('[data-ui="Text"]'),
		].find((element) => element.textContent === '70')!
		const subtitle = [
			...button('Journal overview · /journal').querySelectorAll<HTMLElement>(
				'[data-ui="Text"]',
			),
		].find((element) => element.textContent === '/journal')!
		expect(count.textContent).toBe('70')
		expect(browse.getAttribute('aria-label')).toBe('Browse all posts, 70 total')
		expect(label.parentElement!.textContent).toBe('Recent posts')
		expect(getComputedStyle(label).fontSize).toBe(
			getComputedStyle(subtitle).fontSize,
		)
		expect(getComputedStyle(count).fontSize).toBe(
			getComputedStyle(subtitle).fontSize,
		)
	})
	it('browses beyond five recent items with query-side search and keeps collection mode in the picker', async () => {
		collectionFixture(70)
		await render()
		expect(button('Journal overview · /journal')).toBeTruthy()
		expect(
			document.querySelector('[aria-label="Post 6 · /journal/post-6"]'),
		).toBeNull()
		const browse = button('Browse all posts')
		expect(browse.getAttribute('data-ui')).toBe('Card')
		expect(browse.style.textAlign).toBe('left')
		expect(
			browse.querySelector('[data-sanity-icon="chevron-right"]'),
		).not.toBeNull()
		await click('Browse all posts')
		expect(container.textContent).not.toContain('loaded · Last edited')
		expect(native.navigate).not.toHaveBeenCalled()
		expect(button('Post 49 · /journal/post-49')).toBeTruthy()
		await click('Load more items')
		expect(button('Post 69 · /journal/post-69')).toBeTruthy()
		fillSearch('post-69')
		expect(
			document.querySelector('[aria-label="Post 49 · /journal/post-49"]'),
		).toBeNull()
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 250))
		})
		expect(button('Post 69 · /journal/post-69')).toBeTruthy()
		expect(
			native.fetch.mock.calls.some((call) => call[1]?.search === 'post-69'),
		).toBe(true)
		await click('Toggle navigator')
		await click('Choose page')
		expect(document.querySelector('input')?.value).toBe('post-69')
		expect(button('Back to pages')).toBeTruthy()
		await click('Post 69 · /journal/post-69')
		expect(native.navigate).toHaveBeenCalledWith('/journal/post-69', {
			id: 'post-069',
			type: 'kitProofPost',
		})
		expect(document.querySelector('[role="dialog"]')).toBeNull()
	})

	it('places the page-title trigger after the toggle and before native controls', async () => {
		await render()
		await click('Toggle navigator')
		const trigger = button('Choose page: About')
		expect(trigger.textContent).toBe('About')
		expect(trigger.hasAttribute('title')).toBe(false)
		expect(trigger.querySelector('[data-sanity-icon="documents"]')).toBeTruthy()
		expect(
			trigger.querySelector('[data-sanity-icon="chevron-down"]'),
		).toBeTruthy()
		const controls = [...container.querySelectorAll('button')]
		expect(controls.indexOf(button('Toggle navigator'))).toBeLessThan(
			controls.indexOf(trigger),
		)
		expect(controls.indexOf(trigger)).toBeLessThan(
			controls.indexOf(button('Native refresh')),
		)
		expect(
			controls.filter(
				(control) =>
					control.getAttribute('aria-label') === 'Toggle navigator' ||
					control.textContent === 'Toggle navigator',
			),
		).toHaveLength(1)
		// Shared content stays selected in the editor while the iframe changes page.
		native.params.preview = '/about/team'
		await render()
		expect(button('Choose page: Team').textContent).toBe('Team')
		expect(native.params.id).toBe('shared')
		// Unknown pages keep the full path for accessibility, even when visually clipped.
		native.params.preview =
			'/a-very-long-preview-path-that-is-not-in-the-identity-window'
		await render()
		const fallback = button(`Choose page: ${native.params.preview}`)
		expect(fallback.hasAttribute('title')).toBe(false)
		expect(
			fallback.querySelector('span[style]')?.getAttribute('style'),
		).toContain('text-overflow: ellipsis')
	})

	it('preserves native controls and search through navigator unmount and picker mount', async () => {
		await render()
		expect(button('Native refresh')).toBeTruthy()
		expect(
			document.querySelector(
				'[aria-haspopup="dialog"][aria-label^="Choose page"]',
			),
		).toBeNull()
		const input = document.querySelector('input')!
		act(() => {
			Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				'value',
			)!.set!.call(input, 'Team')
			input.dispatchEvent(new Event('input', { bubbles: true }))
		})
		await click('Toggle navigator')
		expect(document.querySelector('input')).toBeNull()
		await click('Choose page: About')
		expect(document.querySelector('input')?.value).toBe('Team')
		await click('Team · /about/team')
		expect(native.navigate).toHaveBeenCalledWith('/about/team', {
			id: 'team',
			type: 'kitProofPage',
		})
		expect(document.querySelector('[role="dialog"]')).toBeNull()
		expect(document.activeElement).toBe(button('Choose page: About'))
		await click('Toggle navigator')
		expect(document.querySelector('input')?.value).toBe('Team')
	})

	it('dismisses on Escape and when reopening the native sidebar', async () => {
		await render()
		await click('Toggle navigator')
		await click('Choose page: About')
		act(() => {
			document
				.querySelector('input')!
				.dispatchEvent(
					new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
				)
		})
		expect(document.querySelector('[role="dialog"]')).toBeNull()
		expect(document.activeElement).toBe(button('Choose page: About'))
		await click('Choose page: About')
		await click('Toggle navigator')
		expect(document.querySelector('[role="dialog"]')).toBeNull()
		expect(
			document.querySelector(
				'[aria-haspopup="dialog"][aria-label^="Choose page"]',
			),
		).toBeNull()
	})

	it('matches empty-search spacing to the normal row inset', async () => {
		await render()
		await click('Toggle navigator')
		await click('Choose page')
		const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
		fillSearch('no-matching-pages')
		const notice = [...dialog.querySelectorAll('[data-ui="Text"]')].find(
			(element) => element.textContent === 'No pages found.',
		)!
		const spacing = getComputedStyle(notice.parentElement!)
		expect(spacing.paddingTop).toBe('0.5rem')
		expect(spacing.paddingBottom).toBe('0.5rem')
		expect(native.navigate).not.toHaveBeenCalled()
	})

	it.each(['loaded', 'empty', 'loading'] as const)(
		'keeps focus inside the modal picker with %s results',
		async (state) => {
			if (state === 'empty')
				native.fetch.mockImplementation((query: string, params) =>
					Promise.resolve(
						params.registryId
							? null
							: query.includes('"total":')
								? { total: 0, documents: [] }
								: [],
					),
				)
			if (state === 'loading')
				native.fetch.mockReturnValue(new Promise(() => {}))
			await render()
			await click('Toggle navigator')
			await click('Choose page')
			const dialog = document.querySelector('[role="dialog"]')!
			expect(document.activeElement).toBe(dialog)
			expect(dialog.getAttribute('tabindex')).toBe('-1')
			act(() => {
				dialog.dispatchEvent(
					new KeyboardEvent('keydown', {
						key: 'Tab',
						bubbles: true,
						cancelable: true,
					}),
				)
			})
			expect(document.activeElement).toBe(dialog.querySelector('input'))
			// JSDOM does not perform browser Tab navigation. Trying to focus a
			// background control verifies containment; live checks cover Tab wrap.
			act(() => {
				button('Native refresh').focus()
			})
			await vi.waitFor(() =>
				expect(dialog.contains(document.activeElement)).toBe(true),
			)
			expect(dialog.getAttribute('aria-modal')).toBe('true')
			expect(native.navigate).not.toHaveBeenCalled()
		},
	)

	it('opens pathless drafts in the native editor without inventing a preview route', async () => {
		await render()
		await click('Unfinished · Preview unavailable')
		expect(native.navigate).toHaveBeenCalledWith(undefined, {
			id: 'unfinished',
			type: 'kitProofPage',
		})
	})

	it('uses a native create intent with no supplied ID or pathname', async () => {
		await render()
		await click('Create page')
		expect(native.intent).toHaveBeenCalledWith('create', {
			type: 'kitProofPage',
			template: 'kitProofPage',
			presentation: 'pages-proof',
		})
	})

	async function renderCreationChoices(
		invalidSibling = false,
		extraTemplate = false,
	) {
		const runtime = createPagesRuntime({
			name: 'pages-proof',
			previewUrl: 'https://example.test',
			pages: [
				{ schemaType: 'kitProofPage', pathnameField: 'pathname.current' },
				{ schemaType: 'kitProofLanding', pathnameField: 'route' },
			],
			create: [
				{
					schemaType: 'kitProofPage',
					templateId: 'kitProofPage',
					title: 'Standard page',
				},
				{
					schemaType: 'kitProofLanding',
					templateId: 'kitProofLanding',
					title: 'Landing page',
				},
				...(extraTemplate
					? [
							{
								schemaType: 'kitProofPage',
								templateId: 'kitProofPageWithIntro',
							},
						]
					: []),
				...(invalidSibling
					? [{ schemaType: 'kitProofPage', templateId: 'missing' }]
					: []),
			],
		})
		await act(async () => {
			root.render(
				<ThemeProvider theme={theme}>
					<ConfiguredProvider runtime={runtime}>
						<NativeShell />
					</ConfiguredProvider>
				</ThemeProvider>,
			)
			await Promise.resolve()
		})
	}

	it('keeps the creation popover anchored inside Choose page until a choice is made', async () => {
		await renderCreationChoices()
		await click('Toggle navigator')
		await click('Choose page')
		await click('Create page')
		expect(button('Choose page').getAttribute('aria-expanded')).toBe('true')
		expect(native.intent).not.toHaveBeenCalled()
		await click('Landing page')
		expect(native.intent).toHaveBeenCalledExactlyOnceWith('create', {
			type: 'kitProofLanding',
			template: 'kitProofLanding',
			presentation: 'pages-proof',
		})
		expect(native.mutate).not.toHaveBeenCalled()
	})

	it('filters creation choices without taking the single-choice shortcut and restores focus', async () => {
		await renderCreationChoices()
		await click('Create page')
		const input = document.querySelector<HTMLInputElement>(
			'[aria-label="Search page types"]',
		)!
		act(() => {
			Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				'value',
			)!.set!.call(input, 'landing')
			input.dispatchEvent(new Event('input', { bubbles: true }))
		})
		expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
			'Landing page',
		)
		expect(
			document.querySelector('[role="dialog"]')?.textContent,
		).not.toContain('Standard page')
		expect(native.intent).not.toHaveBeenCalled()
		await act(() =>
			input.dispatchEvent(
				new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
			),
		)
		expect(document.activeElement).toBe(button('Landing page'))
		await act(() =>
			button('Landing page').dispatchEvent(
				new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
			),
		)
		await act(async () => {
			await new Promise((resolve) => requestAnimationFrame(resolve))
		})
		expect(document.querySelector('[role="dialog"]')).toBeNull()
		expect(document.activeElement).toBe(button('Create page'))
	})

	it.each(['page', 'index'] as const)(
		'passes a %s folder proposal to native creation without an ID or URL write',
		async (mode) => {
			savedFolderFixture(['/empty'])
			await renderCreationChoices()
			await click('Folder options: /empty')
			await act(async () => {
				const item = [
					...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
				].find(
					(element) =>
						element.textContent ===
						(mode === 'page' ? 'Create page' : 'Create index page'),
				)!
				expect(item).toBeTruthy()
				expect(item.dataset.ui).toBe('MenuItem')
				item.click()
				await Promise.resolve()
			})
			expect(native.intent).toHaveBeenCalledExactlyOnceWith('create', [
				{
					type: 'kitProofPage',
					template: 'kitProofPage',
					presentation: 'pages-proof',
				},
				{
					sanityKitCreation: {
						version: 1,
						mode,
						pathname: '/empty',
						schemaType: 'kitProofPage',
						templateId: 'kitProofPage',
						pathField: 'pathname.current',
					},
				},
			])
			expect(native.mutate).not.toHaveBeenCalled()
		},
	)

	it.each(['page', 'index'] as const)(
		'offers multiple templates for folder %s creation and preserves the chosen template context',
		async (mode) => {
			savedFolderFixture(['/empty'])
			await renderCreationChoices(false, true)
			await click('Folder options: /empty')
			await act(async () => {
				const item = [
					...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
				].find(
					(element) =>
						element.textContent ===
						(mode === 'page' ? 'Create page' : 'Create index page'),
				)!
				expect(item.dataset.ui).toBe('MenuGroup')
				item.click()
				await Promise.resolve()
			})
			expect(button('Standard page')).toBeTruthy()
			expect(button('Page with intro')).toBeTruthy()
			expect(
				document.querySelector('[data-ui="MenuGroup__popover"]')?.textContent,
			).not.toContain('Landing page')
			expect(native.intent).not.toHaveBeenCalled()
			await click('Page with intro')
			expect(native.intent).toHaveBeenCalledExactlyOnceWith('create', [
				{
					type: 'kitProofPage',
					template: 'kitProofPageWithIntro',
					presentation: 'pages-proof',
				},
				{
					sanityKitCreation: {
						version: 1,
						mode,
						pathname: '/empty',
						schemaType: 'kitProofPage',
						templateId: 'kitProofPageWithIntro',
						pathField: 'pathname.current',
					},
				},
			])
			expect(native.mutate).not.toHaveBeenCalled()
			for (const [request] of native.request.mock.calls) {
				expect(request.url).toBe('/projects/testproject/datasets/test/acl')
				expect(request.method ?? 'GET').toBe('GET')
				expect(request.body).toBeUndefined()
			}
		},
	)

	it('uses a direct folder action when only one of several templates is permitted', async () => {
		savedFolderFixture(['/empty'])
		native.deniedTemplates = ['kitProofPageWithIntro']
		await renderCreationChoices(false, true)
		await click('Folder options: /empty')
		const item = [
			...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
		].find((element) => element.textContent === 'Create page')!
		expect(item.dataset.ui).toBe('MenuItem')
		await act(async () => {
			item.click()
			await Promise.resolve()
		})
		expect(native.intent).toHaveBeenCalledOnce()
		expect(native.intent.mock.calls[0]?.[1]).toMatchObject([
			{ template: 'kitProofPage' },
			{ sanityKitCreation: { pathname: '/empty' } },
		])
	})

	it('keeps the folder submenu open after a failed handoff and retries the selected template', async () => {
		savedFolderFixture(['/empty'])
		await renderCreationChoices(false, true)
		await click('Folder options: /empty')
		const item = [
			...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
		].find((element) => element.textContent === 'Create page')!
		await act(async () => {
			item.click()
			await Promise.resolve()
		})
		native.intent.mockImplementationOnce(() => {
			throw new Error('Navigation unavailable')
		})
		await click('Page with intro')
		expect(document.body.textContent).toContain(
			'The new page could not be opened.',
		)
		expect(
			document.querySelector('[data-ui="MenuGroup__popover"]'),
		).toBeTruthy()
		await click('Retry')
		expect(native.intent).toHaveBeenCalledTimes(2)
		expect(native.intent.mock.calls[1]?.[1]).toMatchObject([
			{ template: 'kitProofPageWithIntro' },
			{ sanityKitCreation: { pathname: '/empty' } },
		])
		expect(button('Folder options: /empty').getAttribute('aria-expanded')).toBe(
			'false',
		)
	})

	it('allows a valid contextual template when another registered template is invalid', async () => {
		savedFolderFixture(['/empty'])
		await renderCreationChoices(true)
		await click('Folder options: /empty')
		await act(async () => {
			const item = [
				...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
			].find((element) => element.textContent === 'Create page')!
			item.click()
			await Promise.resolve()
		})
		expect(native.intent).toHaveBeenCalledTimes(1)
		expect(native.intent.mock.calls[0]?.[1]).toMatchObject([
			{ template: 'kitProofPage' },
			{ sanityKitCreation: { pathname: '/empty' } },
		])
	})

	it('disables creating a folder index when that exact page is already visible', async () => {
		savedFolderFixture(['/about'])
		await renderCreationChoices()
		await click('Folder options: /about')
		const item = [
			...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
		].find((element) => element.textContent === 'Create index page')!
		expect((item as HTMLButtonElement).disabled).toBe(true)
		expect(native.intent).not.toHaveBeenCalled()
	})

	it('opens the only permitted template even when several are registered', async () => {
		native.deniedTemplates = ['kitProofLanding']
		await renderCreationChoices()
		await click('Create page')
		expect(native.intent).toHaveBeenCalledExactlyOnceWith('create', {
			type: 'kitProofPage',
			template: 'kitProofPage',
			presentation: 'pages-proof',
		})
	})

	it('waits for current permissions and explains when none are permitted', async () => {
		native.creationLoading = true
		await renderCreationChoices()
		await click('Create page')
		expect(document.body.textContent).toContain('Checking available page types')
		expect(native.intent).not.toHaveBeenCalled()
		await act(() =>
			document
				.querySelector('[aria-label="Create page"][role="dialog"]')!
				.dispatchEvent(
					new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
				),
		)
		native.creationLoading = false
		native.deniedTemplates = ['kitProofPage', 'kitProofLanding']
		await click('Create page')
		expect(document.body.textContent).toContain(
			'Your current access does not allow',
		)
		expect(native.intent).not.toHaveBeenCalled()
	})

	it('keeps a failed editor handoff in the picker and retries the selected template', async () => {
		await renderCreationChoices()
		native.intent.mockImplementationOnce(() => {
			throw new Error('Navigation failed')
		})
		await click('Create page')
		await click('Landing page')
		expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
			'The new page could not be opened. Retry to open the editor.',
		)
		expect(native.intent).toHaveBeenCalledTimes(1)
		expect(native.mutate).not.toHaveBeenCalled()
		await click('Retry')
		expect(native.intent).toHaveBeenCalledTimes(2)
		expect(native.intent).toHaveBeenLastCalledWith('create', {
			type: 'kitProofLanding',
			template: 'kitProofLanding',
			presentation: 'pages-proof',
		})
		expect(document.querySelector('[role="dialog"]')).toBeNull()
	})

	it('contains permission failures and retries without losing the navigator', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {})
		native.creationError = true
		await renderCreationChoices()
		await click('Create page')
		expect(document.body.textContent).toContain(
			'Page creation could not be checked',
		)
		expect(native.intent).not.toHaveBeenCalled()
		native.creationError = false
		await click('Retry')
		await click('Standard page')
		expect(native.intent).toHaveBeenCalledTimes(1)
		expect(button('Create page')).toBeTruthy()
	})

	it('does not create release versions through the ordinary draft shortcut', async () => {
		native.creationRelease = 'release-1'
		await renderCreationChoices()
		await click('Create page')
		expect(document.body.textContent).toContain(
			'Switch to Drafts to create a page',
		)
		expect(native.intent).not.toHaveBeenCalled()
	})

	it('unsubscribes from the dataset when the browser leaves the tool', async () => {
		await render()
		act(() => root.render(null))
		expect(native.unsubscribe).toHaveBeenCalledTimes(1)
	})

	it('shares resources and one listener between header, sidebar, and picker', async () => {
		await render()
		expect(native.fetch).toHaveBeenCalledTimes(4)
		expect(native.listen).toHaveBeenCalledTimes(1)
		await click('Toggle navigator')
		await click('Choose page')
		// The header keeps its identity resource alive; reopened tree resources refresh.
		expect(native.fetch).toHaveBeenCalledTimes(7)
		expect(native.unsubscribe).not.toHaveBeenCalled()
	})
	it('does not show previous-perspective rows while a new perspective loads', async () => {
		await render()
		expect(button('About · /about')).toBeTruthy()
		native.fetch.mockReturnValue(new Promise(() => {}))
		native.perspective = ['published']
		await render()
		expect(
			[...document.querySelectorAll('button')].some((element) =>
				element.getAttribute('aria-label')?.includes('About · /about'),
			),
		).toBe(false)
		expect(
			native.fetch.mock.calls.some(
				(call) =>
					call[2]?.perspective === 'raw' &&
					call[1]?.registryId === 'sanityKit.folders',
			),
		).toBe(true)
		expect(
			native.fetch.mock.calls.some(
				(call) => JSON.stringify(call[2]?.perspective) === '["published"]',
			),
		).toBe(true)
		expect(native.unsubscribe).toHaveBeenCalledTimes(1)
	})
	it('keeps the mounted list and its scroll position during a background refresh', async () => {
		await render()
		const scroller = document.querySelector<HTMLElement>(
			'[data-pages-scroll="pages"]',
		)!
		act(() => {
			scroller.scrollTop = 120
			scroller.dispatchEvent(new Event('scroll', { bubbles: true }))
		})
		const pending = Promise.withResolvers<unknown>()
		const read = native.fetch.getMockImplementation()!
		let deferred = false
		native.fetch.mockImplementation((query, params, options) => {
			if (
				!deferred &&
				!params.registryId &&
				!params.id &&
				!params.path &&
				!query.includes('"total":')
			) {
				deferred = true
				return pending.promise
			}
			return read(query, params, options)
		})
		await act(async () => {
			native.observer!.next({ type: 'welcome' })
			await Promise.resolve()
		})
		expect(document.querySelector('[data-pages-scroll="pages"]')).toBe(scroller)
		expect(scroller.scrollTop).toBe(120)
		await act(async () => {
			pending.resolve([
				{
					_id: 'about',
					_type: 'kitProofPage',
					title: 'About',
					pathname: '/about',
				},
				{
					_id: 'team',
					_type: 'kitProofPage',
					title: 'Team',
					pathname: '/about/team',
				},
			])
			await Promise.resolve()
		})
		expect(scroller.scrollTop).toBe(120)
	})

	it('shows a retry action and disables stale selection after a listener error', async () => {
		await render()
		act(() => native.observer!.error())
		expect(button('About · /about').disabled).toBe(true)
		expect(document.querySelector('[role="alert"]')?.textContent).toContain(
			'out of date',
		)
		await click('Retry loading pages')
		expect(native.listen).toHaveBeenCalledTimes(2)
		await act(async () => {
			native.observer!.next({ type: 'welcome' })
			await Promise.resolve()
		})
		expect(button('About · /about').disabled).toBe(false)
	})
})
