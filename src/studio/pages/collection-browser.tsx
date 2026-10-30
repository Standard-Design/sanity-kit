/**
 * Collection mode replaces only the browser, never the preview/editor panes.
 * Search is server-side and debounced. Scrolling requests the next bounded batch;
 * a keyboard-accessible button offers the same action without requiring scrolling.
 */
import {
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from 'react'
import { Box, Button, Flex, Stack, Text } from '@sanity/ui'
import { ArrowLeftIcon } from '@sanity/icons/ArrowLeft'
import { usePresentationParams } from 'sanity/presentation'
import { useBrowserState } from './browser-state.js'
import { usePagesDataSession } from './use-page-data.js'
import { PageRow } from './page-row.js'
import { DataWarning } from './data-warning.js'
import { BrowserHeader } from './browser-header.js'
import { TooltipButton } from './tooltip.js'

export function CollectionBrowser({
	name,
	fitContent = false,
}: {
	name: string
	fitContent?: boolean
}) {
	const { runtime, state, setState } = useBrowserState()
	const definition = runtime.registry.collections.find(
		(item) => item.name === name,
	)!
	const query = state.collectionQueries[name] ?? ''
	const [search, setSearch] = useState(query)
	const session = usePagesDataSession()
	const resource = session.collection(name, search)
	const result = useSyncExternalStore(
		resource.subscribe,
		resource.getSnapshot,
		resource.getSnapshot,
	)
	const pendingSearch =
		query.trim().toLowerCase() !== search.trim().toLowerCase()
	const error = result.error || result.disconnected
	const { preview } = usePresentationParams()
	const current = runtime.model.previewedDocument(
		result.data.documents,
		preview,
	)
	const scroll = useRef<HTMLDivElement>(null)
	const saved = useRef(state.collectionScroll[name] ?? 0)
	useEffect(() => {
		const timer = setTimeout(() => setSearch(query), 200)
		return () => clearTimeout(timer)
	}, [query])
	useLayoutEffect(() => {
		if (scroll.current) scroll.current.scrollTop = saved.current
	}, [result.loading])
	// Fill a tall/empty viewport too; no scroll event is possible until it overflows.
	useEffect(() => {
		const element = scroll.current
		if (
			!element ||
			pendingSearch ||
			error ||
			result.loading ||
			result.refreshing
		)
			return
		if (
			element.clientHeight > 0 &&
			element.scrollHeight <= element.clientHeight + 120
		)
			resource.loadMore()
	}, [resource, result, pendingSearch, error])
	return (
		<Flex
			direction="column"
			style={{ height: fitContent ? 'auto' : '100%', minHeight: 0 }}
		>
			<BrowserHeader
				title={definition.title}
				searchLabel={`Search ${definition.title}`}
				query={query}
				onQueryChange={(next) => {
					saved.current = 0
					if (scroll.current) scroll.current.scrollTop = 0
					setState((value) => ({
						...value,
						collectionQueries: { ...value.collectionQueries, [name]: next },
						collectionScroll: { ...value.collectionScroll, [name]: 0 },
					}))
				}}
				backButton={
					<TooltipButton
						mode="bleed"
						icon={ArrowLeftIcon}
						aria-label="Back to pages"
						tooltip="Back to pages"
						fontSize={1}
						padding={2}
						onClick={() =>
							setState((value) => ({ ...value, collection: undefined }))
						}
					/>
				}
			/>
			<Box
				ref={scroll}
				flex={1}
				overflow="auto"
				paddingX={3}
				paddingBottom={3}
				data-pages-scroll="collection"
				onScroll={(event) => {
					const element = event.currentTarget
					const scrollTop = element.scrollTop
					saved.current = scrollTop
					setState((value) => ({
						...value,
						collectionScroll: { ...value.collectionScroll, [name]: scrollTop },
					}))
					if (
						!pendingSearch &&
						element.scrollHeight - element.scrollTop - element.clientHeight <
							160
					)
						resource.loadMore()
				}}
			>
				{error && <DataWarning retry={session.retry} />}
				{(result.loading || pendingSearch) && (
					<Text size={1} role="status">
						Loading items…
					</Text>
				)}
				{!result.loading &&
					!pendingSearch &&
					!error &&
					result.data.documents.length === 0 && (
						<Text size={1}>No items found.</Text>
					)}
				<Stack gap={1}>
					{!pendingSearch &&
						result.data.documents.map((document) => (
							<PageRow
								key={document._id}
								document={document}
								disabled={error}
								selected={current?._id === document._id}
							/>
						))}
				</Stack>
				{result.data.next && !pendingSearch && (
					<Button
						mode="bleed"
						text={result.refreshing ? 'Loading more…' : 'Load more items'}
						disabled={error || result.refreshing}
						onClick={resource.loadMore}
					/>
				)}
			</Box>
		</Flex>
	)
}
