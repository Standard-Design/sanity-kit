// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ThemeProvider } from '@sanity/ui'
import { buildTheme } from '@sanity/ui/theme'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	FolderPicker,
	type FolderPickerProps,
} from '../../src/studio/url/folder-picker.js'

const theme = buildTheme()

describe('URL folder picker', () => {
	let root: Root
	let container: HTMLDivElement
	let props: FolderPickerProps
	beforeEach(() => {
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
		container = document.createElement('div')
		document.body.append(container)
		root = createRoot(container)
		props = {
			value: '/about/company',
			folders: [{ pathname: '/about/company' }, { pathname: '/services' }],
			onChange: vi.fn(),
			onCreate: vi.fn(() => Promise.resolve({ ok: true as const })),
		}
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
					<FolderPicker {...props} />
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
	function fill(value: string) {
		act(() => {
			const input = document.querySelector('input')!
			Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				'value',
			)!.set!.call(input, value)
			input.dispatchEvent(new Event('input', { bubbles: true }))
		})
	}
	async function openCreation() {
		await click(`Change folder: ${props.value}`)
		await click('New subfolder')
	}

	it('uses folder names and indentation, and selects immediately without confirmation buttons', async () => {
		await render()
		await click('Change folder: /about/company')
		expect(button('Select folder /about').textContent).toBe('About')
		expect(button('Select folder /about/company').textContent).toBe('Company')
		expect(
			parseInt(button('Select folder /about/company').style.paddingLeft),
		).toBeGreaterThan(
			parseInt(button('Select folder /about').style.paddingLeft),
		)
		expect(button('Select folder /').textContent).toBe('Site root')
		expect(document.body.textContent).not.toContain('Use folder')
		await click('Select folder /services')
		expect(props.onChange).toHaveBeenCalledWith('/services')
		expect(document.querySelector('[role="dialog"]')).toBeNull()
		expect(props.onCreate).not.toHaveBeenCalled()
	})

	it('creates nested folders from a root-default modal and waits for persistence before selecting', async () => {
		let resolve!: (value: { ok: true }) => void
		props.onCreate = vi.fn(
			() =>
				new Promise<{ ok: true }>((done) => {
					resolve = done
				}),
		)
		await render()
		await openCreation()
		expect(button('Nest inside: /').textContent).toBe('Site root')
		fill('resources//guides/')
		expect(document.querySelector('output')?.textContent).toBe(
			'/resources/guides',
		)
		await click('Create and use folder')
		expect(props.onCreate).toHaveBeenCalledWith('/resources/guides')
		expect(props.onChange).not.toHaveBeenCalled()
		expect(button('Cancel').disabled).toBe(true)
		await act(async () => {
			resolve({ ok: true })
			await Promise.resolve()
		})
		expect(props.onChange).toHaveBeenCalledWith('/resources/guides')
		expect(document.querySelector('[role="dialog"]')).toBeNull()
	})

	it('chooses a parent in a nested popover without closing the creation modal', async () => {
		await render()
		await openCreation()
		fill('team/people')
		await click('Nest inside: /')
		expect(
			document.querySelector('[aria-label="Parent folders"]'),
		).not.toBeNull()
		await click('Nest inside /about/company')
		expect(document.querySelector('[aria-label="Parent folders"]')).toBeNull()
		expect(document.querySelector('input')?.value).toBe('team/people')
		expect(document.querySelector('output')?.textContent).toBe(
			'/about/company/team/people',
		)
		await click('Create and use folder')
		expect(props.onCreate).toHaveBeenCalledWith('/about/company/team/people')
	})

	it.each([
		'/elsewhere',
		'../escape',
		'team/../escape',
		'team%2fpeople',
		'team?x=1',
		'team#part',
		'team name',
		'%zz',
	])('refuses unsafe relative folder %s', async (value) => {
		await render()
		await openCreation()
		fill(value)
		expect(button('Create and use folder').disabled).toBe(true)
		expect(document.querySelector('[role="alert"]')).not.toBeNull()
		await click('Create and use folder')
		expect(props.onCreate).not.toHaveBeenCalled()
	})

	it('reports an existing folder without asking the writer to recreate it', async () => {
		await render()
		await openCreation()
		fill('about/company')
		expect(document.querySelector('[role="alert"]')?.textContent).toContain(
			'already exists',
		)
		expect(button('Create and use folder').disabled).toBe(true)
	})

	it('keeps failed creation open with the supplied recovery message', async () => {
		props.onCreate = vi.fn(() =>
			Promise.resolve({
				ok: false as const,
				message: 'Refresh folders before trying again.',
			}),
		)
		await render()
		await openCreation()
		fill('team')
		await click('Create and use folder')
		expect(document.querySelector('[role="alert"]')?.textContent).toBe(
			'Refresh folders before trying again.',
		)
		expect(document.querySelector('input')?.value).toBe('team')
		expect(props.onChange).not.toHaveBeenCalled()
	})

	it('never displays raw rejected error details', async () => {
		props.onCreate = vi.fn(() =>
			Promise.reject(new Error('sensitive request details')),
		)
		await render()
		await openCreation()
		fill('team')
		await click('Create and use folder')
		expect(document.querySelector('[role="alert"]')?.textContent).toContain(
			'could not be saved',
		)
		expect(document.body.textContent).not.toContain('sensitive request')
	})

	it('disables changes when read-only, including a pending creation completion', async () => {
		let resolve!: (value: { ok: true }) => void
		props.onCreate = vi.fn(
			() =>
				new Promise<{ ok: true }>((done) => {
					resolve = done
				}),
		)
		await render()
		await openCreation()
		fill('team')
		await click('Create and use folder')
		props.readOnly = true
		await render()
		expect(button('Change folder: /about/company').disabled).toBe(true)
		expect(document.querySelector('[role="dialog"]')).toBeNull()
		await act(async () => {
			resolve({ ok: true })
			await Promise.resolve()
		})
		expect(props.onChange).not.toHaveBeenCalled()
	})

	it('offers retry and suppresses creation while the folder list is unavailable', async () => {
		props.error = 'The folder list could not be loaded.'
		props.onRetry = vi.fn()
		await render()
		await click('Change folder: /about/company')
		expect(button('New subfolder').disabled).toBe(true)
		await click('Retry loading folders')
		expect(props.onRetry).toHaveBeenCalledOnce()
		await click('Select folder /')
		expect(props.onChange).toHaveBeenCalledWith('/')
	})

	it('Escape dismisses only the parent picker before dismissing the modal', async () => {
		await render()
		await openCreation()
		await click('Nest inside: /')
		act(() => {
			button('Nest inside /about').dispatchEvent(
				new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
			)
		})
		expect(document.querySelector('[aria-label="Parent folders"]')).toBeNull()
		expect(document.querySelector('input')).not.toBeNull()
		expect(props.onChange).not.toHaveBeenCalled()
		await click('Cancel')
		expect(document.querySelector('[role="dialog"]')).toBeNull()
	})

	it('does not reuse a pending completion after read-only is lifted', async () => {
		let resolve!: (value: { ok: true }) => void
		props.onCreate = vi.fn(
			() =>
				new Promise<{ ok: true }>((done) => {
					resolve = done
				}),
		)
		await render()
		await openCreation()
		fill('team')
		await click('Create and use folder')
		props.readOnly = true
		await render()
		props.readOnly = false
		await render()
		await act(async () => {
			resolve({ ok: true })
			await Promise.resolve()
		})
		expect(props.onChange).not.toHaveBeenCalled()
	})

	it('contains focus in the folder popover and Escape returns to its trigger', async () => {
		await render()
		const trigger = button('Change folder: /about/company')
		act(() => trigger.focus())
		await click('Change folder: /about/company')
		const dialog = document.querySelector('[aria-label="Choose folder"]')!
		act(() => trigger.focus())
		expect(dialog.contains(document.activeElement)).toBe(true)
		await act(async () => {
			document.activeElement?.dispatchEvent(
				new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
			)
			await Promise.resolve()
		})
		expect(document.querySelector('[aria-label="Choose folder"]')).toBeNull()
		expect(document.activeElement).toBe(trigger)
	})
})
