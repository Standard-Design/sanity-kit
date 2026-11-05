import type { PagesRuntime } from './runtime.js'
import {
	useState,
	useMemo,
	useEffect,
	useRef,
	type PropsWithChildren,
} from 'react'
import { useClient } from 'sanity'
import { createFolderSynchronizer } from '../folders/synchronize.js'
import { createFolderSyncController } from '../folders/sync-controller.js'
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
}: PropsWithChildren<{ runtime: PagesRuntime }>) {
	const [state, setState] = useState<BrowserState>({
		query: '',
		scrollTop: 0,
		collapsed: [],
		collectionQueries: {},
		collectionScroll: {},
	})
	const [pageCreation, setPageCreation] = useState<{
		anchor: HTMLButtonElement
		context?: { mode: 'page' | 'index'; pathname: string }
	}>()
	const [syncOpen, setSyncOpen] = useState(false)
	const [folderCreation, setFolderCreation] = useState<FolderCreationRequest>()
	const [pickerOpen, setPickerOpen] = useState(false)
	const client = useClient({ apiVersion: '2026-10-01' })
	const syncRef = useRef<ReturnType<typeof createFolderSyncController> | null>(
		null,
	)
	const dataStore = useMemo(
		() => createPagesDataStore(runtime, () => syncRef.current?.notify()),
		[runtime],
	)
	const folderSync = useMemo(() => {
		let service: ReturnType<typeof createFolderSynchronizer> | undefined
		const getService = () => {
			service ??= createFolderSynchronizer(runtime.routes, client)
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
		)
	}, [runtime, client, dataStore])
	useEffect(() => {
		syncRef.current = folderSync
		folderSync.start()
		return () => {
			syncRef.current = null
			folderSync.stop()
		}
	}, [folderSync])
	return (
		<BrowserContext.Provider
			value={{
				runtime,
				dataStore,
				folderSync,
				showPageCreate: (anchor, context) =>
					setPageCreation({ anchor, ...(context ? { context } : {}) }),
				pageCreateOpen: Boolean(pageCreation),
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
			{pageCreation && (
				<PageCreateDialog
					runtime={runtime}
					anchor={pageCreation.anchor}
					context={pageCreation.context}
					onClose={() => setPageCreation(undefined)}
					onCreated={() => {
						setPageCreation(undefined)
						setPickerOpen(false)
					}}
				/>
			)}
			{folderCreation && (
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
			{syncOpen && (
				<FolderSyncDialog
					folderSync={folderSync}
					onClose={() => setSyncOpen(false)}
				/>
			)}
		</BrowserContext.Provider>
	)
}
