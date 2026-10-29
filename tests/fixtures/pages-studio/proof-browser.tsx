import { Box, Button, Card, Flex, Stack, Text, TextInput } from '@sanity/ui'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useClient, usePerspective } from 'sanity'
import {
	usePresentationNavigate,
	usePresentationParams,
} from 'sanity/presentation'
import { useRouter } from 'sanity/router'
import { useBrowserState } from './browser-state.js'
import {
	proofDocumentPath,
	previewedDocument,
	proofQuery,
	proofTypes,
	type ProofDocument,
} from './model.js'

/** A bounded live list is enough to test the native shell; A3 replaces this data layer. */
export function useProofDocuments() {
	const client = useClient({ apiVersion: '2026-10-01' })
	const { perspectiveStack } = usePerspective()
	const perspectiveKey = JSON.stringify(perspectiveStack)
	const [result, setResult] = useState<{
		documents: ProofDocument[]
		error: boolean
		loading: boolean
	}>({ documents: [], error: false, loading: true })
	const [refresh, setRefresh] = useState(0)
	useEffect(() => {
		const subscription = client
			.listen(
				'*[_type in $types]',
				{ types: proofTypes },
				{ includeResult: false, visibility: 'query' },
			)
			.subscribe({
				next: () => setRefresh((value) => value + 1),
				error: () => setResult((value) => ({ ...value, error: true })),
			})
		return () => subscription.unsubscribe()
	}, [client])
	useEffect(() => {
		const controller = new AbortController()
		setResult({ documents: [], error: false, loading: true })
		const perspective = JSON.parse(perspectiveKey) as string[]
		void client
			.fetch<ProofDocument[]>(
				proofQuery,
				{ types: proofTypes },
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
	}, [client, perspectiveKey, refresh])
	return result
}

export function ProofBrowser() {
	const { state, setState, setPickerOpen } = useBrowserState()
	const { documents, loading, error } = useProofDocuments()
	const params = usePresentationParams()
	const navigate = usePresentationNavigate()
	const router = useRouter()
	const scrollRef = useRef<HTMLDivElement>(null)
	const initialScroll = useRef(state.scrollTop)
	const current = previewedDocument(documents, params.preview)
	useLayoutEffect(() => {
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
						<Text weight="semibold">Pages — integration proof</Text>
						<Button
							text="Create page"
							mode="bleed"
							onClick={() => {
								setPickerOpen(false)
								// Native Presentation generates the ID and opens its ordinary editor.
								router.navigateIntent('create', {
									type: 'kitProofPage',
									template: 'kitProofPage',
									presentation: 'pages-proof',
								})
							}}
						/>
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
						First 50 fixture documents. Full tree and collections follow this
						proof.
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
							Cannot load fixture pages. Check connection and dataset access.
						</Text>
					</Card>
				)}
				{!loading && !error && filtered.length === 0 && (
					<Text>No fixture pages found.</Text>
				)}
				<Stack gap={2}>
					{filtered.map((document) => (
						<Button
							key={document._id}
							mode="bleed"
							selected={current?._id === document._id}
							text={`${document.title ?? 'Untitled'} · ${proofDocumentPath(document) ?? 'Preview unavailable'}`}
							onClick={() => {
								// An absent path changes only the editor; the current preview is preserved.
								navigate(proofDocumentPath(document), {
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
