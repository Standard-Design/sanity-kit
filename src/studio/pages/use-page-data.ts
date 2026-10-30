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

/** Transitional proof-list adapter. The tree UI will consume the same session. */
export function usePageDocuments() {
	const session = usePagesDataSession()
	const result = useSyncExternalStore(
		session.proof.subscribe,
		session.proof.getSnapshot,
		session.proof.getSnapshot,
	)
	return {
		documents: result.data,
		loading: result.loading,
		error: result.error || result.disconnected,
		refreshing: result.refreshing,
		retry: session.retry,
	}
}
