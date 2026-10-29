/**
 * The first reusable browser is deliberately small: the latest 50 registered
 * documents, searched locally. It is not the approved tree/collection UI yet.
 * See docs/pages.md for the query limits and which parts Presentation owns.
 */
import { Box, Button, Card, Flex, Stack, Text, TextInput } from '@sanity/ui'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useClient, usePerspective } from 'sanity'
import {
	usePresentationNavigate,
	usePresentationParams,
} from 'sanity/presentation'
import { useRouter } from 'sanity/router'
import { useBrowserState } from './browser-state.js'
import type { PageDocument } from './model.js'

/** A bounded live list is enough to test the native shell; A3 replaces this data layer. */
export function usePageDocuments() {
	const { runtime } = useBrowserState()
	const { query, types } = runtime.model
	const client = useClient({ apiVersion: '2026-10-01' })
	const { perspectiveStack } = usePerspective()
	const perspectiveKey = JSON.stringify(perspectiveStack)
	const [result, setResult] = useState<{
		documents: PageDocument[]
		error: boolean
		loading: boolean
	}>({ documents: [], error: false, loading: true })
	const [refresh, setRefresh] = useState(0)
	// A change notification is a reason to refetch, not a replacement document.
	// Wait until it is query-visible so the fetch can actually see that change.
	useEffect(() => {
		const subscription = client
			.listen(
				'*[_type in $types]',
				{ types: types },
				{ includeResult: false, visibility: 'query' },
			)
			.subscribe({
				next: () => setRefresh((value) => value + 1),
				error: () => setResult((value) => ({ ...value, error: true })),
			})
		return () => subscription.unsubscribe()
	}, [client, types])
	useEffect(() => {
		const controller = new AbortController()
		// A perspective change must not briefly present the previous view's rows.
		// Abort stale reads when the perspective changes or the browser unmounts.
		setResult({ documents: [], error: false, loading: true })
		const perspective = JSON.parse(perspectiveKey) as string[]
		void client
			.fetch<PageDocument[]>(
				query,
				{ types: types },
				{ perspective, useCdn: false, signal: controller.signal },
			)
			.then(
				(documents) => {
					if (!controller.signal.aborted)
						setResult({ documents, error: false, loading: false })
				},
				() => {
					if (!controller.signal.aborted)
						setResult({ documents: [], error: true, loading: false })
				},
			)
		return () => controller.abort()
	}, [client, perspectiveKey, refresh, query, types])
	return result
}

/** The sidebar and popover mount this same component with the same tool state. */
export function PagesBrowser() {
	const { runtime, state, setState, setPickerOpen } = useBrowserState()
	const { documents, loading, error } = usePageDocuments()
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
							Cannot load pages. Check connection and dataset access.
						</Text>
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
