/**
 * Shared, workspace-local routing subscription. Pages provides a store to nested
 * fields and actions; a standalone field owns the same store without Pages.
 * No store or resolved prefix is shared across workspaces in a global cache.
 */
import {
	createContext,
	createElement,
	useContext,
	useMemo,
	useSyncExternalStore,
	type ReactNode,
} from 'react'
import { useClient } from 'sanity'
import type { CollectionRoutingConfig } from '../../url/settings/resolve.js'
import { checkRoutingSettingsReadAccess } from '../url/access.js'
import {
	createCollectionRoutingStore,
	type CollectionRoutingSnapshot,
} from './routing-session.js'

type Store = ReturnType<typeof createCollectionRoutingStore>
const RoutingStoreContext = createContext<
	{ key: string; scope: string; store: Store } | undefined
>(undefined)
const drafts = ['drafts'] as const
const emptySubscribe = () => () => {}
const emptySnapshot = () => undefined

/** Configuration contains only data; key order must not create another store. */
function configurationKey(configuration: CollectionRoutingConfig | undefined) {
	return JSON.stringify(configuration, (_key, value: unknown) =>
		value && typeof value === 'object' && !Array.isArray(value)
			? Object.fromEntries(
					Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
				)
			: value,
	)
}

export function useCollectionRoutingStore(
	configuration: CollectionRoutingConfig | undefined,
) {
	const client = useClient({ apiVersion: '2026-10-01' })
	const context = useContext(RoutingStoreContext)
	const key = configurationKey(configuration)
	const source = configuration ? client.config() : undefined
	const scope = JSON.stringify([source?.projectId, source?.dataset])
	const shared =
		context && context.key === key && context.scope === scope
			? context.store
			: undefined
	return useMemo(() => {
		if (shared || !configuration) return shared
		const { projectId, dataset } = client.config()
		return createCollectionRoutingStore(configuration, client, {
			confirmDraftVisibility: async (ids, signal) => {
				if (!projectId || !dataset) return false
				const request = {
					url: `/projects/${projectId}/datasets/${dataset}/acl`,
					signal,
					fetch: { cache: 'no-store', next: undefined },
					tag: 'sanity-kit.collection-routing-access',
				} as const
				const grants: unknown = await client.request(request)
				return checkRoutingSettingsReadAccess(
					ids.flatMap((id) => [id, id.replace(/^drafts\./u, '')]),
					grants,
				).ok
			},
		})
	}, [configuration, client, shared])
}

export function CollectionRoutingProvider({
	configuration,
	children,
}: {
	configuration: CollectionRoutingConfig
	children: ReactNode
}) {
	const store = useCollectionRoutingStore(configuration)!
	const client = useClient({ apiVersion: '2026-10-01' })
	const { projectId, dataset } = client.config()
	const scope = JSON.stringify([projectId, dataset])
	const value = useMemo(
		() => ({ key: configurationKey(configuration), scope, store }),
		[configuration, scope, store],
	)
	return createElement(RoutingStoreContext.Provider, { value }, children)
}

type RoutingState = {
	snapshot: CollectionRoutingSnapshot
	retry: () => void
	settingsDocuments: Store['settingsDocuments']
}
export function useCollectionRouting(
	configuration: CollectionRoutingConfig,
	stack?: readonly string[],
	variant?: string,
): RoutingState
export function useCollectionRouting(
	configuration: CollectionRoutingConfig | undefined,
	stack?: readonly string[],
	variant?: string,
): RoutingState | undefined
export function useCollectionRouting(
	configuration: CollectionRoutingConfig | undefined,
	stack: readonly string[] = drafts,
	variant?: string,
): RoutingState | undefined {
	const store = useCollectionRoutingStore(configuration)
	const session = store?.session(stack, variant)
	const snapshot = useSyncExternalStore(
		session?.subscribe ?? emptySubscribe,
		session?.getSnapshot ?? emptySnapshot,
		session?.getSnapshot ?? emptySnapshot,
	)
	return store && session && snapshot
		? {
				snapshot,
				retry: session.retry,
				settingsDocuments: store.settingsDocuments,
			}
		: undefined
}
