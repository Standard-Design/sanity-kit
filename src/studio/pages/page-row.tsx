/**
 * One row in either browser. Native Presentation owns both preview and editor.
 * Like Structure previews, a selectable Card owns every interaction color.
 * The 49px minimum matches its default preview; wrapped paths can grow taller.
 */
import { Box, Card, Flex, Stack, Text } from '@sanity/ui'
import { DocumentIcon } from '@sanity/icons/Document'
import { HomeIcon } from '@sanity/icons/Home'
import { memo } from 'react'
import {
	usePresentationNavigate,
	usePresentationParams,
} from 'sanity/presentation'
import type { PageDocument } from './model.js'
import { useBrowserState } from './browser-context.js'
import { PageStatus } from './document-status.js'

interface PageRowProps {
	document: PageDocument
	disabled?: boolean
	selected?: boolean
}

export function PageRow(props: PageRowProps) {
	const { runtime, setPickerOpen } = useBrowserState()
	return (
		<PageRowContent
			{...props}
			runtime={runtime}
			setPickerOpen={setPickerOpen}
		/>
	)
}

// Search and scroll state update the context frequently. Keep those updates out
// of unchanged rows while retaining native navigation and status subscriptions.
const PageRowContent = memo(function PageRowContent({
	document,
	disabled = false,
	selected = false,
	runtime,
	setPickerOpen,
}: PageRowProps &
	Pick<ReturnType<typeof useBrowserState>, 'runtime' | 'setPickerOpen'>) {
	const navigate = usePresentationNavigate()
	const params = usePresentationParams()
	const path = runtime.model.documentPath(document)
	const title = document.title || 'Untitled'
	const Icon = path === '/' ? HomeIcon : DocumentIcon
	return (
		<Card
			as="button"
			type="button"
			__unstable_focusRing
			radius={2}
			tone="inherit"
			padding={2}
			disabled={disabled}
			selected={selected}
			aria-current={selected ? 'page' : undefined}
			aria-label={`${title} · ${path ?? 'Preview unavailable'}`}
			style={{ width: '100%', minHeight: 49, textAlign: 'left' }}
			onClick={() => {
				// A pathless page changes only the editor; never invent a preview URL.
				navigate(path, { id: document._id, type: document._type })
				setPickerOpen(false)
			}}
		>
			<Flex align="center" gap={3}>
				<Text size={1}>
					<Icon />
				</Text>
				<Box flex={1} style={{ minWidth: 0 }}>
					<Stack gap={2}>
						<Text size={1} weight="medium" textOverflow="ellipsis">
							{title}
						</Text>
						<Text
							size={1}
							weight="regular"
							muted
							style={{
								overflowWrap: 'anywhere',
							}}
						>
							{path ??
								(params.id === document._id
									? 'Preview unavailable · editing'
									: 'Preview unavailable')}
						</Text>
					</Stack>
				</Box>
				<PageStatus id={document._id} />
			</Flex>
		</Card>
	)
})
