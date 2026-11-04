import type { PagesRuntime } from './runtime.js'
import {
	createContext,
	useContext,
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
import { createPagesDataStore } from './data-store.js'

/** Browser UI state is separate from cached data and native URL/document selection. */
export interface BrowserState {
	query: string
	scrollTop: number
	collapsed: string[]
	collection?: string | undefined
	collectionQueries: Record<string, string>
	collectionScroll: Record<string, number>
}

const BrowserContext = createContext<{
	runtime: PagesRuntime
	dataStore: ReturnType<typeof createPagesDataStore>
	folderSync: ReturnType<typeof createFolderSyncController>
	showFolderSync: () => void
	state: BrowserState
	setState: React.Dispatch<React.SetStateAction<BrowserState>>
	pickerOpen: boolean
	setPickerOpen: React.Dispatch<React.SetStateAction<boolean>>
} | null>(null)

/** Mounted around the native tool, not around its disposable navigator panel. */
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
	const [syncOpen, setSyncOpen] = useState(false)
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
		return createFolderSyncController(async (signal) => {
			// Older navigation-only configurations can be unsafe to author. Keep
			// browsing available and explain that limitation in manual feedback.
			try {
				service ??= createFolderSynchronizer(runtime.routes, client)
			} catch {
				return { status: 'blocked', reason: 'configuration' }
			}
			return service.synchronize(signal)
		}, dataStore.refreshFolders)
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
				showFolderSync: () => {
					setPickerOpen(false)
					setSyncOpen(true)
				},
				state,
				setState,
				pickerOpen,
				setPickerOpen,
			}}
		>
			{children}
			{syncOpen && (
				<FolderSyncDialog
					folderSync={folderSync}
					onClose={() => setSyncOpen(false)}
				/>
			)}
		</BrowserContext.Provider>
	)
}

export function useBrowserState() {
	const context = useContext(BrowserContext)
	if (!context)
		throw new Error('Pages browser must be inside its tool provider.')
	return context
}
