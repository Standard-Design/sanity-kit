// @vitest-environment jsdom

import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ThemeProvider } from '@sanity/ui'
import { buildTheme } from '@sanity/ui/theme'
import type { PreviewHeaderProps } from 'sanity/presentation'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
	navigate: vi.fn(),
	intent: vi.fn(),
	fetch: vi.fn(),
	unsubscribe: vi.fn(),
	params: { preview: '/about', id: 'shared', type: 'kitProofShared' },
}))

vi.mock('sanity', () => {
	const client = {
		fetch: native.fetch,
		listen: () => ({ subscribe: () => ({ unsubscribe: native.unsubscribe }) }),
	}
	return {
		definePlugin: (factory: unknown) => factory,
		useClient: () => client,
		usePerspective: () => ({ perspectiveStack: ['drafts'] }),
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
import { ProofBrowser } from '../fixtures/pages-studio/proof-browser.js'
import { ProofHeader } from '../fixtures/pages-studio/presentation-adapter.js'

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
				<button onClick={header.toggleNavigator}>Toggle native sidebar</button>
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
		native.fetch.mockResolvedValue([
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
		])
		container = document.createElement('div')
		document.body.append(container)
		root = createRoot(container)
	})
	afterEach(() => {
		act(() => root.unmount())
		container.remove()
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

	it('preserves native controls and search through navigator unmount and picker mount', async () => {
		await render()
		expect(button('Native refresh')).toBeTruthy()
		expect(document.querySelector('[aria-haspopup="dialog"]')).toBeNull()
		const input = document.querySelector('input')!
		act(() => {
			Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				'value',
			)!.set!.call(input, 'Team')
			input.dispatchEvent(new Event('input', { bubbles: true }))
		})
		await click('Toggle native sidebar')
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
		await click('Toggle native sidebar')
		expect(document.querySelector('input')?.value).toBe('Team')
	})

	it('dismisses on Escape and when reopening the native sidebar', async () => {
		await render()
		await click('Toggle native sidebar')
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
		await click('Toggle native sidebar')
		expect(document.querySelector('[role="dialog"]')).toBeNull()
		expect(document.querySelector('[aria-haspopup="dialog"]')).toBeNull()
	})

	it.each(['loaded', 'empty', 'loading'] as const)(
		'keeps focus inside the modal picker with %s results',
		async (state) => {
			if (state === 'empty') native.fetch.mockResolvedValue([])
			if (state === 'loading')
				native.fetch.mockReturnValue(new Promise(() => {}))
			await render()
			await click('Toggle native sidebar')
			await click('Choose page')
			const dialog = document.querySelector('[role="dialog"]')!
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

	it('unsubscribes from the dataset when the browser leaves the tool', async () => {
		await render()
		act(() => root.render(null))
		expect(native.unsubscribe).toHaveBeenCalledTimes(2)
	})
})
