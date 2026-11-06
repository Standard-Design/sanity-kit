/**
 * Studio labels are editorial metadata, not routing configuration. This reader
 * watches only registered settings documents and never loads or applies prefixes.
 * Draft names are visible throughout Studio as soon as Sanity saves them, even
 * when the website preview is showing published content.
 */
import {
	createContext,
	useContext,
	useEffect,
	useMemo,
	useState,
	type ReactNode,
} from 'react'
import { useClient } from 'sanity'
import {
	COLLECTION_ROUTE_TYPE,
	MAX_COLLECTION_DISPLAY_NAME_LENGTH,
	type CollectionRoutingConfig,
} from '../../url/settings/resolve.js'

export type CollectionDisplayNames = Readonly<Record<string, string>>
const emptyNames: CollectionDisplayNames = Object.freeze(
	Object.create(null) as Record<string, string>,
)
const DisplayNamesContext = createContext<CollectionDisplayNames>(emptyNames)

export function useCollectionDisplayNames(): CollectionDisplayNames {
	return useContext(DisplayNamesContext)
}

/** Reject mismatched identities before a settings document can label a collection. */
export function resolveCollectionDisplayNames(
	routes: CollectionRoutingConfig,
	documents: readonly unknown[],
): CollectionDisplayNames {
	const names: Record<string, string> = Object.create(null) as Record<
		string,
		string
	>
	for (const collection of routes.collections ?? []) {
		names[collection.name] =
			collection.displayName?.value ?? collection.title ?? collection.name
		if (
			collection.displayName?.mode === 'locked' ||
			!collection.settingsDocumentId
		)
			continue
		const id = collection.settingsDocumentId
		const candidates = documents.filter(
			(value): value is Record<string, unknown> =>
				!!value &&
				typeof value === 'object' &&
				!Array.isArray(value) &&
				'_id' in value &&
				(value._id === id || value._id === `drafts.${id}`),
		)
		const draft = candidates.find((value) => value._id === `drafts.${id}`)
		const document = draft ?? candidates.find((value) => value._id === id)
		// An existing invalid/blank draft is an explicit edit: fall back to the
		// configured label rather than showing an older published name instead.
		if (
			document?._type !== COLLECTION_ROUTE_TYPE ||
			document.collection !== collection.name
		)
			continue
		if (
			typeof document.displayName === 'string' &&
			document.displayName.trim() &&
			document.displayName.length <= MAX_COLLECTION_DISPLAY_NAME_LENGTH
		) {
			names[collection.name] = document.displayName.trim()
		}
	}
	return names
}

const metadataQuery = '*[_id in $ids]{_id, _type, collection, displayName}'

export function CollectionDisplayNamesProvider({
	routes,
	children,
}: {
	readonly routes: CollectionRoutingConfig
	readonly children: ReactNode
}) {
	const studioClient = useClient({ apiVersion: '2026-10-01' })
	const client = useMemo(
		() => studioClient.withConfig({ useCdn: false, perspective: 'raw' }),
		[studioClient],
	)
	const fallback = useMemo(
		() => resolveCollectionDisplayNames(routes, []),
		[routes],
	)
	const [snapshot, setSnapshot] = useState<{
		routes: CollectionRoutingConfig
		names: CollectionDisplayNames
	}>()
	useEffect(() => {
		const ids = (routes.collections ?? []).flatMap((collection) =>
			collection.displayName?.mode === 'locked' ||
			!collection.settingsDocumentId
				? []
				: [
						collection.settingsDocumentId,
						`drafts.${collection.settingsDocumentId}`,
					],
		)
		if (!ids.length) return
		let active = true
		let running = false
		let pending = false
		let generation = 0
		const abort = new AbortController()
		// Coalesce mutations while a request is running. A late initial response
		// must never overwrite a name changed after that request began.
		async function refresh() {
			generation += 1
			pending = true
			if (running) return
			running = true
			while (active && pending) {
				pending = false
				const requestedGeneration = generation
				try {
					const documents = await client.fetch<unknown[]>(
						metadataQuery,
						{ ids },
						{
							signal: abort.signal,
							tag: 'sanity-kit.collection-display-names',
						},
					)
					if (active && requestedGeneration === generation)
						setSnapshot({
							routes,
							names: resolveCollectionDisplayNames(
								routes,
								Array.isArray(documents) ? documents : [],
							),
						})
				} catch {
					if (active && requestedGeneration === generation)
						setSnapshot({ routes, names: fallback })
				}
			}
			running = false
		}
		// Listen first and refresh on connection/reconnection, closing the window
		// between the initial request and the server accepting the subscription.
		const subscription = client
			.listen(
				'*[_id in $ids]',
				{ ids },
				{
					includeResult: false,
					// The default transaction event can arrive before GROQ sees the save.
					// Refresh only after the new name is available to this query.
					visibility: 'query',
					events: ['welcome', 'mutation', 'reconnect'],
				},
			)
			.subscribe({
				next: () => {
					void refresh()
				},
				error: () => {
					generation += 1
					if (active) setSnapshot({ routes, names: fallback })
				},
			})
		void refresh()
		return () => {
			active = false
			abort.abort()
			subscription.unsubscribe()
		}
	}, [client, fallback, routes])
	return (
		<DisplayNamesContext.Provider
			value={snapshot?.routes === routes ? snapshot.names : fallback}
		>
			{children}
		</DisplayNamesContext.Provider>
	)
}
