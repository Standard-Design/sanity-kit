/** The private plugin enables editing only inside its paired Studio layout. */
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import {
	createPagesRegistry,
	type PagesRouteConfig,
} from '../../url/registry.js'
import {
	createCollectionRouting,
	type CollectionRoutingConfig,
} from '../../url/settings/resolve.js'

/** Fixed registration and dynamic settings must describe the same storage. */
export function assertCollectionRouteRegistration(
	routes: PagesRouteConfig,
	settings: CollectionRoutingConfig,
) {
	createCollectionRouting(settings)
	const signature = (config: CollectionRoutingConfig) =>
		JSON.stringify({
			types: [
				...config.pages.map((page) => [
					page.schemaType,
					page.pathnameField,
					'pathname',
					null,
					page.titleField ?? 'title',
				]),
				...(config.collections ?? []).flatMap((collection) =>
					collection.items.map((item) => [
						item.schemaType,
						'slugField' in item ? item.slugField : item.pathnameField,
						'slugField' in item ? 'slug' : 'pathname',
						collection.name,
						item.titleField ?? 'title',
					]),
				),
			].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
			collections: (config.collections ?? [])
				.map((collection) => [
					collection.name,
					collection.index.schemaType,
					collection.index.pathname,
				])
				.sort((a, b) => a[0]!.localeCompare(b[0]!)),
			excludePaths: [...(config.excludePaths ?? [])].sort(),
			reservedPathPrefixes: [...(config.reservedPathPrefixes ?? [])].sort(),
		})
	if (signature(routes) !== signature(settings))
		throw new Error(
			'URL collectionRouting must register the same document types, fields, collections, and reserved paths as its routes.',
		)
}

const EnabledRoutes = createContext<readonly string[]>([])
/** Compare checked route meaning, independent of object key or array ordering. */
export function urlPublicationConfigKey(
	routes: PagesRouteConfig,
	collectionRouting?: CollectionRoutingConfig,
) {
	const registry = createPagesRegistry(routes)
	return JSON.stringify({
		collectionRouting: collectionRouting ?? null,
		types: [...registry.types]
			.sort((a, b) => a.schemaType.localeCompare(b.schemaType))
			.map((type) => ({
				schemaType: type.schemaType,
				pathField: type.pathField,
				pathMode: type.pathMode,
				routePrefix: type.routePrefix ?? null,
				titleField: type.titleField,
				collection: type.collection ?? null,
			})),
		collections: [...registry.collections]
			.sort((a, b) => a.name.localeCompare(b.name))
			.map((collection) => ({
				name: collection.name,
				title: collection.title,
				itemsTitle: collection.itemsTitle ?? collection.title,
				routePrefix: collection.routePrefix,
				index: {
					schemaType: collection.index.schemaType,
					pathname: collection.index.pathname,
				},
			})),
		excludePaths: [...registry.excludePaths].sort(),
		reservedPathPrefixes: [...registry.reservedPathPrefixes].sort(),
	})
}

export function UrlPublicationProvider({
	configKey,
	children,
}: {
	configKey: string
	children: ReactNode
}) {
	const inherited = useContext(EnabledRoutes)
	const keys = useMemo(() => [...inherited, configKey], [inherited, configKey])
	return (
		<EnabledRoutes.Provider value={keys}>{children}</EnabledRoutes.Provider>
	)
}
export function useUrlPublicationEnabled(configKey: string) {
	return useContext(EnabledRoutes).includes(configKey)
}
