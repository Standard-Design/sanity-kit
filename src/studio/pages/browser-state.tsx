import type { PagesRuntime } from './runtime.js'
import {
	createContext,
	useContext,
	useState,
	useMemo,
	type PropsWithChildren,
} from 'react'
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
	const [pickerOpen, setPickerOpen] = useState(false)
	const dataStore = useMemo(() => createPagesDataStore(runtime), [runtime])
	return (
		<BrowserContext.Provider
			value={{ runtime, dataStore, state, setState, pickerOpen, setPickerOpen }}
		>
			{children}
		</BrowserContext.Provider>
	)
}

export function useBrowserState() {
	const context = useContext(BrowserContext)
	if (!context)
		throw new Error('Pages browser must be inside its tool provider.')
	return context
}
