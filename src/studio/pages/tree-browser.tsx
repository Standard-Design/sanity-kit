import { useCollectionTitleResolver } from '../collections/settings-context.js'
/**
 * Render saved and inferred folders, real named index pages, and recent collection
 * items. Folders are navigation only: expansion never selects or writes content.
 * Folder cards match Structure's compact first-pane rows: 4px top/bottom/left
 * and 8px right padding, with a 33px minimum height.
 * See docs/pages.md for search scope and the separate content-action rollout.
 */
import {
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
	type ReactNode,
	type RefObject,
} from 'react'
import { Box, Button, Card, Flex, Stack, Text } from '@sanity/ui'
import { ChevronDownIcon } from '@sanity/icons/ChevronDown'
import { ChevronRightIcon } from '@sanity/icons/ChevronRight'
import { FolderIcon } from '@sanity/icons/Folder'
import { DocumentsIcon } from '@sanity/icons/Documents'
import { CollectionActions } from './collection-actions.js'
import { EllipsisHorizontalIcon } from '@sanity/icons/EllipsisHorizontal'
import { TrashIcon } from '@sanity/icons/Trash'
import { AddIcon } from '@sanity/icons/Add'
import { EditIcon } from '@sanity/icons/Edit'
import { Menu, MenuButton, MenuItem } from '@sanity/ui/menu'
import { TooltipButton } from './tooltip.js'
import { usePresentationParams } from 'sanity/presentation'
import type {
	NavigationNode,
	NavigationCollection,
	NavigationFolder,
	NavigationPage,
} from './navigation.js'
import type { PageDocument } from './model.js'
import { useBrowserState } from './browser-context.js'
import { usePagesDataSession } from './use-page-data.js'
import { PageRow } from './page-row.js'
import { FolderPageCreationAction } from './page-create-dialog.js'
import { VirtualRows } from './virtual-rows.js'
import { pageRows, visibleTreeRows, type VisibleRow } from './visible-rows.js'

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
	const displayTitle = useCollectionTitleResolver()(collection)
	const itemsTitle = collection.itemsTitle ?? displayTitle
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
					<Box flex={1} style={{ minWidth: 0 }}>
						<Text size={1} weight="medium" textOverflow="ellipsis">
							{browseTitle}
						</Text>
					</Box>
					<Flex align="center" gap={2} style={{ flexShrink: 0 }}>
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

/** Native submenus keep folder actions visible while choosing a page template. */
function FolderActions({
	node,
	disabled,
	onCreateFolder,
}: {
	node: NavigationFolder
	disabled: boolean
	onCreateFolder: (pathname: string) => void
}) {
	const {
		runtime,
		setPickerOpen,
		showPageCreate,
		showFolderRemove,
		showFolderRename,
		renameAvailable,
	} = useBrowserState()
	const trigger = useRef<HTMLButtonElement>(null)
	const [menuVersion, setMenuVersion] = useState(0)
	const hasPageChoices = runtime.createChoices.some((choice) =>
		runtime.registry.types.some(
			(type) =>
				type.schemaType === choice.schemaType &&
				!type.collection &&
				type.pathField.endsWith('.current'),
		),
	)
	const hasIndex = node.children.some(
		(child) => child.kind === 'page' && child.pathname === node.pathname,
	)
	return (
		<MenuButton
			key={menuVersion}
			ref={trigger}
			id={`folder-options-${encodeURIComponent(node.pathname)}`}
			button={
				<TooltipButton
					icon={EllipsisHorizontalIcon}
					aria-label={`Folder options: ${node.pathname}`}
					tooltip="Folder options"
					mode="bleed"
					fontSize={1}
					padding={2}
				/>
			}
			menu={
				<Menu>
					{hasPageChoices && (
						<>
							{(['page', 'index'] as const).map((mode) => (
								<FolderPageCreationAction
									key={mode}
									runtime={runtime}
									context={{ mode, pathname: node.pathname }}
									disabled={disabled || (mode === 'index' && hasIndex)}
									onSingle={() => {
										if (trigger.current)
											showPageCreate(trigger.current, {
												mode,
												pathname: node.pathname,
											})
									}}
									onCreated={() => {
										setMenuVersion((value) => value + 1)
										setPickerOpen(false)
									}}
								/>
							))}
						</>
					)}
					<MenuItem
						text="New subfolder"
						icon={AddIcon}
						onClick={() => onCreateFolder(node.pathname)}
					/>
					<MenuItem
						text="Rename folder"
						icon={EditIcon}
						disabled={disabled || !renameAvailable}
						onClick={() => showFolderRename(node.pathname)}
					/>
					<MenuItem
						text="Remove folder"
						icon={TrashIcon}
						tone="critical"
						disabled={disabled || node.children.length > 0}
						onClick={() => showFolderRemove(node.pathname)}
					/>
				</Menu>
			}
			popover={{ portal: false }}
		/>
	)
}

function GroupRow({
	node,
	open,
	disabled,
	onCreateFolder,
}: {
	node: Exclude<NavigationNode, NavigationPage>
	open: boolean
	disabled: boolean
	onCreateFolder: (pathname: string) => void
}) {
	const { setState, runtime } = useBrowserState()
	const collectionTitle = useCollectionTitleResolver()
	const definition =
		node.kind === 'collection'
			? runtime.registry.collections.find((item) => item.name === node.name)
			: undefined
	const label =
		node.kind === 'folder'
			? node.name
			: definition
				? collectionTitle(definition)
				: node.title
	const title = label.replace(/^./u, (letter) => letter.toUpperCase())
	const Icon =
		node.kind === 'collection'
			? (runtime.collectionUi[node.name]?.icon ?? DocumentsIcon)
			: FolderIcon
	return (
		<Flex align="center" gap={1}>
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
				style={{
					flex: 1,
					minWidth: 0,
					minHeight: 33,
					textAlign: 'left',
				}}
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
						<span style={{ display: 'flex', flexShrink: 0 }}>
							{open ? <ChevronDownIcon /> : <ChevronRightIcon />}
						</span>
						<span style={{ display: 'flex', flexShrink: 0 }}>
							<Icon />
						</span>
						<span
							style={{
								minWidth: 0,
								overflow: 'hidden',
								textOverflow: 'ellipsis',
								whiteSpace: 'nowrap',
							}}
						>
							{title}
						</span>
					</span>
				</Text>
			</Card>
			{node.kind === 'collection' && <CollectionActions name={node.name} />}
			{node.kind === 'folder' && (
				<FolderActions
					node={node}
					disabled={disabled}
					onCreateFolder={onCreateFolder}
				/>
			)}
		</Flex>
	)
}

// Scrolling only changes rendering. Keep expanded recent resources alive even
// when their small display block is outside the viewport.
function RecentSubscription({ name }: { name: string }) {
	const resource = usePagesDataSession().recent(name)
	useEffect(() => resource.subscribe(() => {}), [resource])
	return null
}

export function RowLayout({
	row,
	children,
}: {
	row: VisibleRow
	children: ReactNode
}) {
	let content = (
		<div style={{ paddingBottom: row.spacing[row.depth] ?? 0 }}>{children}</div>
	)
	for (let depth = row.depth - 1; depth >= 0; depth--) {
		content = (
			<div style={{ paddingBottom: row.spacing[depth] ?? 0 }}>
				<NestedRows>{content}</NestedRows>
			</div>
		)
	}
	return content
}

export function estimateRow(row: VisibleRow) {
	return (
		(row.kind === 'page' ? 49 : row.kind === 'recent' ? 360 : 33) +
		row.spacing.reduce((sum, gap) => sum + (gap ?? 0), 0)
	)
}

export function TreeRows({
	nodes,
	documents,
	disabled,
	onCreateFolder,
	unfiled,
	searchDocuments,
	scrollRef,
	initialOffset,
}: {
	nodes: NavigationNode[]
	documents: PageDocument[]
	disabled: boolean
	onCreateFolder: (pathname: string) => void
	unfiled: NavigationPage[]
	searchDocuments: PageDocument[] | undefined
	scrollRef: RefObject<HTMLDivElement | null>
	initialOffset: number
}) {
	const { state, runtime } = useBrowserState()
	const { preview } = usePresentationParams()
	const current = runtime.model.previewedDocument(documents, preview)
	const rows = useMemo(
		() =>
			searchDocuments
				? pageRows(searchDocuments)
				: visibleTreeRows(nodes, state.collapsed, unfiled),
		[nodes, state.collapsed, unfiled, searchDocuments],
	)
	return (
		<>
			{rows
				.filter((row) => row.kind === 'recent')
				.map((row) => (
					<RecentSubscription key={row.key} name={row.node.name} />
				))}
			<VirtualRows
				items={rows}
				scrollRef={scrollRef}
				initialOffset={initialOffset}
				estimateSize={estimateRow}
				canFocus={(row) =>
					row.kind === 'group' ||
					row.kind === 'recent' ||
					(row.kind === 'page' && !disabled)
				}
				renderItem={(row) => (
					<RowLayout row={row}>
						{row.kind === 'page' && (
							<PageRow
								document={row.document}
								disabled={disabled}
								selected={current?._id === row.document._id}
							/>
						)}
						{row.kind === 'group' && (
							<GroupRow
								node={row.node}
								open={row.open}
								disabled={disabled}
								onCreateFolder={onCreateFolder}
							/>
						)}
						{(row.kind === 'note' || row.kind === 'heading') && (
							<Box padding={2}>
								<Text size={1} muted>
									{row.text}
								</Text>
							</Box>
						)}
						{row.kind === 'recent' && <RecentItems node={row.node} />}
					</RowLayout>
				)}
			/>
		</>
	)
}

/** Includes nested collection groups; used by the native Expand/Collapse all menu. */
export function groupKeys(nodes: NavigationNode[]): string[] {
	return nodes.flatMap((node) =>
		node.kind === 'page' ? [] : [node.key, ...groupKeys(node.children)],
	)
}
