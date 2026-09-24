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

export interface SanityRoutable<TType extends string = string> {
	_type: TType
}

export interface SanityRouteConfig<
	TType extends string = string,
	TData extends SanityRoutable<TType> = SanityRoutable<TType>,
	TLinkable extends boolean = true,
> {
	type: TType
	component: ComponentType<{ data: TData }>
	meta?: (data: TData) => MetaDescriptor[]
	/** Include this type in `linkableTypes`. Defaults to true. */
	linkable?: TLinkable
}

/** Identity helper that preserves route type, data, and linkability literals. */
export function defineSanityRoute<
	const TType extends string,
	TData extends SanityRoutable<TType>,
	const TLinkable extends boolean = true,
>(
	config: SanityRouteConfig<TType, TData, TLinkable>,
): SanityRouteConfig<TType, TData, TLinkable> {
	return config
}

// Specific component props are intentionally preserved per tuple member.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRouteConfig = SanityRouteConfig<string, any, boolean>

type InferredRouteData<TRoute> = TRoute extends {
	component: ComponentType<{ data: infer TData }>
}
	? TData
	: never

type RouteData<TRoute> = Extract<InferredRouteData<TRoute>, SanityRoutable>

type RouteType<TRoute> = TRoute extends { type: infer TType extends string }
	? TType
	: never

type LinkableRouteType<TRoute> = TRoute extends {
	linkable?: infer TLinkable
}
	? TLinkable extends false
		? never
		: RouteType<TRoute>
	: RouteType<TRoute>

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
	/** Metadata fallback for registered routes without their own callback. */
	defaultMeta?: (data: RouteData<TRoutes[number]>) => MetaDescriptor[]
}

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

function assertRouteType(type: string): void {
	if (type.trim().length === 0) {
		throw new TypeError('[sanity-kit] Route types must not be empty.')
	}
}

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
