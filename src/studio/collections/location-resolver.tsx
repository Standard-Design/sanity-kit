/**
 * Native Presentation installs its location banner as form middleware, outside
 * tool options. Bind that unchanged middleware to a workspace-local routing
 * store so its public Observable resolver also follows settings updates.
 */
import { useEffect, type ComponentType } from 'react'
import {
	isDocumentSchemaType,
	useDocumentStore,
	useDocumentPreviewStore,
	type DocumentStore,
	type InputProps,
} from 'sanity'
import type {
	DocumentLocationResolver,
	DocumentLocationsState,
	PresentationPluginOptions,
} from 'sanity/presentation'
import {
	BehaviorSubject,
	defer,
	finalize,
	Observable,
	of,
	switchMap,
	map,
	catchError,
} from 'rxjs'
import type { CollectionRoutingConfig } from '../../url/settings/resolve.js'
import { createPagesRegistry, storedPagePathname } from '../../url/registry.js'
import { fieldExpression } from '../pages/resolvers.js'
import { useCollectionRoutingStore } from './use-routing.js'

type Store = NonNullable<ReturnType<typeof useCollectionRoutingStore>>
type BoundStore = {
	store: Store
	previewStore: ReturnType<typeof useDocumentPreviewStore>
	schemaType: InputProps['schemaType']
}
const unavailable: DocumentLocationsState = {
	locations: [],
	tone: 'caution',
	message:
		'Collection URLs are unavailable. Check collection settings before previewing this page.',
}

export function createCollectionLocationBridge(
	configuration: CollectionRoutingConfig,
	overrides?: NonNullable<PresentationPluginOptions['resolve']>['locations'],
) {
	const pageTypes = new Set([
		...configuration.pages.map((page) => page.schemaType),
		...(configuration.collections ?? []).flatMap((collection) =>
			collection.items.map((item) => item.schemaType),
		),
	])
	const workspaces = new WeakMap<
		DocumentStore,
		Map<
			string,
			{
				readers: number
				stores: Map<symbol, BoundStore>
				current: BehaviorSubject<BoundStore | undefined>
			}
		>
	>()
	function binding(documentStore: DocumentStore, id: string) {
		let documents = workspaces.get(documentStore)
		if (!documents) {
			documents = new Map()
			workspaces.set(documentStore, documents)
		}
		let entry = documents.get(id)
		if (!entry) {
			entry = {
				readers: 0,
				stores: new Map(),
				current: new BehaviorSubject<BoundStore | undefined>(undefined),
			}
			documents.set(id, entry)
		}
		return entry
	}
	const locations: DocumentLocationResolver = (params, { documentStore }) => {
		if (typeof overrides === 'function')
			return overrides(params, { documentStore })
		const override = overrides?.[params.type]
		if (override && !('select' in override)) return override
		// Settings, redirects and shared content are editable documents, but do
		// not own page URLs. A routing failure must not give them a false warning.
		if (!override && !pageTypes.has(params.type)) return null
		return defer(() => {
			const entry = binding(documentStore, params.id)
			entry.readers += 1
			return entry.current.pipe(
				switchMap((bound) => {
					if (!bound) return of(unavailable)
					const { store } = bound
					if (override && 'select' in override)
						return bound.previewStore
							.observeForPreview(
								{ _type: 'reference', _ref: params.id },
								{ ...bound.schemaType, preview: { select: override.select } },
								{
									perspective: params.perspectiveStack,
									...(params.variant ? { variant: params.variant } : {}),
								},
							)
							.pipe(
								map(
									(preview) =>
										override.resolve(
											preview.snapshot as Record<string, unknown> | null,
										) ?? undefined,
								),
								catchError(() => of(unavailable)),
							)
					const stack =
						params.version && !['drafts', 'published'].includes(params.version)
							? ['unsupported-release']
							: params.perspectiveStack
					const session = store.session(stack, params.variant)
					return new Observable<ReturnType<typeof session.getSnapshot>>(
						(subscriber) => {
							const emit = () => subscriber.next(session.getSnapshot())
							const unsubscribe = session.subscribe(emit)
							emit()
							return unsubscribe
						},
					).pipe(
						switchMap((snapshot) => {
							if (snapshot.status !== 'ready') return of(unavailable)
							const registry = createPagesRegistry(snapshot.value.routes)
							const type = registry.types.find(
								(item) => item.schemaType === params.type,
							)
							if (!type) return of({ locations: [] })
							const query = `*[_id == $id][0]{"title": ${fieldExpression(type.titleField)}, "pathname": ${fieldExpression(type.pathField)}}`
							return documentStore
								.listenQuery(
									query,
									{ id: params.id },
									{ perspective: params.perspectiveStack },
								)
								.pipe(
									map((value: unknown): DocumentLocationsState => {
										const document =
											value && typeof value === 'object'
												? (value as Record<string, unknown>)
												: undefined
										const href = storedPagePathname(
											registry,
											type,
											document?.pathname,
										)
										return href
											? {
													locations: [
														{
															title:
																typeof document?.title === 'string' &&
																document.title.trim()
																	? document.title
																	: 'Untitled',
															href,
														},
													],
												}
											: {
													locations: [],
													tone: 'caution',
													message:
														'This document has no previewable page URL. Check its URL field.',
												}
									}),
									catchError(() => of(unavailable)),
								)
						}),
					)
				}),
				finalize(() => {
					entry.readers -= 1
					if (!entry.readers && !entry.stores.size)
						workspaces.get(documentStore)?.delete(params.id)
				}),
			)
		})
	}
	function wrap(NativeInput: ComponentType<InputProps>) {
		function BoundDocument(props: InputProps) {
			const store = useCollectionRoutingStore(configuration)!
			const documentStore = useDocumentStore()
			const previewStore = useDocumentPreviewStore()
			const value = props.value as unknown
			const id =
				value &&
				typeof value === 'object' &&
				'_id' in value &&
				typeof value._id === 'string'
					? value._id.replace(/^drafts\./u, '')
					: undefined
			useEffect(() => {
				if (!id) return
				const entry = binding(documentStore, id)
				const lease = Symbol()
				const bound = { store, previewStore, schemaType: props.schemaType }
				entry.stores.set(lease, bound)
				entry.current.next(bound)
				return () => {
					entry.stores.delete(lease)
					entry.current.next([...entry.stores.values()].at(-1))
					if (!entry.readers && !entry.stores.size)
						workspaces.get(documentStore)?.delete(id)
				}
			}, [documentStore, id, store, previewStore, props.schemaType])
			return <NativeInput {...props} />
		}
		return function CollectionLocationsInput(props: InputProps) {
			return isDocumentSchemaType(props.schemaType) ? (
				<BoundDocument {...props} />
			) : (
				<NativeInput {...props} />
			)
		}
	}
	return { locations, wrap }
}
