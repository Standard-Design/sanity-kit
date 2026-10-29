import type { PagesRuntime } from './runtime.js'
import {
	createContext,
	useContext,
	useState,
	type PropsWithChildren,
} from 'react'

/** Only browser UI state belongs here. Presentation still owns URL/document selection. */
export interface BrowserState {
	query: string
	scrollTop: number
}

const BrowserContext = createContext<{
	runtime: PagesRuntime
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
	const [state, setState] = useState<BrowserState>({ query: '', scrollTop: 0 })
	const [pickerOpen, setPickerOpen] = useState(false)
	return (
		<BrowserContext.Provider
			value={{ runtime, state, setState, pickerOpen, setPickerOpen }}
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
