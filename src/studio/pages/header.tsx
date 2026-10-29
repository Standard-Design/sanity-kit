/**
 * The only header adapter to Presentation's unstable extension slots. No private imports.
 * Native controls stay intact through renderDefault. Browser state comes from the
 * tool-level provider, not from the disposable navigator. See docs/pages.md.
 */
import { Box, Button, Flex, Text, useClickOutsideEvent } from '@sanity/ui'
import { Popover } from '@sanity/ui/popover'
import { useEffect, useRef } from 'react'
import FocusLockModule from 'react-focus-lock'
import {
	usePresentationParams,
	type PreviewHeaderProps,
} from 'sanity/presentation'
import { useBrowserState } from './browser-state.js'
import { PagesBrowser, usePageDocuments } from './browser.js'

// NodeNext sees the CommonJS namespace; Vite may unwrap its default export.
const FocusLock = FocusLockModule.default ?? FocusLockModule

export function PagesHeader(props: PreviewHeaderProps) {
	const { runtime, pickerOpen, setPickerOpen } = useBrowserState()
	const trigger = useRef<HTMLButtonElement>(null)
	const panel = useRef<HTMLDivElement>(null)
	const wasOpen = useRef(false)
	const params = usePresentationParams()
	const { documents } = usePageDocuments()
	const { documentPath, previewedDocument } = runtime.model
	const current = previewedDocument(documents, params.preview)
	const edited = documents.find((document) => document._id === params.id)
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
				<Box flex={1} style={{ minWidth: 0 }}>
					{props.renderDefault(props)}
				</Box>
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
								<FocusLock
									returnFocus={false}
									onActivation={() =>
										panel.current?.querySelector<HTMLElement>('input')?.focus()
									}
								>
									<Box
										ref={panel}
										role="dialog"
										aria-modal="true"
										aria-label="Choose page"
										style={{
											width: 'min(380px, 90vw)',
											height: 'min(480px, 70vh)',
										}}
										onKeyDown={(event) => {
											if (event.key === 'Escape') {
												event.preventDefault()
												event.stopPropagation()
												setPickerOpen(false)
											}
										}}
									>
										<PagesBrowser />
									</Box>
								</FocusLock>
							) : null
						}
					>
						<Button
							ref={trigger}
							text="Choose page"
							aria-label={`Choose page: ${current?.title ?? params.preview ?? 'Pages'}`}
							aria-haspopup="dialog"
							aria-expanded={open}
							onClick={() => setPickerOpen((value) => !value)}
						/>
					</Popover>
				)}
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
