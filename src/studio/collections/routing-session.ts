/**
 * Private read boundary for settings-aware Studio routing. One store belongs to
 * one tool, client and immutable configuration. Its published and draft sessions
 * never share resolved URLs. Pages and standalone URL fields subscribe through
 * use-routing.ts. Loading a view never grants permission to publish or mutate.
 * @see docs/collection-routing.md
 */
import {
	createCollectionRoutingLoader,
	type CollectionSettingsClient,
	type CollectionSettingsLoadResult,
} from '../../url/settings/load.js'
import {
	createCollectionRouting,
	type CollectionRoutingConfig,
	type CollectionRoutingResult,
	type RoutingPerspective,
} from '../../url/settings/resolve.js'

type ReadyRouting = Extract<CollectionRoutingResult, { ok: true }>['value']
type Failure = Extract<CollectionSettingsLoadResult, { ok: false }>
export type CollectionRoutingSnapshot =
	| { readonly status: 'loading'; readonly perspective: RoutingPerspective }
	| {
			readonly status: 'ready'
			readonly perspective: RoutingPerspective
			readonly value: ReadyRouting
	  }
	| {
			readonly status: 'unavailable'
			readonly reason: Failure['reason'] | 'disconnected' | 'disposed'
			readonly collection?: string
			readonly perspective?: RoutingPerspective
	  }

/** Use the public client's query-visible listener, not a Studio internal hook. */
export interface CollectionRoutingClient extends CollectionSettingsClient {
	withConfig(
		config: Parameters<CollectionSettingsClient['withConfig']>[0],
	): ReturnType<CollectionSettingsClient['withConfig']> & {
		listen(
			query: string,
			params: { ids: string[] },
			options: {
				includeResult: false
				includeMutations: false
				includeAllVersions: true
				visibility: 'query'
				events: ['welcome', 'mutation', 'reconnect']
			},
		): {
			subscribe(observer: {
				next: (event: { type: string }) => void
				error: () => void
				complete: () => void
			}): { unsubscribe(): void }
		}
	}
}

export interface CollectionRoutingSessionOptions {
	/**
	 * The integration must prove visibility of every listed draft identity. A
	 * successful content query is not that proof: Sanity can hide unreadable rows.
	 * Rechecked on each refresh; rejected checks remain access-unconfirmed.
	 */
	readonly confirmDraftVisibility?: (
		requiredDraftIds: readonly string[],
		signal: AbortSignal,
	) => Promise<boolean>
}

export interface CollectionRoutingSession {
	readonly getSnapshot: () => CollectionRoutingSnapshot
	readonly subscribe: (listener: () => void) => () => void
	readonly retry: () => void
}

/** Releases and variants need their own policy; never silently treat them as drafts. */
export function collectionRoutingPerspective(
	stack: readonly string[],
	variant?: string,
): RoutingPerspective | undefined {
	if (variant !== undefined) return undefined
	if (!stack.length || (stack.length === 1 && stack[0] === 'published'))
		return 'published'
	if (
		(stack.length === 1 && stack[0] === 'drafts') ||
		(stack.length === 2 && stack[0] === 'drafts' && stack[1] === 'published')
	)
		return 'drafts'
	return undefined
}

/**
 * Metadata for the loading/error shell. Settings remain reachable even
 * when no URL can be resolved. These are editor targets, never fallback routes.
 */
function settingsDocuments(config: CollectionRoutingConfig) {
	return Object.freeze(
		(config.collections ?? []).flatMap((collection) =>
			collection.settingsDocumentId
				? [
						Object.freeze({
							collection: collection.name,
							documentId: collection.settingsDocumentId,
							title:
								collection.displayName?.value ??
								collection.title ??
								collection.name,
						}),
					]
				: [],
		),
	)
}

export function createCollectionRoutingStore(
	configuration: CollectionRoutingConfig,
	client: CollectionRoutingClient,
	options: CollectionRoutingSessionOptions = {},
) {
	const config = structuredClone(configuration)
	const routing = createCollectionRouting(config)
	const loader = createCollectionRoutingLoader(config, client)
	const confirmDraftVisibility = options.confirmDraftVisibility
	const sessions = new Map<string, ReturnType<typeof createSession>>()
	let disposed = false

	function createSession(perspective: RoutingPerspective | undefined) {
		const listeners = new Set<() => void>()
		const ids = [...routing.documentIds]
		const draftIds = Object.freeze(ids.map((id) => `drafts.${id}`))
		if (perspective === 'drafts') ids.push(...draftIds)
		let request: AbortController | undefined
		let subscription: { unsubscribe(): void } | undefined
		let generation = 0
		let connection = 0
		let waitingForWelcome = false
		let closed = false
		function initial(): CollectionRoutingSnapshot {
			if (!perspective)
				return { status: 'unavailable', reason: 'unsupported-perspective' }
			if (!ids.length) {
				const result = routing.resolve(undefined, perspective)
				if (result.ok)
					return { status: 'ready', perspective, value: result.value }
				return { status: 'unavailable', perspective, reason: result.reason }
			}
			return { status: 'loading', perspective }
		}
		let snapshot = initial()
		const active = () => !closed && !disposed && listeners.size > 0
		function publish(next: CollectionRoutingSnapshot) {
			snapshot = Object.freeze(next)
			for (const listener of listeners) listener()
		}
		function cancel() {
			generation += 1
			request?.abort()
			request = undefined
		}
		function stop() {
			cancel()
			connection += 1
			subscription?.unsubscribe()
			subscription = undefined
		}
		function disconnect() {
			stop()
			publish({
				status: 'unavailable',
				reason: 'disconnected',
				...(perspective ? { perspective } : {}),
			})
		}
		function refresh() {
			if (!active() || !perspective || !ids.length || waitingForWelcome) return
			cancel()
			publish({ status: 'loading', perspective })
			const version = generation
			// Several synchronous mutation notifications cause one new read. Old
			// routes disappear immediately rather than remaining clickable meanwhile.
			queueMicrotask(() => {
				if (!active() || generation !== version) return
				const controller = new AbortController()
				request = controller
				const current = () =>
					active() &&
					request === controller &&
					generation === version &&
					!controller.signal.aborted
				void (async () => {
					let draftVisibility: 'all-required-drafts' | undefined
					if (perspective === 'drafts') {
						let confirmed = false
						try {
							confirmed =
								(await confirmDraftVisibility?.(
									draftIds,
									controller.signal,
								)) === true
						} catch {
							/* A failed access check is not proof of visibility. */
						}
						if (!current()) return
						if (!confirmed) {
							request = undefined
							publish({
								status: 'unavailable',
								perspective,
								reason: 'access-unconfirmed',
							})
							return
						}
						draftVisibility = 'all-required-drafts'
					}
					const result = await loader.load({
						perspective,
						signal: controller.signal,
						...(draftVisibility ? { draftVisibility } : {}),
					})
					if (!current()) return
					request = undefined
					publish(
						result.ok
							? { status: 'ready', perspective, value: result.value }
							: {
									status: 'unavailable',
									perspective,
									reason: result.reason,
									...('collection' in result && result.collection
										? { collection: result.collection }
										: {}),
								},
					)
				})()
			})
		}
		function connect() {
			if (!active() || !perspective || !ids.length || subscription) return
			waitingForWelcome = false
			const version = ++connection
			try {
				const next = client
					.withConfig({
						apiVersion: '2026-10-01',
						useCdn: false,
						perspective: 'raw',
						stega: false,
					})
					.listen(
						'*[_id in $ids]',
						{ ids: [...ids] },
						{
							includeResult: false,
							includeMutations: false,
							includeAllVersions: true,
							visibility: 'query',
							events: ['welcome', 'mutation', 'reconnect'],
						},
					)
					.subscribe({
						next: (event) => {
							if (!active() || connection !== version) return
							if (event.type === 'reconnect') {
								// Retry must not restore routes while the listener is still
								// disconnected: later settings changes could go unnoticed.
								waitingForWelcome = true
								cancel()
								publish({
									status: 'unavailable',
									perspective,
									reason: 'disconnected',
								})
							} else if (event.type === 'welcome') {
								waitingForWelcome = false
								refresh()
							} else if (event.type === 'mutation') refresh()
						},
						error: () => {
							if (connection === version) disconnect()
						},
						complete: () => {
							if (connection === version) disconnect()
						},
					})
				if (active() && connection === version) subscription = next
				else next.unsubscribe()
			} catch {
				if (connection === version) disconnect()
			}
		}
		const api: CollectionRoutingSession = Object.freeze({
			getSnapshot: () => snapshot,
			subscribe: (listener: () => void) => {
				const notify = () => listener()
				listeners.add(notify)
				if (!closed && !disposed && listeners.size === 1) {
					connect()
					if (subscription) refresh()
				}
				return () => {
					if (!listeners.delete(notify) || listeners.size) return
					stop()
					if (!closed && !disposed) snapshot = initial()
				}
			},
			retry: () => {
				connect()
				if (subscription) refresh()
			},
		})
		return {
			api,
			close: () => {
				closed = true
				stop()
				publish({
					status: 'unavailable',
					reason: 'disposed',
					...(perspective ? { perspective } : {}),
				})
			},
		}
	}
	return Object.freeze({
		settingsDocuments: settingsDocuments(config),
		session(
			stack: readonly string[],
			variant?: string,
		): CollectionRoutingSession {
			const perspective = collectionRoutingPerspective(stack, variant)
			const key = perspective ?? 'unsupported'
			let session = sessions.get(key)
			if (!session) {
				session = createSession(perspective)
				sessions.set(key, session)
				if (disposed) session.close()
			}
			return session.api
		},
		dispose() {
			if (disposed) return
			disposed = true
			for (const session of sessions.values()) session.close()
		},
	})
}
