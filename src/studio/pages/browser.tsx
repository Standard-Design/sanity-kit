/** Shared navigator/picker shell. URL and document selection stay in Presentation. */
import { Box, Flex, Stack, Text } from '@sanity/ui'
import { Menu, MenuButton, MenuItem } from '@sanity/ui/menu'
import { AddIcon } from '@sanity/icons/Add'
import { EllipsisHorizontalIcon } from '@sanity/icons/EllipsisHorizontal'
import { useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { usePresentationParams } from 'sanity/presentation'
import { useRouter } from 'sanity/router'
import { useBrowserState } from './browser-state.js'
import { usePagesDataSession } from './use-page-data.js'
import { TreeRows, groupKeys } from './tree-browser.js'
import { PageRow } from './page-row.js'
import { CollectionBrowser } from './collection-browser.js'
import { DataWarning, FolderDataWarning } from './data-warning.js'
import { buildNavigationTree } from './navigation.js'
import { BrowserHeader } from './browser-header.js'
import { TooltipButton } from './tooltip.js'

export function PagesBrowser({ fitContent = false }: { fitContent?: boolean }) {
	const { state } = useBrowserState()
	return state.collection ? (
		<CollectionBrowser
			key={state.collection}
			name={state.collection}
			fitContent={fitContent}
		/>
	) : (
		<PageTreeBrowser fitContent={fitContent} />
	)
}

function PageTreeBrowser({ fitContent }: { fitContent: boolean }) {
	const { runtime, state, setState, setPickerOpen } = useBrowserState()
	const session = usePagesDataSession()
	const result = useSyncExternalStore(
		session.pages.subscribe,
		session.pages.getSnapshot,
		session.pages.getSnapshot,
	)
	const folders = useSyncExternalStore(
		session.folders.subscribe,
		session.folders.getSnapshot,
		session.folders.getSnapshot,
	)
	const { documents } = result.data
	// Organizational metadata loads independently. A missing or failed folder
	// read must not hide real pages or grant permission for any folder write.
	const tree = useMemo(
		() => buildNavigationTree(runtime.registry, documents, folders.data),
		[runtime.registry, documents, folders.data],
	)
	const error = result.error || result.disconnected
	const folderError = folders.error || folders.disconnected
	const { preview } = usePresentationParams()
	const current = runtime.model.previewedDocument(documents, preview)
	const router = useRouter()
	const scrollRef = useRef<HTMLDivElement>(null)
	const initialScroll = useRef(state.scrollTop)
	useLayoutEffect(() => {
		if (scrollRef.current) scrollRef.current.scrollTop = initialScroll.current
	}, [result.loading])
	const search = state.query.trim().toLowerCase()
	const filtered = documents.filter((document) =>
		`${document.title ?? ''} ${document.pathname ?? ''}`
			.toLowerCase()
			.includes(search),
	)
	// Valid but unusual paths must not be described as missing URLs.
	const unfiledGroups = [
		{
			title: 'Pages without URLs',
			pages: tree.unfiled.filter((page) => !page.pathname),
		},
		{
			title: 'Ungrouped pages',
			pages: tree.unfiled.filter((page) => page.pathname),
		},
	]
	return (
		<Flex
			direction="column"
			style={{ height: fitContent ? 'auto' : '100%', minHeight: 0 }}
		>
			<BrowserHeader
				title={runtime.title}
				searchLabel="Search pages"
				query={state.query}
				onQueryChange={(query) => {
					initialScroll.current = 0
					if (scrollRef.current) scrollRef.current.scrollTop = 0
					setState((value) => ({ ...value, query, scrollTop: 0 }))
				}}
				actions={
					<>
						{runtime.create && (
							<TooltipButton
								icon={AddIcon}
								aria-label="Create page"
								mode="bleed"
								fontSize={1}
								padding={2}
								tooltip="Create page"
								onClick={() => {
									setPickerOpen(false)
									router.navigateIntent('create', {
										type: runtime.create!.schemaType,
										template: runtime.create!.templateId,
										presentation: runtime.name,
									})
								}}
							/>
						)}
						<MenuButton
							id="pages-options"
							button={
								<TooltipButton
									icon={EllipsisHorizontalIcon}
									aria-label="Pages options"
									mode="bleed"
									fontSize={1}
									padding={2}
									tooltip="Pages options"
								/>
							}
							menu={
								<Menu>
									<MenuItem
										text="Expand all"
										onClick={() =>
											setState((value) => ({ ...value, collapsed: [] }))
										}
									/>
									<MenuItem
										text="Collapse all"
										onClick={() =>
											setState((value) => ({
												...value,
												collapsed: groupKeys(tree.roots),
											}))
										}
									/>
								</Menu>
							}
							// Keep the nested menu inside the modal picker's focus boundary.
							popover={{ portal: false }}
						/>
					</>
				}
			>
				{search && (
					<Text size={1} muted>
						Search covers pages and overviews. Browse a collection to search its
						items.
					</Text>
				)}
			</BrowserHeader>
			<Box
				ref={scrollRef}
				flex={1}
				overflow="auto"
				paddingX={3}
				paddingBottom={3}
				data-pages-scroll="pages"
				onScroll={(event) => {
					const scrollTop = event.currentTarget.scrollTop
					setState((value) => ({ ...value, scrollTop }))
				}}
			>
				{result.loading && (
					<Text size={1} role="status">
						Loading pages…
					</Text>
				)}
				{error && <DataWarning retry={session.retry} />}
				{!error && folderError && <FolderDataWarning retry={session.retry} />}
				{!result.loading && folders.loading && !error && (
					<Text size={1} role="status">
						Loading folders…
					</Text>
				)}
				{!result.loading &&
					!error &&
					(search || (!folders.loading && !folderError)) &&
					(search
						? filtered.length === 0
						: tree.roots.length === 0 && tree.unfiled.length === 0) && (
						<Box paddingY={2}>
							<Text size={1}>No pages found.</Text>
						</Box>
					)}
				{search ? (
					<Stack gap={1}>
						{filtered.map((document) => (
							<PageRow
								key={document._id}
								document={document}
								disabled={error}
								selected={current?._id === document._id}
							/>
						))}
					</Stack>
				) : (
					<>
						<TreeRows
							nodes={tree.roots}
							documents={documents}
							disabled={error}
						/>
						{unfiledGroups
							.filter((group) => group.pages.length > 0)
							.map((group) => (
								<Box key={group.title} marginTop={3}>
									<Stack gap={1}>
										<Box padding={2}>
											<Text size={1} muted>
												{group.title}
											</Text>
										</Box>
										{group.pages.map((page) => (
											<PageRow
												key={page.key}
												document={page.document}
												disabled={error}
												selected={current?._id === page.document._id}
											/>
										))}
									</Stack>
								</Box>
							))}
					</>
				)}
			</Box>
		</Flex>
	)
}
