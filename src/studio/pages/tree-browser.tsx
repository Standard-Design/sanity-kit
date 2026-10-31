/**
 * Render saved and inferred folders, real named index pages, and recent collection
 * items. Folders are navigation only: expansion never selects or writes content.
 * Folder cards match Structure's compact first-pane rows: 4px top/bottom/left
 * and 8px right padding, with a 33px minimum height.
 * See docs/pages.md for search scope and the separate content-action rollout.
 */
import { useSyncExternalStore, type ReactNode } from 'react'
import { Box, Button, Card, Flex, Stack, Text } from '@sanity/ui'
import { ChevronDownIcon } from '@sanity/icons/ChevronDown'
import { ChevronRightIcon } from '@sanity/icons/ChevronRight'
import { FolderIcon } from '@sanity/icons/Folder'
import { usePresentationParams } from 'sanity/presentation'
import type { NavigationNode, NavigationCollection } from './navigation.js'
import type { PageDocument } from './model.js'
import { useBrowserState } from './browser-state.js'
import { usePagesDataSession } from './use-page-data.js'
import { PageRow } from './page-row.js'

export function NestedRows({ children }: { children: ReactNode }) {
	return (
		<Box
			marginLeft={3}
			paddingLeft={2}
			style={{ borderLeft: '1px solid var(--card-border-color)' }}
		>
			{children}
		</Box>
	)
}

function RecentItems({ node }: { node: NavigationCollection }) {
	const session = usePagesDataSession()
	const resource = session.recent(node.name)
	const { data, loading, error, disconnected } = useSyncExternalStore(
		resource.subscribe,
		resource.getSnapshot,
		resource.getSnapshot,
	)
	const { runtime, setState } = useBrowserState()
	const collection = runtime.registry.collections.find(
		(item) => item.name === node.name,
	)!
	const itemsTitle = collection.itemsTitle ?? collection.title
	const itemLabel = itemsTitle.toLowerCase()
	const browseTitle = `Browse all ${itemLabel}`
	const hasTotal = !loading && !error && !disconnected
	const { preview } = usePresentationParams()
	const current = runtime.model.previewedDocument(data.documents, preview)
	return (
		<Stack gap={1}>
			<Box marginTop={3} padding={2}>
				<Text size={1} muted>
					Recent {itemLabel}
				</Text>
			</Box>
			{loading && (
				<Text size={1} role="status">
					Loading recent items…
				</Text>
			)}
			{(error || disconnected) && (
				<Button
					mode="bleed"
					tone="critical"
					text="Retry recent items"
					onClick={session.retry}
				/>
			)}
			{data.documents.map((document) => (
				<PageRow
					key={document._id}
					document={document}
					disabled={error || disconnected}
					selected={current?._id === document._id}
				/>
			))}
			<Card
				as="button"
				type="button"
				__unstable_focusRing
				radius={2}
				tone="inherit"
				padding={2}
				style={{ width: '100%', minHeight: 33, textAlign: 'left' }}
				aria-label={
					hasTotal ? `${browseTitle}, ${data.total} total` : browseTitle
				}
				onClick={() =>
					setState((value) => ({ ...value, collection: node.name }))
				}
			>
				<Flex align="center" justify="space-between" gap={2}>
					<Text size={1} weight="medium">
						{browseTitle}
					</Text>
					<Flex align="center" gap={2}>
						{hasTotal && (
							<Text size={1} muted aria-hidden="true">
								{data.total}
							</Text>
						)}
						<Text size={1} aria-hidden="true">
							<ChevronRightIcon />
						</Text>
					</Flex>
				</Flex>
			</Card>
		</Stack>
	)
}

export function TreeRows({
	nodes,
	documents,
	disabled,
}: {
	nodes: NavigationNode[]
	documents: PageDocument[]
	disabled: boolean
}) {
	const { state, setState, runtime } = useBrowserState()
	const { preview } = usePresentationParams()
	const current = runtime.model.previewedDocument(documents, preview)
	return (
		<Stack gap={1}>
			{nodes.map((node, index) => {
				if (node.kind === 'page')
					return (
						<PageRow
							key={node.key}
							document={node.document}
							disabled={disabled}
							selected={current?._id === node.document._id}
						/>
					)
				const open = !state.collapsed.includes(node.key)
				// Change only the display label, never the path or stable expansion key.
				const label = node.kind === 'folder' ? node.name : node.title
				const title = label.replace(/^./u, (letter) => letter.toUpperCase())
				return (
					// Separate disclosed contents from the next sibling without adding
					// trailing space at every nesting level. Match the Posts label gap.
					<Box
						key={node.key}
						paddingBottom={open && index < nodes.length - 1 ? 3 : 0}
					>
						<Card
							as="button"
							type="button"
							__unstable_focusRing
							radius={2}
							tone="inherit"
							paddingLeft={1}
							paddingRight={2}
							paddingY={1}
							aria-label={`${open ? 'Collapse' : 'Expand'} ${title}`}
							aria-expanded={open}
							style={{ width: '100%', minHeight: 33, textAlign: 'left' }}
							onClick={() =>
								setState((value) => ({
									...value,
									collapsed: open
										? [...value.collapsed, node.key]
										: value.collapsed.filter((key) => key !== node.key),
								}))
							}
						>
							<Text size={1} weight="medium">
								<span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
									{open ? <ChevronDownIcon /> : <ChevronRightIcon />}
									<FolderIcon />
									{title}
								</span>
							</Text>
						</Card>
						{open && (
							<NestedRows>
								{node.kind === 'folder' && node.children.length === 0 && (
									<Box padding={2}>
										<Text size={1} muted>
											No pages in this folder.
										</Text>
									</Box>
								)}
								{node.kind === 'collection' && (
									<>
										{node.overviews.length === 0 && (
											<Box padding={2}>
												<Text size={1} muted>
													No overview page
												</Text>
											</Box>
										)}
										{node.overviews.length > 1 && (
											<Box padding={2}>
												<Text size={1} muted>
													Multiple overview pages share this URL.
												</Text>
											</Box>
										)}
										{node.overviews.map((page) => (
											<PageRow
												key={page.key}
												document={page.document}
												disabled={disabled}
												selected={current?._id === page.document._id}
											/>
										))}
									</>
								)}
								<TreeRows
									nodes={node.children}
									documents={documents}
									disabled={disabled}
								/>
								{node.kind === 'collection' && <RecentItems node={node} />}
							</NestedRows>
						)}
					</Box>
				)
			})}
		</Stack>
	)
}

/** Includes nested collection groups; used by the native Expand/Collapse all menu. */
export function groupKeys(nodes: NavigationNode[]): string[] {
	return nodes.flatMap((node) =>
		node.kind === 'page' ? [] : [node.key, ...groupKeys(node.children)],
	)
}
