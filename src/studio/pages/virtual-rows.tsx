/** Measured rendering only: navigation, native controls and data stay with callers. */
import {
	defaultRangeExtractor,
	observeElementRect,
	measureElement,
	useVirtualizer,
} from '@tanstack/react-virtual'
import {
	useLayoutEffect,
	useRef,
	useState,
	type ReactNode,
	type RefObject,
} from 'react'

const SMALL_LIST = 60
const OVERSCAN = 6
const controlSelector = 'button, a[href], input, select, textarea, [tabindex]'

function controls(root: HTMLElement): HTMLElement[] {
	return Array.from(root.querySelectorAll<HTMLElement>(controlSelector)).filter(
		(element) => {
			if (
				element.tabIndex < 0 ||
				element.matches(':disabled') ||
				element.closest('[hidden], [inert]')
			)
				return false
			for (
				let ancestor: HTMLElement | null = element;
				ancestor;
				ancestor = ancestor.parentElement
			) {
				const style = getComputedStyle(ancestor)
				if (style.display === 'none' || style.visibility === 'hidden')
					return false
			}
			return true
		},
	)
}

export function VirtualRows<T extends { key: string }>({
	items,
	scrollRef,
	initialOffset = 0,
	estimateSize,
	canFocus,
	renderItem,
}: {
	items: readonly T[]
	scrollRef: RefObject<HTMLDivElement | null>
	initialOffset?: number
	estimateSize: (item: T) => number
	canFocus: (item: T) => boolean
	renderItem: (item: T) => ReactNode
}) {
	const root = useRef<HTMLDivElement>(null)
	const [pinned, setPinned] = useState<string>()
	const [pending, setPending] = useState<{ key: string; reverse: boolean }>()
	const focused = useRef<{ element: HTMLElement; key: string } | undefined>(
		undefined,
	)
	const previous = useRef(items)
	const [margin, setMargin] = useState(0)
	const virtual = items.length > SMALL_LIST
	const pinnedIndex = items.findIndex((item) => item.key === pinned)
	const pendingIndex = items.findIndex((item) => item.key === pending?.key)
	const virtualizer = useVirtualizer({
		count: items.length,
		enabled: virtual,
		getScrollElement: () => scrollRef.current,
		getItemKey: (index) => items[index]!.key,
		estimateSize: (index) => estimateSize(items[index]!),
		overscan: OVERSCAN,
		scrollMargin: margin,
		// The DOM ref is still null when the first range is calculated. Seed from
		// the shared browser state, before attaching can overwrite its restoration.
		initialOffset,
		// A hidden picker has no rect yet. Keep a bounded first window until it opens.
		initialRect: { width: 320, height: 600 },
		observeElementRect: (instance, callback) =>
			observeElementRect(instance, (rect) => {
				if (rect.height > 0 && rect.width > 0) callback(rect)
			}),
		measureElement: (element, entry, instance) => {
			const size = measureElement(element, entry, instance)
			if (size > 0) return size
			const index = instance.indexFromElement(element)
			return (
				instance.itemSizeCache.get(instance.options.getItemKey(index)) ??
				instance.options.estimateSize(index)
			)
		},
		rangeExtractor: (range) =>
			[
				...new Set([
					...defaultRangeExtractor(range),
					...(pinnedIndex < 0 ? [] : [pinnedIndex]),
					...(pendingIndex < 0 ? [] : [pendingIndex]),
				]),
			].sort((a, b) => a - b),
	})
	useLayoutEffect(() => {
		const list = root.current
		const scroll = scrollRef.current
		if (!list || !scroll) return
		const update = () =>
			setMargin(
				list.getBoundingClientRect().top -
					scroll.getBoundingClientRect().top +
					scroll.scrollTop,
			)
		update()
		const observer = new ResizeObserver(update)
		observer.observe(scroll)
		for (const child of scroll.children) observer.observe(child)
		return () => observer.disconnect()
	})

	function focusRow(index: number, reverse: boolean) {
		const item = items[index]
		if (!item) return
		setPending({ key: item.key, reverse })
		setPinned(item.key)
		if (virtual) virtualizer.scrollToIndex(index, { align: 'auto' })
	}
	function adjacent(index: number, reverse: boolean) {
		for (
			let next = index + (reverse ? -1 : 1);
			next >= 0 && next < items.length;
			next += reverse ? -1 : 1
		) {
			if (canFocus(items[next]!)) return next
		}
		return -1
	}
	function leave(reverse: boolean) {
		const list = root.current
		if (!list) return
		const all = controls(list.ownerDocument.body)
		const boundary = list.querySelector<HTMLElement>(
			`[data-pages-boundary="${reverse ? 'start' : 'end'}"]`,
		)
		const index = boundary ? all.indexOf(boundary) : -1
		for (
			let next = index + (reverse ? -1 : 1);
			next >= 0 && next < all.length;
			next += reverse ? -1 : 1
		) {
			if (!list.contains(all[next]!)) {
				all[next]!.focus()
				return
			}
		}
	}
	useLayoutEffect(() => {
		if (!pending) return
		const row = Array.from(
			root.current?.querySelectorAll<HTMLElement>('[data-pages-row-key]') ?? [],
		).find((element) => element.dataset.pagesRowKey === pending.key)
		if (!row) return
		const targets = controls(row)
		const target = pending.reverse ? targets.at(-1) : targets[0]
		if (target) {
			target.focus({ preventScroll: true })
			setPending(undefined)
		} else {
			// A permission/status update may disable every control in this row.
			const next = adjacent(pendingIndex, pending.reverse)
			if (next >= 0) focusRow(next, pending.reverse)
			else {
				setPending(undefined)
				leave(pending.reverse)
			}
		}
	})
	useLayoutEffect(() => {
		const last = focused.current
		if (
			last &&
			!last.element.isConnected &&
			document.activeElement === document.body
		) {
			const before = previous.current.findIndex((item) => item.key === last.key)
			for (let index = before - 1; index >= 0; index--) {
				const surviving = items.findIndex(
					(item) => item.key === previous.current[index]!.key && canFocus(item),
				)
				if (surviving >= 0) {
					focusRow(surviving, false)
					previous.current = items
					return
				}
			}
			const first = adjacent(-1, false)
			if (first >= 0) focusRow(first, false)
			else
				scrollRef.current?.parentElement
					?.querySelector<HTMLElement>('input, [data-pages-view-heading]')
					?.focus({ preventScroll: true })
		}
		previous.current = items
	}, [items])
	const window = virtual
		? virtualizer.getVirtualItems()
		: items.map((item, index) => ({ key: item.key, index, start: 0 }))
	const boundaryStyle = {
		position: 'absolute' as const,
		width: 1,
		height: 1,
		overflow: 'hidden',
		clipPath: 'inset(50%)',
	}
	return (
		<div
			ref={root}
			data-pages-virtual=""
			data-pages-logical-count={items.length}
			data-pages-rendered-count={window.length}
			style={{
				position: 'relative',
				...(virtual ? { height: virtualizer.getTotalSize() } : {}),
			}}
			onFocusCapture={(event) => {
				const row = (event.target as HTMLElement).closest<HTMLElement>(
					'[data-pages-row-key]',
				)
				if (!row?.dataset.pagesRowKey) return
				setPinned(row.dataset.pagesRowKey)
				focused.current = {
					element: event.target,
					key: row.dataset.pagesRowKey,
				}
			}}
			onPointerDownCapture={(event) => {
				const key = (event.target as HTMLElement).closest<HTMLElement>(
					'[data-pages-row-key]',
				)?.dataset.pagesRowKey
				if (key) setPinned(key)
			}}
			onKeyDown={(event) => {
				if (!virtual || event.key !== 'Tab' || event.defaultPrevented) return
				const target = event.target as HTMLElement
				const row = target.closest<HTMLElement>('[data-pages-row-key]')
				if (!row) return
				const overlay = target.closest('[role="menu"], [role="dialog"]')
				if (overlay && row.contains(overlay)) return
				const targets = controls(row)
				if (target !== (event.shiftKey ? targets[0] : targets.at(-1))) return
				const index = items.findIndex(
					(item) => item.key === row.dataset.pagesRowKey,
				)
				const next = adjacent(index, event.shiftKey)
				event.preventDefault()
				if (next >= 0) focusRow(next, event.shiftKey)
				else leave(event.shiftKey)
			}}
		>
			{virtual && (
				<span
					tabIndex={0}
					data-pages-boundary="start"
					style={boundaryStyle}
					onFocus={(event) => {
						if (root.current?.contains(event.relatedTarget)) leave(true)
						else {
							const next = adjacent(-1, false)
							if (next < 0) leave(false)
							else focusRow(next, false)
						}
					}}
				/>
			)}
			{window.map((entry) => (
				<div
					key={entry.key}
					data-index={entry.index}
					data-pages-row-key={items[entry.index]!.key}
					ref={virtual ? virtualizer.measureElement : undefined}
					style={
						virtual
							? {
									position: 'absolute',
									top: 0,
									left: 0,
									width: '100%',
									zIndex: items[entry.index]!.key === pinned ? 1 : undefined,
									transform: `translateY(${entry.start - margin}px)`,
								}
							: undefined
					}
				>
					{renderItem(items[entry.index]!)}
				</div>
			))}
			{virtual && (
				<span
					tabIndex={0}
					data-pages-boundary="end"
					style={boundaryStyle}
					onFocus={(event) => {
						if (root.current?.contains(event.relatedTarget)) leave(false)
						else {
							const next = adjacent(items.length, true)
							if (next < 0) leave(true)
							else focusRow(next, true)
						}
					}}
				/>
			)}
		</div>
	)
}
