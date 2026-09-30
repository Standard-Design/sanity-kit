/**
 * Choose a page component and metadata callback using a document's `_type`.
 *
 * This browser-safe registry runs inside an app route, usually a CMS catch-all;
 * it does not generate the React Router route table. App route modules export
 * its `default` and `meta` alongside a separately configured server loader.
 * Server loaders use `types` to check that every renderer has a matching loader.
 * Links use `linkableTypes` to decide which destinations are allowed.
 * Keep server factories, secrets, and eager Visual Editing imports out of here.
 *
 * @see docs/react-router.md for setup, route exports, and application wrappers.
 * @see docs/loaders.md for the matching server registry.
 */
import type { ComponentType, ReactNode } from 'react'
import type { MetaDescriptor } from 'react-router'

export {
	createSanityLinks,
	type CreateSanityLinksConfig,
	type SanityLinkComponent,
	type SanityLinkProps,
	type SanityLinks,
} from './links.js'

export {
	sanityRouteDataDecoder,
	sanityRouteDataQuery,
	sanityRouteDataQueryFragment,
	type SanityRouteData,
} from './route-data.js'

/** Enough data to choose a renderer; this alone promises no `_id`, title, or other fields. */
export interface SanityRoutable<TType extends string = string> {
	_type: TType
}

/** One document-type renderer; TData should cover both published and draft output. */
export interface SanityRouteConfig<
	TType extends string = string,
	TData extends SanityRoutable<TType> = SanityRoutable<TType>,
	TLinkable extends boolean = true,
> {
	type: TType
	/** Receives the decoded loader document, not the full React Router props object. */
	component: ComponentType<{ data: TData }>
	/** App-owned head metadata; clean Stega strings before using them in head tags. */
	meta?: (data: TData) => MetaDescriptor[]
	/** Include this type in `linkableTypes`. Defaults to true. */
	linkable?: TLinkable
}

/** Preserve inferred route/data types when defining an entry; performs no validation. */
export function defineSanityRoute<
	const TType extends string,
	TData extends SanityRoutable<TType>,
	const TLinkable extends boolean = true,
>(
	config: SanityRouteConfig<TType, TData, TLinkable>,
): SanityRouteConfig<TType, TData, TLinkable> {
	return config
}

/**
 * Accept a list of routes with different data types without losing each entry's
 * own props type. `defineSanityRoute` retains those types and RouteData combines
 * them into a union. Requiring one shared props type here would incorrectly make
 * each component accept every other document type. The `any` stays internal.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRouteConfig = SanityRouteConfig<string, any, boolean>

/** Read one component's data props before combining all registered data types. */
type InferredRouteData<TRoute> = TRoute extends {
	component: ComponentType<{ data: infer TData }>
}
	? TData
	: never

/** Exclude component props that cannot participate in `_type` dispatch. */
type RouteData<TRoute> = Extract<InferredRouteData<TRoute>, SanityRoutable>

/** Keep the exact type names so server loaders can be checked against this list. */
type RouteType<TRoute> = TRoute extends { type: infer TType extends string }
	? TType
	: never

/** Only an explicit false opts out; an omitted flag matches the runtime default. */
type LinkableRouteType<TRoute> = TRoute extends {
	linkable?: infer TLinkable
}
	? TLinkable extends false
		? never
		: RouteType<TRoute>
	: RouteType<TRoute>

/** Choose renderers and optional layout/metadata; fetching is configured separately. */
export interface CreateSanityRoutesConfig<
	TRoutes extends readonly AnyRouteConfig[],
	TExtraLinkableTypes extends readonly string[] = readonly [],
> {
	routes: TRoutes
	/** Additional internal destination types served outside this registry. */
	extraLinkableTypes?: TExtraLinkableTypes
	/** Optional application wrapper for route-level visual concerns. */
	layout?: (args: {
		data: RouteData<TRoutes[number]>
		children: ReactNode
	}) => ReactNode
	/** Metadata fallback when the document type has no registered meta callback. */
	defaultMeta?: (data: RouteData<TRoutes[number]>) => MetaDescriptor[]
}

/** Route exports plus frozen type lists shared with server loaders and link helpers. */
export interface SanityRoutes<
	TType extends string,
	TLinkableType extends string,
	TData extends SanityRoutable,
> {
	/** React Router-compatible route component, dispatched by `_type`. */
	default: (props: { loaderData: TData | undefined }) => ReactNode
	/** React Router-compatible metadata dispatcher. */
	meta: (args: { loaderData: TData | undefined }) => MetaDescriptor[]
	/** Immutable runtime registry used by server-side parity checks. */
	types: readonly TType[]
	/** Immutable types eligible as internal link destinations. */
	linkableTypes: readonly TLinkableType[]
}

/**
 * Build the browser-safe half of a Sanity-driven React Router route. Components
 * and metadata stay client-safe; fetching is supplied by the server entrypoint.
 * Bind once in a shared app module. Standard non-CMS React Router routes can
 * coexist; `extraLinkableTypes` only allows links to those destinations and does
 * not require a matching Sanity loader. Renderers must understand their decoder's
 * draft output; this registry checks `_type`, not the complete document schema.
 *
 * @throws TypeError for empty/duplicate registries or contradictory link policy.
 * @see docs/react-router.md#export-from-an-application-route-module
 * @see docs/react-router.md#registry-settings-and-returned-values
 */
export function createSanityRoutes<
	const TRoutes extends readonly AnyRouteConfig[],
	const TExtraLinkableTypes extends readonly string[] = readonly [],
>(
	config: CreateSanityRoutesConfig<TRoutes, TExtraLinkableTypes>,
): SanityRoutes<
	RouteType<TRoutes[number]>,
	LinkableRouteType<TRoutes[number]> | TExtraLinkableTypes[number],
	RouteData<TRoutes[number]>
> {
	if (config.routes.length === 0) {
		throw new TypeError('[sanity-kit] At least one Sanity route is required.')
	}

	const routesByType = new Map<string, AnyRouteConfig>()
	const types: string[] = []
	const linkableTypes: string[] = []

	for (const route of config.routes) {
		assertRouteType(route.type)
		if (routesByType.has(route.type)) {
			throw new TypeError(
				`[sanity-kit] Duplicate route type registered: "${route.type}".`,
			)
		}

		routesByType.set(route.type, route)
		types.push(route.type)
		if (route.linkable !== false) linkableTypes.push(route.type)
	}

	for (const type of config.extraLinkableTypes ?? []) {
		assertRouteType(type)
		if (routesByType.get(type)?.linkable === false) {
			throw new TypeError(
				`[sanity-kit] Route type "${type}" cannot be both non-linkable and an extra linkable type.`,
			)
		}
		if (!linkableTypes.includes(type)) linkableTypes.push(type)
	}

	/** Render the document itself; apps returning `{ page, diagnostics }` pass `page` here. */
	function Default({
		loaderData,
	}: {
		loaderData: RouteData<TRoutes[number]> | undefined
	}): ReactNode {
		if (loaderData === undefined) {
			throw new Error(
				'[sanity-kit] Sanity route rendered without `loaderData`. ' +
					'Export its loader as a top-level route-module binding.',
			)
		}

		const type = readRouteType(loaderData)
		const route = routesByType.get(type)
		if (!route) {
			throw new Error(`[sanity-kit] No route registered for _type "${type}".`)
		}

		const Component = route.component
		const node = <Component data={loaderData} />
		return config.layout
			? config.layout({ data: loaderData, children: node })
			: node
	}

	/** Metadata can run without data after loader failure; return no tags in that case. */
	function meta({
		loaderData,
	}: {
		loaderData: RouteData<TRoutes[number]> | undefined
	}): MetaDescriptor[] {
		if (loaderData === undefined) return []
		const route = routesByType.get(readRouteType(loaderData))
		const createMeta = route?.meta ?? config.defaultMeta
		return createMeta ? createMeta(loaderData) : []
	}

	return Object.freeze({
		default: Default,
		meta,
		types: Object.freeze(types) as readonly RouteType<TRoutes[number]>[],
		linkableTypes: Object.freeze(linkableTypes),
	})
}

/** Configuration guard shared by registered types and extra link destinations. */
function assertRouteType(type: string): void {
	if (type.trim().length === 0) {
		throw new TypeError('[sanity-kit] Route types must not be empty.')
	}
}

/** Read the `_type` used to select a renderer; server decoders check all other fields. */
function readRouteType(data: unknown): string {
	if (
		typeof data !== 'object' ||
		data === null ||
		!('_type' in data) ||
		typeof data._type !== 'string' ||
		data._type.trim().length === 0
	) {
		throw new TypeError(
			'[sanity-kit] Sanity route data must contain a non-empty `_type`.',
		)
	}
	return data._type
}
