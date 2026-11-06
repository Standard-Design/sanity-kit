/** The private plugin enables editing only inside its paired Studio layout. */
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import {
	createPagesRegistry,
	type PagesRouteConfig,
} from '../../url/registry.js'

const EnabledRoutes = createContext<readonly string[]>([])
/** Compare checked route meaning, independent of object key or array ordering. */
export function urlPublicationConfigKey(routes: PagesRouteConfig) {
	const registry = createPagesRegistry(routes)
	return JSON.stringify({
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
