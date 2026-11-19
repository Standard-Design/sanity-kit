/** Read the native perspective inside Presentation, not above its provider. */
import { useEffect, useEffectEvent, useRef, useSyncExternalStore } from 'react'
import { useClient, usePerspective } from 'sanity'
import {
	usePresentationNavigate,
	type PresentationParams,
} from 'sanity/presentation'
import { useBrowserState } from './browser-context.js'

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
export function usePageIdentity(params: PresentationParams) {
	const { preview, id, type } = params
	const { runtime } = useBrowserState()
	const session = usePagesDataSession()
	const { perspectiveStack, selectedReleaseId, selectedVariantNames } =
		usePerspective()
	const navigate = usePresentationNavigate()
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
	const edited = documentResult.data[0]
	const pathname = edited && runtime.model.documentPath(edited)
	const previous = useRef<{
		resource: typeof documentResource
		pathname?: string
	}>(undefined)
	const followSavedUrl =
		!!id &&
		!id.startsWith('versions.') &&
		!params.scheduledDraft &&
		!params.rev &&
		!selectedReleaseId &&
		!selectedVariantNames.length &&
		perspectiveStack.length === 1 &&
		(perspectiveStack[0] === 'drafts' || perspectiveStack[0] === 'published') &&
		runtime.registry.types.some((page) => page.schemaType === type)
	const movePreview = useEffectEvent((from: string, to: string) => {
		if (!preview) return
		const url = URL.parse(preview, 'https://pages.invalid')
		if (
			!url ||
			!['http:', 'https:'].includes(url.protocol) ||
			url.pathname !== from
		)
			return
		url.pathname = to
		navigate(
			preview.startsWith('/') && !preview.startsWith('//')
				? url.pathname + url.search + url.hash
				: url.href,
		)
	})
	useEffect(() => {
		if (
			!followSavedUrl ||
			documentResult.error ||
			documentResult.disconnected
		) {
			previous.current = undefined
			return
		}
		// A new document or perspective establishes a baseline. Only changes seen
		// in the shared query results can move the iframe, never form proposals.
		if (previous.current?.resource !== documentResource)
			previous.current = { resource: documentResource }
		// A refresh still exposes its previous data. Wait for a successful saved
		// result; a failed/disconnected read above discards the old baseline.
		if (documentResult.loading || documentResult.refreshing) return
		if (
			!pathname ||
			pathname.includes('//') ||
			(pathname !== '/' && pathname.endsWith('/'))
		)
			return
		const from = previous.current.pathname
		previous.current.pathname = pathname
		if (from && from !== pathname) movePreview(from, pathname)
	}, [
		documentResource,
		followSavedUrl,
		pathname,
		documentResult.error,
		documentResult.disconnected,
		documentResult.loading,
		documentResult.refreshing,
	])
	return {
		current: runtime.model.previewedDocument(previewResult.data, preview),
		edited,
	}
}
