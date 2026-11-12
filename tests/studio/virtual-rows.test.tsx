// @vitest-environment jsdom
import { act, useLayoutEffect, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { VirtualRows } from '../../src/studio/pages/virtual-rows.js'

type Item = { key: string; height: number; disabled?: boolean; menu?: boolean }
const items: Item[] = Array.from({ length: 1_000 }, (_, index) => ({
	key: `${index}`,
	height: index === 0 ? 100 : 50,
}))
let root: Root
let container: HTMLDivElement
const observers = new Map<Element, Set<ResizeObserverCallback>>()

function Fixture({
	rows = items,
	warning = false,
	savedOffset = 0,
}: {
	rows?: Item[]
	warning?: boolean
	savedOffset?: number
}) {
	const scroll = useRef<HTMLDivElement>(null)
	// Match the browser owner's restoration after its descendant layout effects.
	useLayoutEffect(() => {
		if (scroll.current) scroll.current.scrollTop = savedOffset
	}, [savedOffset, rows.length])
	return (
		<div role="dialog">
			<button id="before">Search</button>
			<div
				ref={scroll}
				data-scroller=""
				style={{ height: 400, overflow: 'auto' }}
			>
				{warning && <div data-warning="">Warning</div>}
				<VirtualRows
					items={rows}
					scrollRef={scroll}
					initialOffset={savedOffset}
					estimateSize={() => 50}
					canFocus={() => true}
					renderItem={(item) => (
						<div data-height={item.height}>
							<button disabled={item.disabled} id={`item-${item.key}`}>
								Page {item.key}
							</button>
							{item.menu && <button id={`menu-${item.key}`}>Options</button>}
						</div>
					)}
				/>
			</div>
			<button id="after">Next</button>
		</div>
	)
}
function element(selector: string) {
	return container.querySelector<HTMLElement>(selector)!
}
function tab(target: HTMLElement, reverse = false) {
	const event = new KeyboardEvent('keydown', {
		key: 'Tab',
		shiftKey: reverse,
		bubbles: true,
		cancelable: true,
	})
	act(() => {
		target.focus()
		target.dispatchEvent(event)
	})
	return event
}
function scrollTo(top: number) {
	act(() => {
		const scroll = element('[data-scroller]')
		scroll.scrollTop = top
		scroll.dispatchEvent(new Event('scroll'))
	})
}

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
	container = document.createElement('div')
	document.body.append(container)
	root = createRoot(container)
	vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(320)
	vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
		function (this: HTMLElement) {
			if (this.hasAttribute('data-scroller')) return 400
			return Number(
				this.querySelector<HTMLElement>('[data-height]')?.dataset.height ?? 0,
			)
		},
	)
	vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
		function (this: HTMLElement) {
			const scroll = this.closest<HTMLElement>('[data-scroller]')
			const top = this.hasAttribute('data-pages-virtual')
				? (scroll?.querySelector('[data-warning]') ? 80 : 0) -
					(scroll?.scrollTop ?? 0)
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
			constructor(private callback: ResizeObserverCallback) {}
			observe(target: Element) {
				const callbacks = observers.get(target) ?? new Set()
				callbacks.add(this.callback)
				observers.set(target, callbacks)
			}
			unobserve(target: Element) {
				observers.get(target)?.delete(this.callback)
			}
			disconnect() {
				for (const callbacks of observers.values())
					callbacks.delete(this.callback)
			}
		},
	)
	Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
		configurable: true,
		value: function (this: HTMLElement, options: ScrollToOptions) {
			this.scrollTop = options.top ?? 0
			this.dispatchEvent(new Event('scroll'))
		},
	})
})
afterEach(() => {
	act(() => root.unmount())
	container.remove()
	observers.clear()
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

describe('measured navigator rendering', () => {
	it.each([false, true])(
		'restores saved scroll on a fresh mount and remount (initially loading: %s)',
		(loading) => {
			act(() =>
				root.render(
					<Fixture
						key="sidebar"
						rows={loading ? [] : items}
						savedOffset={25_000}
					/>,
				),
			)
			if (loading) {
				// An empty browser viewport cannot retain a deep DOM scroll position.
				element('[data-scroller]').scrollTop = 0
				act(() => root.render(<Fixture key="sidebar" savedOffset={25_000} />))
			}
			expect(element('[data-scroller]').scrollTop).toBe(25_000)
			expect(element('#item-500')).toBeTruthy()
			expect(element('#item-0')).toBeNull()
			const sidebar = element('[data-scroller]')
			scrollTo(30_000)
			const saved = sidebar.scrollTop
			act(() => root.render(<Fixture key="picker" savedOffset={saved} />))
			expect(element('[data-scroller]')).not.toBe(sidebar)
			expect(element('[data-scroller]').scrollTop).toBe(saved)
			expect(element('#item-600')).toBeTruthy()
			expect(element('#item-0')).toBeNull()
			expect(
				container.querySelectorAll('[data-pages-row-key]').length,
			).toBeLessThan(30)
		},
	)
	it('bounds mounted rows, measures wrapping, and renders distant rows on continuous scroll', () => {
		act(() => root.render(<Fixture />))
		expect(
			container.querySelectorAll('[data-pages-row-key]').length,
		).toBeLessThan(30)
		expect(element('[data-pages-virtual]').style.height).toBe('50050px')
		expect(element('[data-pages-row-key="1"]').style.transform).toBe(
			'translateY(100px)',
		)
		scrollTo(25_000)
		expect(element('#item-500')).toBeTruthy()
		expect(element('#item-0')).toBeNull()
		expect(
			container.querySelectorAll('[data-pages-row-key]').length,
		).toBeLessThan(30)
	})
	it('remeasures a wrapped row and keeps warning offsets out of item positions', () => {
		act(() => root.render(<Fixture />))
		const row = element('[data-pages-row-key="0"]')
		act(() => {
			for (const callback of observers.get(row) ?? [])
				callback(
					[
						{
							target: row,
							borderBoxSize: [{ blockSize: 150, inlineSize: 320 }],
						} as unknown as ResizeObserverEntry,
					],
					{} as ResizeObserver,
				)
		})
		expect(element('[data-pages-row-key="1"]').style.transform).toBe(
			'translateY(150px)',
		)
		act(() => root.render(<Fixture warning />))
		expect(element('[data-pages-row-key="1"]').style.transform).toBe(
			'translateY(150px)',
		)
	})
	it('tabs across window boundaries in both directions without losing two-control row order', () => {
		const rows = items.map((item) => ({ ...item, menu: true }))
		act(() => root.render(<Fixture rows={rows} />))
		const last = Array.from(
			container.querySelectorAll<HTMLElement>('[data-pages-row-key]'),
		).at(-1)!
		const index = Number(last.dataset.pagesRowKey)
		expect(tab(element(`#item-${index}`)).defaultPrevented).toBe(false)
		tab(element(`#menu-${index}`))
		expect(document.activeElement?.id).toBe(`item-${index + 1}`)
		tab(element(`#item-${index + 1}`), true)
		expect(document.activeElement?.id).toBe(`menu-${index}`)
	})
	it('skips disabled rows and leaves the first/last logical rows into surrounding controls', () => {
		const rows = items.map((item, index) => ({
			...item,
			disabled: index === 1,
		}))
		act(() => root.render(<Fixture rows={rows} />))
		tab(element('#item-0'))
		expect(document.activeElement?.id).toBe('item-2')
		tab(element('#item-0'), true)
		expect(document.activeElement?.id).toBe('before')
		act(() => {
			element('#after').focus()
			element('[data-pages-boundary="end"]').focus()
		})
		expect(document.activeElement?.id).toBe('item-999')
		tab(element('#item-999'))
		expect(document.activeElement?.id).toBe('after')
	})
	it('pins a menu/dialog trigger while focus is outside the list, and returns to that same element', () => {
		act(() => root.render(<Fixture />))
		const trigger = element('#item-0')
		act(() => {
			trigger.focus()
			element('#after').focus()
		})
		scrollTo(25_000)
		expect(element('#item-0')).toBe(trigger)
		expect(
			trigger.closest<HTMLElement>('[data-pages-row-key]')!.style.zIndex,
		).toBe('1')
		act(() => trigger.focus())
		expect(document.activeElement).toBe(trigger)
	})
	it('preserves native small-list flow and recovers focus when a focused descendant is collapsed', () => {
		act(() => root.render(<Fixture />))
		act(() => element('#item-2').focus())
		act(() => root.render(<Fixture rows={[items[0]!]} />))
		expect(document.activeElement?.id).toBe('item-0')
		expect(element('[data-pages-virtual]').style.height).toBe('')
		expect(element('[data-pages-boundary]')).toBeNull()
	})
})
