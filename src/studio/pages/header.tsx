/**
 * The only header adapter to Presentation's unstable extension slots. No private imports.
 * Native controls stay intact through renderDefault. Browser state comes from the
 * tool-level provider, not from the disposable navigator. See docs/pages.md.
 */
import { ChevronDownIcon } from '@sanity/icons/ChevronDown'
import { DocumentsIcon } from '@sanity/icons/Documents'
import { PanelLeftIcon } from '@sanity/icons/PanelLeft'
import { Box, Flex, Text, useClickOutsideEvent } from '@sanity/ui'
import { Popover } from '@sanity/ui/popover'
import { useEffect, useRef } from 'react'
import FocusLockModule from 'react-focus-lock'
import {
	usePresentationParams,
	type PreviewHeaderProps,
} from 'sanity/presentation'
import { useBrowserState } from './browser-state.js'
import { PagesBrowser } from './browser.js'
import { usePageIdentity } from './use-page-data.js'
import { TooltipButton } from './tooltip.js'

// NodeNext sees the CommonJS namespace; Vite may unwrap its default export.
const FocusLock = FocusLockModule.default ?? FocusLockModule

export function PagesHeader(props: PreviewHeaderProps) {
	const { toggleNavigator, ...withoutNavigatorToggle } = props
	const { runtime, pickerOpen, setPickerOpen } = useBrowserState()
	const trigger = useRef<HTMLButtonElement>(null)
	const panel = useRef<HTMLDivElement>(null)
	const wasOpen = useRef(false)
	const params = usePresentationParams()
	const { current, edited } = usePageIdentity(
		params.preview,
		params.id,
		params.type,
	)
	const { documentPath } = runtime.model
	const pageTitle = current?.title || params.preview || 'Choose page'
	const open = pickerOpen && !props.navigatorEnabled
	useEffect(() => {
		if (props.navigatorEnabled) setPickerOpen(false)
	}, [props.navigatorEnabled, setPickerOpen])
	useEffect(() => {
		if (!open && wasOpen.current && !props.navigatorEnabled)
			trigger.current?.focus()
		wasOpen.current = open
	}, [open, props.navigatorEnabled])
	useClickOutsideEvent(open ? () => setPickerOpen(false) : false, () => [
		trigger.current,
		panel.current,
	])
	return (
		<Flex direction="column" flex={1} style={{ minWidth: 0 }}>
			<Flex align="center" gap={1} style={{ minWidth: 0 }}>
				{/* Only relocate the public navigator toggle. All other native controls
				    still come from renderDefault, with their behavior unchanged. */}
				{!props.navigatorEnabled && toggleNavigator && (
					<TooltipButton
						aria-label="Toggle navigator"
						tooltip="Show navigator"
						icon={PanelLeftIcon}
						mode="bleed"
						fontSize={1}
						padding={3}
						onClick={toggleNavigator}
					/>
				)}
				{!props.navigatorEnabled && (
					<Popover
						open={open}
						portal
						modal
						placement="bottom-start"
						constrainSize
						content={
							open ? (
								// Popover's modal layer blocks pointers, not keyboard focus.
								// Use the same public focus library as native Studio search.
								// The effect above owns return focus so reopening the sidebar
								// never targets a picker trigger that has just disappeared.
								// Flex wrappers pass the native available-height constraint down
								// to the list; short content has no fixed height to fill.
								<FocusLock
									returnFocus={false}
									lockProps={{
										style: {
											display: 'flex',
											flexDirection: 'column',
											minHeight: 0,
										},
									}}
									onActivation={() =>
										panel.current?.focus({ preventScroll: true })
									}
								>
									<Box
										ref={panel}
										role="dialog"
										aria-modal="true"
										aria-label="Choose page"
										tabIndex={-1}
										style={{
											width: 'min(320px, 90vw)',
											display: 'flex',
											flexDirection: 'column',
											minHeight: 0,
											maxHeight: 'calc(100dvh - 32px)',
											outline: 'none',
										}}
										onKeyDown={(event) => {
											// The dialog is the quiet entry point, not an extra Tab stop.
											// First forward Tab enters search; subsequent tabs use DOM order.
											if (
												event.target === panel.current &&
												event.key === 'Tab' &&
												!event.shiftKey
											) {
												event.preventDefault()
												panel.current
													?.querySelector<HTMLElement>('input')
													?.focus()
											}
											if (event.key === 'Escape') {
												event.preventDefault()
												event.stopPropagation()
												setPickerOpen(false)
											}
										}}
									>
										<PagesBrowser fitContent />
									</Box>
								</FocusLock>
							) : null
						}
					>
						<TooltipButton
							ref={trigger}
							mode="ghost"
							tone="default"
							fontSize={1}
							padding={3}
							icon={DocumentsIcon}
							iconRight={ChevronDownIcon}
							text={
								<span
									style={{
										display: 'block',
										maxWidth: 'clamp(6ch, 14vw, 22ch)',
										overflow: 'hidden',
										textOverflow: 'ellipsis',
										whiteSpace: 'nowrap',
									}}
								>
									{pageTitle}
								</span>
							}
							tooltip={pageTitle}
							aria-label={`Choose page: ${pageTitle}`}
							aria-haspopup="dialog"
							aria-expanded={open}
							onClick={() => setPickerOpen((value) => !value)}
						/>
					</Popover>
				)}
				<Box flex={1} style={{ minWidth: 0 }}>
					{props.renderDefault(
						props.navigatorEnabled ? props : withoutNavigatorToggle,
					)}
				</Box>
			</Flex>
			{edited && !documentPath(edited) && (
				<Box padding={2}>
					<Text size={1} role="status">
						Preview unavailable for this document. The previous page remains in
						the preview.
					</Text>
				</Box>
			)}
		</Flex>
	)
}
