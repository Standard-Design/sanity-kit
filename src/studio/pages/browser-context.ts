/**
 * Keep context identity separate from the provider and dialog components.
 * Hot-reloading those components must not create a new context while native
 * Presentation slots still use the previous provider.
 */
import { createContext, useContext } from 'react'
import type { PagesRuntime } from './runtime.js'
import type { createPagesDataStore } from './data-store.js'
import type { createFolderSyncController } from '../folders/sync-controller.js'
import type { FolderCreationRequest } from './folder-create-dialog.js'

/** Browser UI state is separate from cached data and native URL/document selection. */
export interface BrowserState {
	query: string
	scrollTop: number
	collapsed: string[]
	collection?: string | undefined
	collectionQueries: Record<string, string>
	collectionScroll: Record<string, number>
}

export const BrowserContext = createContext<{
	runtime: PagesRuntime
	dataStore: ReturnType<typeof createPagesDataStore>
	folderSync: ReturnType<typeof createFolderSyncController>
	showPageCreate: (
		anchor: HTMLButtonElement,
		context?: { mode: 'page' | 'index'; pathname: string },
	) => void
	showCollectionCreate: (anchor: HTMLButtonElement, collection: string) => void
	pageCreateOpen: boolean
	showFolderSync: () => void
	showFolderRemove: (pathname: string) => void
	showFolderRename: (pathname?: string) => void
	renameAvailable: boolean
	renamePending: boolean
	showFolderCreate: (request: FolderCreationRequest) => void
	state: BrowserState
	setState: React.Dispatch<React.SetStateAction<BrowserState>>
	pickerOpen: boolean
	setPickerOpen: React.Dispatch<React.SetStateAction<boolean>>
} | null>(null)

export function useBrowserState() {
	const context = useContext(BrowserContext)
	if (!context)
		throw new Error('Pages browser must be inside its tool provider.')
	return context
}
