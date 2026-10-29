/**
 * A1's only adapter to Presentation's unstable extension slots. No private imports.
 * The proof stays out of the published package until live acceptance establishes
 * the provider lifetime and header composition. See this fixture's README.
 */
import { Box, Button, Flex, Text, useClickOutsideEvent } from '@sanity/ui'
import { Popover } from '@sanity/ui/popover'
import { useEffect, useRef, type ComponentProps } from 'react'
import FocusLockModule from 'react-focus-lock'
import { definePlugin } from 'sanity'
import {
	presentationTool,
	usePresentationParams,
	type PresentationPluginOptions,
	type PreviewHeaderProps,
} from 'sanity/presentation'
import { BrowserStateProvider, useBrowserState } from './browser-state.js'
import { proofDocumentPath, previewedDocument } from './model.js'
import { validatePagesSchema } from '../../../src/studio/pages/registry.js'
import { proofRegistry } from './routes.js'
import { ProofBrowser, useProofDocuments } from './proof-browser.js'

// NodeNext sees the CommonJS namespace; Vite may unwrap its default export.
const FocusLock = FocusLockModule.default ?? FocusLockModule

export function ProofHeader(props: PreviewHeaderProps) {
	const { pickerOpen, setPickerOpen } = useBrowserState()
	const trigger = useRef<HTMLButtonElement>(null)
	const panel = useRef<HTMLDivElement>(null)
	const wasOpen = useRef(false)
	const params = usePresentationParams()
	const { documents } = useProofDocuments()
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
										<ProofBrowser />
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
			{edited && !proofDocumentPath(edited) && (
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

/** The tool wrapper outlives navigator unmounts and is isolated per workspace/tool. */
export const pagesProofTool = definePlugin<
	Omit<PresentationPluginOptions, 'components'>
>((options) => {
	const name = options.name ?? 'pages-proof'
	return {
		name: 'sanity-kit-pages-proof',
		plugins: [
			presentationTool({
				...options,
				name,
				components: {
					unstable_navigator: {
						component: ProofBrowser,
						minWidth: 240,
						maxWidth: 440,
					},
					unstable_header: { component: ProofHeader },
				},
			}),
		],
		tools: (tools, context) => {
			validatePagesSchema(proofRegistry, context.schema)
			return tools.map((tool) => {
				if (tool.name !== name) return tool
				const NativeTool = tool.component
				function ToolWithBrowserState(
					props: ComponentProps<typeof NativeTool>,
				) {
					return (
						<BrowserStateProvider
							key={`${context.projectId}:${context.dataset}:${name}`}
						>
							<NativeTool {...props} />
						</BrowserStateProvider>
					)
				}
				return { ...tool, component: ToolWithBrowserState }
			})
		},
	}
})
