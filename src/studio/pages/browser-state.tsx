import type { CollectionRoutingConfig } from '../../url/settings/resolve.js'
import {
	createCollectionFolderAuthorizer,
	createCollectionRoutingGuard,
} from '../collections/routing-guard.js'
import type { PagesRuntime } from './runtime.js'
import {
	useState,
	useMemo,
	useEffect,
	useRef,
	type PropsWithChildren,
} from 'react'
import { useClient, useSchema, useCurrentUser, useGrantsStore } from 'sanity'
import { createFolderRenameController } from '../folders/rename-write.js'
import { createFolderRenameAuthorizer } from '../folders/rename-access.js'
import { FolderRenameDialog } from './folder-rename-dialog.js'
import {
	createFolderSynchronizer,
	createFolderSynchronizationState,
} from '../folders/synchronize.js'
import { createFolderSyncController } from '../folders/sync-controller.js'
import { FolderRemoveDialog } from './folder-remove-dialog.js'
import { FolderSyncDialog } from './folder-sync-dialog.js'
import {
	PagesFolderCreateDialog,
	type FolderCreationRequest,
} from './folder-create-dialog.js'
import { createPagesDataStore } from './data-store.js'
import { BrowserContext, type BrowserState } from './browser-context.js'
import { PageCreateDialog } from './page-create-dialog.js'

/**
 * Mounted around the native tool, not around its disposable navigator panel.
 * The context lives in browser-context.ts so dialog edits can refresh this
 * component without replacing the context used by native Presentation slots.
 */
export function BrowserStateProvider({
	children,
	runtime,
	routingReady = true,
	collectionRouting,
}: PropsWithChildren<{
	runtime: PagesRuntime
	routingReady?: boolean
	collectionRouting?: CollectionRoutingConfig
}>) {
	const [state, setState] = useState<BrowserState>({
		query: '',
		scrollTop: 0,
		collapsed: [],
		collectionQueries: {},
		collectionScroll: {},
	})
	const [pageCreation, setPageCreation] = useState<{
		anchor: HTMLButtonElement
		collection?: string
		context?: { mode: 'page' | 'index'; pathname: string }
	}>()
	const [syncOpen, setSyncOpen] = useState(false)
	const [folderRemoval, setFolderRemoval] = useState<string>()
	const [folderRename, setFolderRename] = useState<{ pathname?: string }>()
	const [renamePending, setRenamePending] = useState(false)
	const [folderCreation, setFolderCreation] = useState<FolderCreationRequest>()
	const [pickerOpen, setPickerOpen] = useState(false)
	const client = useClient({ apiVersion: '2026-10-01' })
	const schema = useSchema()
	const currentUser = useCurrentUser()
	const grantsStore = useGrantsStore()
	const renameController = useMemo(() => {
		if (!routingReady) return undefined
		try {
			return createFolderRenameController(
				{
					routes: runtime.routes,
					authorize: collectionRouting
						? createCollectionFolderAuthorizer({
								configuration: collectionRouting,
								routes: runtime.routes,
								client,
								authorize: createFolderRenameAuthorizer({
									client,
									schema,
									currentUser,
									grantsStore,
								}),
							})
						: createFolderRenameAuthorizer({
								client,
								schema,
								currentUser,
								grantsStore,
							}),
				},
				client,
			)
		} catch {
			return undefined
		}
	}, [
		runtime,
		client,
		schema,
		currentUser,
		grantsStore,
		routingReady,
		collectionRouting,
	])
	function refreshRenamePending() {
		try {
			setRenamePending(!!renameController?.getPending())
		} catch {
			setRenamePending(true)
		}
	}
	useEffect(() => {
		try {
			setRenamePending(!!renameController?.getPending())
		} catch {
			setRenamePending(true)
		}
	}, [renameController])
	const syncRef = useRef<ReturnType<typeof createFolderSyncController> | null>(
		null,
	)
	const dataStore = useMemo(
		() => createPagesDataStore(runtime, () => syncRef.current?.notify()),
		[runtime],
	)
	// Unconfirmed writes outlive routing snapshots and controller replacements.
	const synchronizationState = useMemo(
		() => createFolderSynchronizationState(),
		[client],
	)
	const folderSync = useMemo(() => {
		let service: ReturnType<typeof createFolderSynchronizer> | undefined
		const getService = () => {
			service ??= createFolderSynchronizer(
				runtime.routes,
				client,
				collectionRouting
					? {
							state: synchronizationState,
							beforeRemove: async (signal) =>
								(
									await createCollectionRoutingGuard(
										collectionRouting,
										runtime.routes,
										client,
									)(signal)
								).ok,
						}
					: { state: synchronizationState },
			)
			return service
		}
		return createFolderSyncController(
			async (signal) => {
				// Older navigation-only configurations can be unsafe to author. Keep
				// browsing available and explain that limitation in manual feedback.
				try {
					getService()
				} catch {
					return { status: 'blocked', reason: 'configuration' }
				}
				return getService().synchronize(signal)
			},
			dataStore.refreshFolders,
			async (pathname, signal) => {
				try {
					getService()
				} catch {
					return { status: 'blocked', reason: 'configuration' }
				}
				return getService().create(pathname, signal)
			},
			async (pathname, signal) => {
				try {
					getService()
				} catch {
					return { status: 'blocked', reason: 'configuration' }
				}
				return getService().remove(pathname, signal)
			},
		)
	}, [runtime, client, dataStore, collectionRouting, synchronizationState])
	useEffect(() => {
		if (!routingReady) return
		syncRef.current = folderSync
		folderSync.start()
		return () => {
			syncRef.current = null
			folderSync.stop()
		}
	}, [folderSync, routingReady])
	useEffect(() => {
		if (routingReady) return
		setPageCreation(undefined)
		setFolderCreation(undefined)
		setFolderRemoval(undefined)
		setFolderRename(undefined)
		setSyncOpen(false)
		setPickerOpen(false)
	}, [routingReady])
	return (
		<BrowserContext.Provider
			value={{
				runtime,
				dataStore,
				folderSync,
				showPageCreate: (anchor, context) =>
					setPageCreation({ anchor, ...(context ? { context } : {}) }),
				showCollectionCreate: (anchor, collection) =>
					setPageCreation({ anchor, collection }),
				pageCreateOpen: Boolean(pageCreation),
				showFolderRemove: (pathname) => {
					setPickerOpen(false)
					setFolderRemoval(pathname)
				},
				showFolderRename: (pathname) => {
					setPickerOpen(false)
					setFolderRename(pathname ? { pathname } : {})
				},
				renameAvailable: !!renameController,
				renamePending,
				showFolderSync: () => {
					setPickerOpen(false)
					setSyncOpen(true)
				},
				showFolderCreate: (request) => {
					setPickerOpen(false)
					setFolderCreation(request)
				},
				state,
				setState,
				pickerOpen,
				setPickerOpen,
			}}
		>
			{children}
			{routingReady && pageCreation && (
				<PageCreateDialog
					runtime={
						pageCreation.collection
							? {
									...runtime,
									createChoices:
										runtime.collectionUi[pageCreation.collection]
											?.createChoices ?? [],
								}
							: runtime
					}
					title={
						pageCreation.collection
							? `Create ${runtime.collectionUi[pageCreation.collection]?.itemTitle ?? 'item'}`
							: 'Create page'
					}
					anchor={pageCreation.anchor}
					context={pageCreation.context}
					onClose={() => setPageCreation(undefined)}
					onCreated={() => {
						setPageCreation(undefined)
						setPickerOpen(false)
					}}
				/>
			)}
			{routingReady && folderCreation && (
				<PagesFolderCreateDialog
					request={folderCreation}
					folderSync={folderSync}
					onClose={() => setFolderCreation(undefined)}
					onCreated={(pathname) => {
						// Reveal the new folder without selecting a page or moving preview.
						const segments = pathname.split('/').filter(Boolean)
						const ancestors = new Set(
							segments.map(
								(_, index) =>
									`folder:/${segments.slice(0, index + 1).join('/')}`,
							),
						)
						setState((value) => ({
							...value,
							query: '',
							collapsed: value.collapsed.filter((key) => !ancestors.has(key)),
						}))
						setFolderCreation(undefined)
					}}
				/>
			)}
			{routingReady && folderRemoval && (
				<FolderRemoveDialog
					pathname={folderRemoval}
					folderSync={folderSync}
					onClose={() => setFolderRemoval(undefined)}
				/>
			)}
			{routingReady && folderRename && renameController && (
				<FolderRenameDialog
					controller={renameController}
					{...(folderRename.pathname
						? { pathname: folderRename.pathname }
						: {})}
					onClose={() => {
						setFolderRename(undefined)
						refreshRenamePending()
					}}
					onSettled={() => {
						dataStore.refresh()
						refreshRenamePending()
					}}
				/>
			)}
			{routingReady && syncOpen && (
				<FolderSyncDialog
					folderSync={folderSync}
					onClose={() => setSyncOpen(false)}
				/>
			)}
		</BrowserContext.Provider>
	)
}
