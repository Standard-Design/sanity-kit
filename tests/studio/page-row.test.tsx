// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/require-await -- React act flushes asynchronous effects. */
import { act, createContext, useContext, type ContextType } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ThemeProvider } from '@sanity/ui'
import { buildTheme } from '@sanity/ui/theme'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserContext } from '../../src/studio/pages/browser-context.js'
import { createPagesRuntime } from '../../src/studio/pages/runtime.js'
import { createPagesDataStore } from '../../src/studio/pages/data-store.js'
import { PageRow } from '../../src/studio/pages/page-row.js'
import type { PageDocument } from '../../src/studio/pages/model.js'

const PresentationContext = createContext({ id: '', navigate: vi.fn() })
const StatusContext = createContext({
	versions: [] as string[],
	loading: false,
})
vi.mock('sanity/presentation', () => ({
	usePresentationParams: () => useContext(PresentationContext),
	usePresentationNavigate: () => useContext(PresentationContext).navigate,
}))
vi.mock('sanity', () => ({
	useDocumentVersions: () => useContext(StatusContext),
	isPublishedVersion: (version: string) => version === 'published',
	isDraftVersion: (version: string) => version === 'draft',
	isReleaseVersion: (version: string) => version === 'release',
	DocumentVersionsStatusIndicator: () => <span />,
}))

const theme = buildTheme()
const noop = () => {}
const original: PageDocument = {
	_id: 'about',
	_type: 'page',
	title: 'About',
	pathname: '/about',
}
let host: HTMLDivElement
let root: Root
let browser: NonNullable<ContextType<typeof BrowserContext>>
let presentation: ContextType<typeof PresentationContext>
let status: ContextType<typeof StatusContext>
let row: { document: PageDocument; disabled?: boolean; selected?: boolean }
function runtime() {
	const configured = createPagesRuntime({
		name: 'row-test',
		previewUrl: 'http://localhost:3346',
		pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
	})
	return { ...configured, model: { ...configured.model } }
}
async function render() {
	await act(async () =>
		root.render(
			<ThemeProvider theme={theme}>
				<PresentationContext.Provider value={presentation}>
					<StatusContext.Provider value={status}>
						<BrowserContext.Provider value={browser}>
							<PageRow {...row} />
						</BrowserContext.Provider>
					</StatusContext.Provider>
				</PresentationContext.Provider>
			</ThemeProvider>,
		),
	)
}
function button() {
	return host.querySelector('button')!
}
beforeEach(() => {
	;(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true
	vi.stubGlobal('matchMedia', () => ({
		matches: false,
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
	}))
	host = document.createElement('div')
	document.body.append(host)
	root = createRoot(host)
	const configured = runtime()
	browser = {
		runtime: configured,
		dataStore: createPagesDataStore(configured),
		folderSync: {} as NonNullable<
			ContextType<typeof BrowserContext>
		>['folderSync'],
		showPageCreate: noop,
		showCollectionCreate: noop,
		pageCreateOpen: false,
		showFolderSync: noop,
		showFolderRemove: noop,
		showFolderRename: noop,
		renameAvailable: false,
		renamePending: false,
		showFolderCreate: noop,
		state: {
			query: '',
			scrollTop: 0,
			collapsed: [],
			collectionQueries: {},
			collectionScroll: {},
		},
		setState: noop,
		pickerOpen: true,
		setPickerOpen: vi.fn(),
	}
	presentation = { id: '', navigate: vi.fn() }
	status = { versions: ['published'], loading: false }
	row = { document: original }
})
afterEach(async () => {
	await act(async () => root.unmount())
	host.remove()
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

describe('page row subscriptions', () => {
	it('skips visual row work for search and scroll changes while keeping navigation active', async () => {
		const resolvePath = vi.spyOn(browser.runtime.model, 'documentPath')
		await render()
		const firstButton = button()
		for (const state of [
			{ ...browser.state, query: 'About' },
			{ ...browser.state, scrollTop: 300 },
		]) {
			browser = { ...browser, state }
			await render()
		}
		expect(resolvePath).toHaveBeenCalledOnce()
		expect(button()).toBe(firstButton)
		await act(async () => button().click())
		expect(presentation.navigate).toHaveBeenCalledWith('/about', {
			id: 'about',
			type: 'page',
		})
		expect(browser.setPickerOpen).toHaveBeenCalledWith(false)
	})

	it('updates changed document, selection, disabled state, runtime and picker callback', async () => {
		await render()
		row = {
			document: { ...original, title: 'Team', pathname: '/team' },
			selected: true,
			disabled: true,
		}
		await render()
		expect(button().getAttribute('aria-label')).toBe('Team · /team')
		expect(button().getAttribute('aria-current')).toBe('page')
		expect(button().disabled).toBe(true)
		await act(async () => button().click())
		expect(presentation.navigate).not.toHaveBeenCalled()

		const oldClose = browser.setPickerOpen
		const replacement = runtime()
		vi.spyOn(replacement.model, 'documentPath').mockReturnValue(
			'/changed-prefix/team',
		)
		browser = { ...browser, runtime: replacement, setPickerOpen: vi.fn() }
		row = { ...row, selected: false, disabled: false }
		await render()
		expect(button().getAttribute('aria-current')).toBeNull()
		expect(button().getAttribute('aria-label')).toBe(
			'Team · /changed-prefix/team',
		)
		await act(async () => button().click())
		expect(presentation.navigate).toHaveBeenCalledWith('/changed-prefix/team', {
			id: 'about',
			type: 'page',
		})
		expect(oldClose).not.toHaveBeenCalled()
		expect(browser.setPickerOpen).toHaveBeenCalledWith(false)
	})

	it('receives native Presentation and status context updates through the memoized row', async () => {
		row = { document: { ...original, pathname: null } }
		await render()
		expect(button().textContent).toContain('Preview unavailable')
		expect(button().textContent).not.toContain('editing')
		expect(
			host.querySelector('[aria-label="Available versions: published"]'),
		).not.toBeNull()

		const previousNavigate = presentation.navigate
		presentation = { id: original._id, navigate: vi.fn() }
		await render()
		expect(button().textContent).toContain('Preview unavailable · editing')
		status = { versions: ['published', 'draft'], loading: false }
		await render()
		expect(
			host.querySelector('[aria-label="Available versions: published, draft"]'),
		).not.toBeNull()
		await act(async () => button().click())
		expect(previousNavigate).not.toHaveBeenCalled()
		expect(presentation.navigate).toHaveBeenCalledWith(undefined, {
			id: 'about',
			type: 'page',
		})
	})
})
