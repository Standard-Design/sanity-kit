// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ThemeProvider } from '@sanity/ui'
import { buildTheme } from '@sanity/ui/theme'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SanityUrlInputProps } from '../../src/studio/url/input.js'

const native = vi.hoisted(() => ({
	document: {
		_id: 'drafts.page1',
		_type: 'page',
		_rev: 'r1',
		title: 'Team',
		pathname: { current: '/about/team' },
	},
	client: {},
	workspace: { projectId: 'project', dataset: 'test', getClient: vi.fn() },
	schema: { get: () => ({ liveEdit: false }) },
	onChange: vi.fn(),
	load: vi.fn(),
	prepare: vi.fn(),
	createFolder: vi.fn(),
	invalidate: vi.fn(),
}))

vi.mock('sanity', () => ({
	useFormValue: () => native.document,
	useClient: () => native.client,
	useWorkspace: () => native.workspace,
	useSchema: () => native.schema,
	useCurrentUser: () => null,
	set: (value: unknown, path: unknown) => ({ type: 'set', value, path }),
	setIfMissing: (value: unknown) => ({ type: 'setIfMissing', value }),
}))
vi.mock('../../src/studio/url/edit.js', () => ({
	createUrlEditController: () => ({
		load: native.load,
		prepare: native.prepare,
		createFolder: native.createFolder,
		invalidate: native.invalidate,
	}),
}))

// Real input and picker together: local folder creation must not be mistaken for
// a read-only transition or a page URL save when the parent rerenders as busy.
import { SanityUrlInput } from '../../src/studio/url/input.js'
import { URL_AUTOSAVE_DELAY_MS } from '../../src/studio/url/autosave.js'

const theme = buildTheme()
const routes = {
	pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
}

describe('URL field and folder picker integration', () => {
	let root: Root
	let container: HTMLDivElement
	let props: SanityUrlInputProps
	let finishCreate: (result: unknown) => void
	beforeEach(() => {
		vi.clearAllMocks()
		vi.useFakeTimers()
		Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
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
		native.document = {
			_id: 'drafts.page1',
			_type: 'page',
			_rev: 'r1',
			title: 'Team',
			pathname: { current: '/about/team' },
		}
		native.load.mockResolvedValue({
			status: 'loaded',
			folders: [{ pathname: '/about' }],
			editable: true,
		})
		native.createFolder.mockImplementation(
			() =>
				new Promise((resolve) => {
					finishCreate = resolve
				}),
		)
		native.prepare.mockResolvedValue({
			status: 'ready',
			candidate: {
				storedValue: '/about/company/people/team',
				fieldPath: 'pathname.current',
				url: {
					pathname: '/about/company/people/team',
					prefix: '/about/company/people',
					slug: 'team',
				},
			},
		})
		props = {
			routes,
			value: { _type: 'slug', current: '/about/team' },
			schemaType: {
				name: 'slug',
				jsonType: 'object',
				options: { source: 'title' },
			},
			path: ['pathname'],
			readOnly: false,
			onChange: native.onChange,
			elementProps: { id: 'url' },
		} as unknown as SanityUrlInputProps
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
					<SanityUrlInput {...props} />
				</ThemeProvider>,
			)
			await Promise.resolve()
		})
	}
	function button(name: string) {
		const found = [...document.querySelectorAll('button')].find(
			(item) =>
				item.getAttribute('aria-label') === name || item.textContent === name,
		)
		if (!found) throw new Error(`Missing button: ${name}`)
		return found
	}
	async function click(name: string) {
		await act(async () => {
			button(name).click()
			await Promise.resolve()
		})
	}
	async function beginCreate() {
		await click('Change folder: /about')
		await click('New subfolder')
		act(() => {
			const input = document.querySelector<HTMLInputElement>(
				'input[placeholder="team or company/team"]',
			)!
			Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				'value',
			)!.set!.call(input, 'about/company/people')
			input.dispatchEvent(new Event('input', { bubbles: true }))
		})
		await click('Create and use folder')
	}

	it('saves the folder once, retains the pending modal, and autosaves the selected URL after the debounce', async () => {
		await render()
		await beginCreate()
		expect(native.createFolder).toHaveBeenCalledExactlyOnceWith({
			document: native.document,
			pathname: '/about/company/people',
			readOnly: false,
		})
		expect(document.querySelector('[role="dialog"]')).not.toBeNull()
		expect(button('Creating folder…').disabled).toBe(true)
		expect(native.onChange).not.toHaveBeenCalled()
		await click('Creating folder…')
		expect(native.createFolder).toHaveBeenCalledOnce()
		await act(async () => {
			await vi.advanceTimersByTimeAsync(URL_AUTOSAVE_DELAY_MS)
		})
		expect(native.prepare).not.toHaveBeenCalled()
		expect(native.onChange).not.toHaveBeenCalled()
		await act(async () => {
			finishCreate({ status: 'saved' })
			await Promise.resolve()
		})
		expect(document.querySelector('[role="dialog"]')).toBeNull()
		expect(button('Change folder: /about/company/people')).toBeTruthy()
		expect(container.textContent).toContain('/about/company/people/team')
		expect(native.onChange).not.toHaveBeenCalled()
		expect(native.prepare).not.toHaveBeenCalled()
		await act(async () => {
			await vi.advanceTimersByTimeAsync(URL_AUTOSAVE_DELAY_MS - 1)
		})
		expect(native.prepare).not.toHaveBeenCalled()
		expect(native.onChange).not.toHaveBeenCalled()
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1)
		})
		expect(native.prepare).toHaveBeenCalledExactlyOnceWith(
			{
				document: native.document,
				storedValue: '/about/company/people/team',
				readOnly: false,
			},
			expect.any(AbortSignal),
		)
		expect(native.onChange).toHaveBeenCalledExactlyOnceWith([
			{ type: 'setIfMissing', value: { _type: 'slug' } },
			{ type: 'set', value: '/about/company/people/team', path: ['current'] },
		])
	})

	it('keeps a failed folder creation in the modal without changing the page URL', async () => {
		await render()
		await beginCreate()
		await act(async () => {
			finishCreate({ status: 'blocked', reason: 'folder-outcome-unknown' })
			await Promise.resolve()
		})
		await act(async () => {
			await vi.advanceTimersByTimeAsync(URL_AUTOSAVE_DELAY_MS)
		})
		expect(document.querySelector('[role="dialog"]')).not.toBeNull()
		expect(document.querySelector('[role="alert"]')?.textContent).toContain(
			'could not be confirmed',
		)
		expect(native.onChange).not.toHaveBeenCalled()
		expect(button('Change folder: /about')).toBeTruthy()
	})

	it('does not select a completed folder into a different document', async () => {
		await render()
		await beginCreate()
		native.document = { ...native.document, _id: 'drafts.page2' }
		await render()
		await act(async () => {
			finishCreate({ status: 'saved' })
			await Promise.resolve()
		})
		await act(async () => {
			await vi.advanceTimersByTimeAsync(URL_AUTOSAVE_DELAY_MS)
		})
		expect(document.querySelector('[role="dialog"]')).toBeNull()
		expect(button('Change folder: /about')).toBeTruthy()
		expect(native.onChange).not.toHaveBeenCalled()
	})

	it('waits for an aborted autosave to settle before creating a folder', async () => {
		let finishPrepare!: (result: unknown) => void
		native.prepare.mockReturnValueOnce(
			new Promise((resolve) => {
				finishPrepare = resolve
			}),
		)
		await render()
		act(() => {
			const input = container.querySelector<HTMLInputElement>(
				'input[aria-label="URL slug"]',
			)!
			Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				'value',
			)!.set!.call(input, 'leadership')
			input.dispatchEvent(new Event('input', { bubbles: true }))
		})
		await act(async () => {
			await vi.advanceTimersByTimeAsync(URL_AUTOSAVE_DELAY_MS)
		})
		expect(native.prepare).toHaveBeenCalledOnce()
		const signal = native.prepare.mock.calls[0]?.[1] as AbortSignal
		expect(signal.aborted).toBe(false)
		await beginCreate()
		expect(signal.aborted).toBe(true)
		expect(native.createFolder).not.toHaveBeenCalled()
		expect(button('Creating folder…').disabled).toBe(true)
		await act(async () => {
			finishPrepare({
				status: 'ready',
				candidate: {
					storedValue: '/about/leadership',
					fieldPath: 'pathname.current',
					url: {
						pathname: '/about/leadership',
						prefix: '/about',
						slug: 'leadership',
					},
				},
			})
			await Promise.resolve()
		})
		expect(native.onChange).not.toHaveBeenCalled()
		expect(native.createFolder).toHaveBeenCalledExactlyOnceWith({
			document: native.document,
			pathname: '/about/company/people',
			readOnly: false,
		})
		await act(async () => {
			finishCreate({ status: 'saved' })
			await Promise.resolve()
		})
		expect(button('Change folder: /about/company/people')).toBeTruthy()
		expect(container.textContent).toContain('/about/company/people/leadership')
		expect(native.onChange).not.toHaveBeenCalled()
	})
})
