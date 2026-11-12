// @vitest-environment jsdom
import { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import FocusLockModule from 'react-focus-lock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VirtualRows } from '../../src/studio/pages/virtual-rows.js'

const FocusLock = FocusLockModule.default ?? FocusLockModule
const rows = Array.from({ length: 100 }, (_, index) => ({ key: `${index}` }))
let root: Root
let host: HTMLDivElement

function Fixture({
	locked = true,
	disabled = false,
}: {
	locked?: boolean
	disabled?: boolean
}) {
	const scroll = useRef<HTMLDivElement>(null)
	const content = (
		<div role="dialog" aria-modal={locked}>
			<input aria-label="Search pages" id="search" />
			<div style={{ display: 'none' }}>
				<button id="hidden-before">Hidden before</button>
			</div>
			<div
				ref={scroll}
				data-scroller=""
				style={{ height: 300, overflow: 'auto' }}
			>
				<VirtualRows
					items={rows}
					scrollRef={scroll}
					estimateSize={() => 50}
					canFocus={() => !disabled}
					renderItem={(row) => (
						<button disabled={disabled} id={`row-${row.key}`}>
							Page {row.key}
						</button>
					)}
				/>
			</div>
			<div style={{ display: 'none' }}>
				<button id="hidden-after">Hidden after</button>
			</div>
		</div>
	)
	return (
		<>
			<button id="outside-before">Outside before</button>
			{locked ? <FocusLock returnFocus={false}>{content}</FocusLock> : content}
			<button id="outside-after">Outside after</button>
		</>
	)
}
function find(selector: string) {
	return host.querySelector<HTMLElement>(selector)!
}
async function focus(selector: string) {
	await act(async () => {
		find(selector).focus()
		await new Promise((resolve) => setTimeout(resolve, 5))
	})
}
async function tab(selector: string, reverse = false) {
	await act(async () => {
		const target = find(selector)
		target.focus()
		target.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: 'Tab',
				shiftKey: reverse,
				bubbles: true,
				cancelable: true,
			}),
		)
		await new Promise((resolve) => setTimeout(resolve, 5))
	})
}
beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
	host = document.createElement('div')
	document.body.append(host)
	root = createRoot(host)
	vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(320)
	vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
		function (this: HTMLElement) {
			return this.hasAttribute('data-scroller') ? 300 : 50
		},
	)
	vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
		function (this: HTMLElement) {
			const top = this.hasAttribute('data-pages-virtual')
				? -(this.closest<HTMLElement>('[data-scroller]')?.scrollTop ?? 0)
				: 0
			return {
				x: 0,
				y: top,
				top,
				left: 0,
				width: 320,
				height: this.offsetHeight,
				right: 320,
				bottom: top + this.offsetHeight,
				toJSON: () => ({}),
			}
		},
	)
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	)
	Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
		configurable: true,
		value: function (this: HTMLElement, options: ScrollToOptions | number) {
			this.scrollTop =
				typeof options === 'number' ? options : (options.top ?? 0)
			this.dispatchEvent(new Event('scroll'))
		},
	})
})
afterEach(() => {
	act(() => root.unmount())
	host.remove()
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

describe('virtual rows inside the native picker focus lock', () => {
	it('leaves the last logical row through the real lock guard and returns to search', async () => {
		act(() => root.render(<Fixture />))
		// JSDOM has no default Tab navigation. Focus the boundary that a browser
		// reaches, then test the renderer and real FocusLock event handling.
		await focus('[data-pages-boundary="end"]')
		expect(document.activeElement?.id).toBe('row-99')
		await tab('#row-99')
		expect(document.activeElement?.id).toBe('search')
		await focus('[data-pages-boundary="start"]')
		expect(document.activeElement?.id).toBe('row-0')
		await tab('#row-0', true)
		expect(document.activeElement?.id).toBe('search')
	})
	it('wraps backward through the real leading guard into the last logical row', async () => {
		act(() => root.render(<Fixture />))
		await focus('#search')
		await focus('[data-focus-guard]')
		expect(document.activeElement?.id).toBe('row-99')
	})
	it('skips controls in hidden ancestors when leaving an unlocked navigator', async () => {
		act(() => root.render(<Fixture locked={false} />))
		await focus('[data-pages-boundary="end"]')
		await tab('#row-99')
		expect(document.activeElement?.id).toBe('outside-after')
		await focus('[data-pages-boundary="start"]')
		await tab('#row-0', true)
		expect(document.activeElement?.id).toBe('search')
	})
	it('returns to the available search control when all logical rows are disabled', async () => {
		act(() => root.render(<Fixture disabled />))
		await focus('[data-pages-boundary="start"]')
		expect(document.activeElement?.id).toBe('search')
	})
})
