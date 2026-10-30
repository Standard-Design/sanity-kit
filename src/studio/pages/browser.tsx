/**
 * The first reusable browser is deliberately small: the latest 50 registered
 * documents, searched locally. It is not the approved tree/collection UI yet.
 * See docs/pages.md for the query limits and which parts Presentation owns.
 */
import { Box, Button, Card, Flex, Stack, Text, TextInput } from '@sanity/ui'
import { useLayoutEffect, useRef } from 'react'
import {
	usePresentationNavigate,
	usePresentationParams,
} from 'sanity/presentation'
import { useRouter } from 'sanity/router'
import { useBrowserState } from './browser-state.js'
import { usePageDocuments } from './use-page-data.js'

/** The sidebar and popover mount this same component with the same tool state. */
export function PagesBrowser() {
	const { runtime, state, setState, setPickerOpen } = useBrowserState()
	const { documents, loading, error, retry } = usePageDocuments()
	const params = usePresentationParams()
	const navigate = usePresentationNavigate()
	const router = useRouter()
	const scrollRef = useRef<HTMLDivElement>(null)
	const initialScroll = useRef(state.scrollTop)
	const { documentPath, previewedDocument } = runtime.model
	const current = previewedDocument(documents, params.preview)
	useLayoutEffect(() => {
		// The list may be shorter in a tall sidebar than in a small picker. Keep
		// the saved offset until the rows arrive; the browser clamps it as needed.
		if (scrollRef.current) scrollRef.current.scrollTop = initialScroll.current
	}, [loading])
	const filtered = documents.filter((document) =>
		`${document.title ?? ''} ${document.pathname ?? ''}`
			.toLowerCase()
			.includes(state.query.toLowerCase()),
	)
	return (
		<Flex direction="column" style={{ height: '100%', minHeight: 0 }}>
			<Box padding={3}>
				<Stack gap={3}>
					<Flex align="center" justify="space-between">
						<Text weight="semibold">{runtime.title}</Text>
						{runtime.create && (
							<Button
								text="Create page"
								mode="bleed"
								onClick={() => {
									setPickerOpen(false)
									// Native Presentation generates the ID and opens its ordinary editor.
									router.navigateIntent('create', {
										type: runtime.create!.schemaType,
										template: runtime.create!.templateId,
										presentation: runtime.name,
									})
								}}
							/>
						)}
					</Flex>
					<TextInput
						aria-label="Search pages"
						placeholder="Search list"
						value={state.query}
						onChange={(event) => {
							const query = event.currentTarget.value
							if (scrollRef.current) scrollRef.current.scrollTop = 0
							setState((value) => ({ ...value, query, scrollTop: 0 }))
						}}
					/>
					<Text size={1} muted>
						First 50 documents. Search covers this list only; full browsing is
						in development.
					</Text>
				</Stack>
			</Box>
			<Box
				ref={scrollRef}
				flex={1}
				overflow="auto"
				padding={2}
				onScroll={(event) => {
					const scrollTop = event.currentTarget.scrollTop
					setState((value) => ({ ...value, scrollTop }))
				}}
			>
				{loading && <Text role="status">Loading pages…</Text>}
				{error && (
					<Card padding={3} tone="critical">
						<Text role="alert">
							Pages may be out of date. Check connection and dataset access.
						</Text>
						<Box marginTop={3}>
							<Button text="Retry loading pages" onClick={retry} />
						</Box>
					</Card>
				)}
				{!loading && !error && filtered.length === 0 && (
					<Text>No pages found.</Text>
				)}
				<Stack gap={2}>
					{filtered.map((document) => (
						<Button
							key={document._id}
							mode="bleed"
							disabled={error}
							selected={current?._id === document._id}
							text={`${document.title ?? 'Untitled'} · ${documentPath(document) ?? 'Preview unavailable'}`}
							onClick={() => {
								// An absent path changes only the editor; the current preview is preserved.
								navigate(documentPath(document), {
									id: document._id,
									type: document._type,
								})
								setPickerOpen(false)
							}}
						/>
					))}
				</Stack>
			</Box>
		</Flex>
	)
}
