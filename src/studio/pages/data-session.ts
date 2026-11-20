/**
 * One shared read session for one tool/client/perspective. React consumers share
 * resources, not independent listeners. The sidebar can unmount while the header
 * keeps the session alive. See docs/pages.md: “Shared live-data loading”.
 */
import type { PagesRuntime } from './runtime.js'
import type {
	PagesDataEvent,
	PagesDataSource,
	PageQueryPlan,
} from './data-source.js'
import type { PageDocument } from './model.js'
import { buildNavigationTree } from './navigation.js'
import {
	collectionBatch,
	createNavigationQueries,
	type CollectionCursor,
	type NavigationDocument,
} from './queries.js'
import { readPageSnapshot } from './snapshot.js'
import type { FolderRecord } from '../folders/planner.js'
import { FOLDER_REGISTRY_ID, readNavigationFolders } from './folder-registry.js'

export const CHANGE_DELAY_MS = 150
export const RECONCILE_MS = 60_000

export interface DataSnapshot<T> {
	data: T
	loading: boolean
	refreshing: boolean
	error: boolean
	disconnected: boolean
}

interface ResourceControl {
	active(): boolean
	invalidate(forgetMembership?: boolean): void
	refresh(): void
	refreshIfDirty(): void
	reconcile(): void
	connection(disconnected: boolean): void
	reset(): void
}

type ReadScope = 'identity' | 'folders' | 'pages' | `collection:${string}`

/** Small external store: getSnapshot is stable until something actually changes. */
class DataResource<T> implements ResourceControl {
	private listeners = new Set<() => void>()
	private controller: AbortController | undefined
	private dirty = true
	private loaded = false
	private membershipKnown = false
	private snapshot: DataSnapshot<T>
	constructor(
		private initial: T,
		private load: (
			signal: AbortSignal,
			previous: T,
			append: boolean,
		) => Promise<T>,
		private owner: { retain(): void; release(): void },
		private canAppend: (data: T) => boolean = () => false,
		private clearWhenUnused = false,
	) {
		this.snapshot = this.empty()
	}
	private empty(): DataSnapshot<T> {
		return {
			data: this.initial,
			loading: true,
			refreshing: false,
			error: false,
			disconnected: false,
		}
	}
	private publish(update: Partial<DataSnapshot<T>>) {
		this.snapshot = { ...this.snapshot, ...update }
		for (const listener of this.listeners) listener()
	}
	getSnapshot = () => this.snapshot
	knownData = () => (this.membershipKnown ? this.snapshot.data : undefined)
	subscribe = (listener: () => void) => {
		// Separate subscriptions can legitimately use the same callback.
		const notify = () => listener()
		this.listeners.add(notify)
		this.owner.retain()
		if (this.dirty && !this.controller) this.refresh()
		return () => {
			if (!this.listeners.delete(notify)) return
			if (!this.active()) {
				if (this.clearWhenUnused) this.reset()
				else this.invalidate()
			}
			this.owner.release()
		}
	}
	active = () => this.listeners.size > 0
	invalidate = (forgetMembership = false) => {
		if (forgetMembership) this.membershipKnown = false
		this.dirty = true
		this.controller?.abort()
		this.controller = undefined
	}
	connection = (disconnected: boolean) => {
		if (this.snapshot.disconnected !== disconnected)
			this.publish(
				disconnected
					? { disconnected, loading: false, refreshing: false }
					: { disconnected },
			)
	}
	reset = () => {
		this.invalidate(true)
		this.loaded = false
		this.snapshot = {
			...this.empty(),
			disconnected: this.snapshot.disconnected,
		}
	}
	refresh = () => {
		if (this.active()) this.start(false)
	}
	refreshIfDirty = () => {
		if (this.dirty) this.refresh()
	}
	reconcile = () => {
		// A periodic check must not continually abort a slow multi-batch read.
		if (!this.controller) {
			this.dirty = true
			this.refresh()
		}
	}
	loadMore = () => {
		if (
			this.active() &&
			!this.dirty &&
			!this.controller &&
			!this.snapshot.error &&
			!this.snapshot.disconnected &&
			this.canAppend(this.snapshot.data)
		)
			this.start(true)
	}
	private start(append: boolean) {
		this.controller?.abort()
		const controller = new AbortController()
		this.controller = controller
		this.dirty = false
		this.publish({
			loading: !this.loaded,
			refreshing: this.loaded,
			error: false,
		})
		// Also catch a synchronously throwing adapter. Aborts AND controller identity
		// protect against a late response from a transport that ignores the signal.
		void Promise.resolve()
			.then(() => {
				controller.signal.throwIfAborted()
				return this.load(controller.signal, this.snapshot.data, append)
			})
			.then(
				(data) => {
					if (this.controller !== controller || controller.signal.aborted)
						return
					this.controller = undefined
					this.loaded = true
					this.membershipKnown = true
					this.publish({
						data,
						loading: false,
						refreshing: false,
						error: false,
					})
				},
				() => {
					if (this.controller !== controller || controller.signal.aborted)
						return
					this.controller = undefined
					this.dirty = true
					this.publish({ loading: false, refreshing: false, error: true })
				},
			)
	}
}

export interface CollectionData {
	documents: NavigationDocument[]
	next: CollectionCursor | undefined
	/** Re-read this many batches after a change so a long list does not collapse. */
	batches: number
}

/** Consumers can observe or extend a list, but only the session controls refreshes. */
export interface PagesDataResource<T> {
	getSnapshot: () => DataSnapshot<T>
	subscribe: (listener: () => void) => () => void
	loadMore: () => void
}

/** Named internal boundary keeps resource implementation details out of consumers. */
export interface PagesDataSession {
	/** Independent metadata resource: failures do not disable ordinary page reads. */
	folders: PagesDataResource<readonly FolderRecord[]>
	identity: (
		plan: PageQueryPlan | undefined,
	) => PagesDataResource<PageDocument[]>
	pages: PagesDataResource<{
		documents: NavigationDocument[]
		tree: ReturnType<typeof buildNavigationTree>
	}>
	recent: (name: string) => PagesDataResource<{
		total: number
		documents: NavigationDocument[]
	}>
	collection: (
		name: string,
		search?: string,
	) => PagesDataResource<CollectionData>
	retry: () => void
	refreshFolders: () => void
}

export function createPagesDataSession(
	runtime: PagesRuntime,
	source: PagesDataSource,
	onPathsChanged?: () => void,
): PagesDataSession {
	const queries = createNavigationQueries(runtime.registry)
	const resources = new Map<
		ResourceControl,
		{
			scope: ReadScope
			documents: (() => readonly PageDocument[] | undefined) | undefined
		}
	>()
	const pending = new Set<ResourceControl>()
	const types = new Map(
		runtime.registry.types.map((type) => [type.schemaType, type]),
	)
	let references = 0
	let generation = 0
	let subscription: { unsubscribe(): void } | undefined
	let changeTimer: ReturnType<typeof setTimeout> | undefined
	let reconcileTimer: ReturnType<typeof setInterval> | undefined
	let disconnected = false

	function connection(value: boolean) {
		disconnected = value
		for (const resource of resources.keys()) resource.connection(value)
	}
	function clearPending() {
		clearTimeout(changeTimer)
		changeTimer = undefined
		pending.clear()
	}
	function refreshAll() {
		clearPending()
		for (const resource of resources.keys()) {
			resource.invalidate(true)
			resource.refresh()
		}
	}
	function loseConnection() {
		connection(true)
		clearPending()
		for (const resource of resources.keys()) resource.invalidate(true)
	}
	function mutationScope(event: PagesDataEvent): ReadScope | undefined {
		if (event.documentId === FOLDER_REGISTRY_ID) return 'folders'
		if (disconnected || event.transition !== 'update' || !event.documentId)
			return

		// A same-document update cannot change its type. A create or delete can
		// change which version is visible, so those events refresh all resources.
		// Use the physical ID, since another version of the same canonical ID
		// isn't evidence about the document that generated the event.
		let schemaType: string | undefined
		for (const { documents } of resources.values()) {
			for (const document of documents?.() ?? []) {
				if ((document._originalId ?? document._id) !== event.documentId)
					continue
				if (schemaType && schemaType !== document._type) return
				schemaType = document._type
			}
		}
		const type = schemaType && types.get(schemaType)
		if (type) return type.collection ? `collection:${type.collection}` : 'pages'
	}
	function queueMutation(event: PagesDataEvent) {
		const scope = mutationScope(event)
		for (const [resource, entry] of resources) {
			if (
				!scope ||
				entry.scope === scope ||
				(scope !== 'folders' && entry.scope === 'identity')
			) {
				resource.invalidate(!scope)
				if (resource.active()) pending.add(resource)
			}
		}
		// Coalesce a burst without postponing forever during typing.
		changeTimer ??= setTimeout(() => {
			changeTimer = undefined
			for (const resource of pending) resource.refreshIfDirty()
			pending.clear()
		}, CHANGE_DELAY_MS)
	}
	function listen() {
		const token = ++generation
		subscription?.unsubscribe()
		try {
			subscription = source.listen({
				next: (event) => {
					if (token !== generation || references === 0) return
					if (event.type === 'reconnect') {
						loseConnection()
					} else if (event.type === 'welcome') {
						connection(false)
						// Refetch after establishment/reconnection to close the gap
						// between an initial query and the listener becoming ready.
						refreshAll()
					} else if (event.type === 'mutation') {
						queueMutation(event)
					}
				},
				error: () => {
					if (token !== generation || references === 0) return
					loseConnection()
				},
			})
		} catch {
			loseConnection()
		}
	}
	const owner = {
		retain() {
			if (++references !== 1) return
			listen()
			// Query visibility is best-effort, including deferred transactions. A
			// periodic read repairs missed/early notifications while the tool is open.
			reconcileTimer = setInterval(() => {
				if (!disconnected) {
					for (const resource of resources.keys()) resource.reconcile()
				}
			}, RECONCILE_MS)
		},
		release() {
			if (--references !== 0) return
			generation++
			subscription?.unsubscribe()
			subscription = undefined
			clearPending()
			clearInterval(reconcileTimer)
			connection(false)
			for (const resource of resources.keys()) resource.reset()
		},
	}
	function resource<T>(
		scope: ReadScope,
		initial: T,
		load: (signal: AbortSignal, previous: T, append: boolean) => Promise<T>,
		options: {
			documents?: (data: T) => readonly PageDocument[]
			canAppend?: (data: T) => boolean
			clearWhenUnused?: boolean
		} = {},
	) {
		const result = new DataResource(
			initial,
			load,
			owner,
			options.canAppend,
			options.clearWhenUnused,
		)
		result.connection(disconnected)
		const documents = options.documents
		resources.set(result, {
			scope,
			documents:
				documents &&
				(() => {
					const data = result.knownData()
					return data === undefined ? undefined : documents(data)
				}),
		})
		return result
	}
	const identities = new Map<string, DataResource<PageDocument[]>>()
	const folders = resource<readonly FolderRecord[]>(
		'folders',
		[],
		async (signal) => {
			const input = await source.fetchFolderRegistry(signal)
			signal.throwIfAborted()
			return readNavigationFolders(runtime.registry, input)
		},
	)
	let pathSignature: string | undefined
	const pages = resource<{
		documents: NavigationDocument[]
		tree: ReturnType<typeof buildNavigationTree>
	}>(
		'pages',
		{ documents: [], tree: { roots: [], unfiled: [] } },
		async (signal) => {
			const documents = await readPageSnapshot(
				queries,
				(plan, abort) => source.fetch(plan, abort),
				signal,
			)
			const signature = JSON.stringify(
				documents.map((document) => [document._id, document.pathname]),
			)
			if (pathSignature !== signature) {
				pathSignature = signature
				onPathsChanged?.()
			}
			return {
				documents,
				tree: buildNavigationTree(runtime.registry, documents),
			}
		},
		{ documents: (data) => data.documents },
	)
	const recent = new Map<
		string,
		DataResource<{ total: number; documents: NavigationDocument[] }>
	>()
	const collections = new Map<string, DataResource<CollectionData>>()
	return {
		folders,
		refreshFolders: () => folders.reconcile(),
		identity(plan) {
			const key = JSON.stringify(plan ?? null)
			if (!identities.has(key))
				identities.set(
					key,
					resource<PageDocument[]>(
						'identity',
						[],
						(signal) =>
							plan ? source.fetch(plan, signal) : Promise.resolve([]),
						{ documents: (data) => data, clearWhenUnused: true },
					),
				)
			// Keep resource identity stable across renders. Disused results are cleared
			// on unsubscribe, so returning to a URL cannot flash an old title or notice.
			return identities.get(key)!
		},
		pages,
		recent(name: string) {
			const plan = queries.recent(name)
			if (!recent.has(name))
				recent.set(
					name,
					resource(
						`collection:${name}`,
						{ total: 0, documents: [] as NavigationDocument[] },
						(signal) => source.fetch(plan, signal),
						{ documents: (data) => data.documents },
					),
				)
			return recent.get(name)!
		},
		collection(name: string, search = '') {
			const normalized = search.trim().toLowerCase()
			queries.collection(name, normalized) // Validate even before subscription.
			const key = JSON.stringify([name, normalized])
			// Keep the current search warm across sidebar/picker mounts, but do not
			// retain every previously searched collection's document arrays forever.
			for (const [otherKey, other] of collections) {
				if (otherKey !== key && !other.active()) other.reset()
			}
			if (!collections.has(key))
				collections.set(
					key,
					resource<CollectionData>(
						`collection:${name}`,
						{ documents: [], next: undefined, batches: 0 },
						async (signal, previous, append) => {
							let next = append ? previous.next : undefined
							let batches = append ? previous.batches : 0
							const documents = new Map(
								(append ? previous.documents : []).map((document) => [
									document._id,
									document,
								]),
							)
							const count = append ? 1 : Math.max(previous.batches, 1)
							for (let i = 0; i < count; i++) {
								signal.throwIfAborted()
								const result = await source.fetch<NavigationDocument[]>(
									queries.collection(name, normalized, next),
									signal,
								)
								signal.throwIfAborted()
								const batch = collectionBatch(result)
								for (const document of batch.documents)
									documents.set(document._id, document)
								batches++
								next = batch.next
								if (!next) break
							}
							return { documents: [...documents.values()], next, batches }
						},
						{
							documents: (data) => data.documents,
							canAppend: (data) => data.next !== undefined,
						},
					),
				)
			return collections.get(key)!
		},
		retry: () => {
			if (!references) return
			if (disconnected) listen()
			refreshAll()
		},
	}
}
