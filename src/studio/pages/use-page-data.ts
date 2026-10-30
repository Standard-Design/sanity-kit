/** Read the native perspective inside Presentation, not above its provider. */
import { useSyncExternalStore } from 'react'
import { useClient, usePerspective } from 'sanity'
import { useBrowserState } from './browser-state.js'

export function usePagesDataSession() {
	const { dataStore } = useBrowserState()
	const client = useClient({ apiVersion: '2026-10-01' })
	const { perspectiveStack } = usePerspective()
	// The store keys by value rather than array identity. A new array from a native
	// render must not reconnect the listener. A different perspective gets an empty
	// session immediately, before effects, so the previous view cannot flash onscreen.
	return dataStore.session(client, perspectiveStack)
}

/** Read only the preview URL and edited ID, independently of browsing/pagination. */
export function usePageIdentity(preview?: string, id?: string, type?: string) {
	const { runtime } = useBrowserState()
	const session = usePagesDataSession()
	const previewResource = session.identity(runtime.model.previewQuery(preview))
	const documentResource = session.identity(
		runtime.model.documentQuery(id, type),
	)
	const previewResult = useSyncExternalStore(
		previewResource.subscribe,
		previewResource.getSnapshot,
		previewResource.getSnapshot,
	)
	const documentResult = useSyncExternalStore(
		documentResource.subscribe,
		documentResource.getSnapshot,
		documentResource.getSnapshot,
	)
	return {
		current: runtime.model.previewedDocument(previewResult.data, preview),
		edited: documentResult.data[0],
	}
}
