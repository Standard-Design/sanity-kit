// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const overlayModule = vi.hoisted(() => ({ loads: 0 }))

vi.mock('@sanity/visual-editing/react-router', () => {
	overlayModule.loads += 1

	return {
		VisualEditing: ({ keepStegaOnCopy }: { keepStegaOnCopy?: boolean }) => (
			<div data-keep-stega-on-copy={String(Boolean(keepStegaOnCopy))}>
				Visual Editing
			</div>
		),
	}
})

import {
	SanityPreviewExit,
	SanityVisualEditing,
} from '../../src/react-router/visual-editing/index.js'

describe('Visual Editing browser lifecycle', () => {
	let container: HTMLDivElement
	let root: Root

	beforeEach(() => {
		Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
		container = document.createElement('div')
		document.body.append(container)
		root = createRoot(container)
	})

	afterEach(() => {
		act(() => root.unmount())
		container.remove()
		Object.defineProperty(window, 'opener', {
			configurable: true,
			value: null,
		})
	})

	it('loads the overlay only after preview becomes enabled', async () => {
		act(() => {
			root.render(
				<SanityVisualEditing enabled={false}>
					<span>Preview controls</span>
				</SanityVisualEditing>,
			)
		})

		expect(container.innerHTML).toBe('')
		expect(overlayModule.loads).toBe(0)

		await act(async () => {
			root.render(
				<SanityVisualEditing enabled keepStegaOnCopy>
					<span>Preview controls</span>
				</SanityVisualEditing>,
			)
			await Promise.resolve()
		})

		expect(overlayModule.loads).toBe(1)
		expect(container.textContent).toBe('Visual EditingPreview controls')
		expect(
			container.querySelector('[data-keep-stega-on-copy="true"]'),
		).not.toBeNull()
	})

	it('shows the standalone exit link only after browser mount', () => {
		act(() => {
			root.render(<SanityPreviewExit href="/preview/disable" />)
		})

		expect(container.innerHTML).toBe(
			'<a href="/preview/disable">Disable preview mode</a>',
		)
	})

	it('hides the standalone exit link in a preview popup', () => {
		Object.defineProperty(window, 'opener', {
			configurable: true,
			value: window,
		})

		act(() => {
			root.render(<SanityPreviewExit href="/preview/disable" />)
		})

		expect(container.innerHTML).toBe('')
	})
})
