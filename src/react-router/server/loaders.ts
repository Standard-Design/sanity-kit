import type {
	ClientPerspective,
	QueryParams,
	SanityClient,
} from '@sanity/client'
import type { LoaderFunctionArgs } from 'react-router'
import {
	validateSanityData,
	type SanityDataDecoder,
	type SanityValidationDiagnostic,
} from '../../core/index.js'
import type { SanityRoutable } from '../index.js'
import {
	sanityRouteDataDecoder,
	sanityRouteDataQuery,
	type SanityRouteData,
} from '../route-data.js'
import type { SanityKit, SanityPreviewContext } from './index.js'

const defaultRouteDataCachePrefix = 'SANITY_ROUTE_DATA:'
const defaultRouteCachePrefix = 'SANITY_ROUTE:'

export type SanityLoaderValidationPolicy = 'throw' | 'passthrough'

export interface SanityLoaderContext {
	client: SanityClient
	context: LoaderFunctionArgs['context']
	params: LoaderFunctionArgs['params']
	pattern: string
	perspective: ClientPerspective
	preview: boolean
	request: Request
	routeData: SanityRouteData
	url: URL
}

export interface SanityLoaderConfig<
	TType extends string = string,
	TData extends SanityRoutable<TType> = SanityRoutable<TType>,
> {
	type: TType
	query: string
	decoder: SanityDataDecoder<TData>
	/**
	 * Add parameters beyond the protected `id` and `pathname` defaults. Loaders
	 * with custom parameters bypass page caching unless `cacheKey` is supplied.
	 */
	params?: (context: SanityLoaderContext) => QueryParams | Promise<QueryParams>
	/** Transform validated or preview-preserving data after fetch/cache lookup. */
	mutate?: (data: TData, context: SanityLoaderContext) => TData | Promise<TData>
	/** Override the published page cache key, or return null to bypass caching. */
	cacheKey?: (context: SanityLoaderContext) => string | null
}

/** Identity helper that preserves loader type and decoded data inference. */
export function defineSanityLoader<
	const TType extends string,
	TData extends SanityRoutable<TType>,
>(config: SanityLoaderConfig<TType, TData>): SanityLoaderConfig<TType, TData> {
	return config
}

export interface SanityLoaderCacheContext {
	key: string
	request: Request
	scope: 'route-data' | 'route'
	type?: string
}

/**
 * Runtime-neutral cache adapter. It receives unknown because persistent caches
 * may JSON-roundtrip values; every returned value is decoded again by the kit.
 */
export type SanityLoaderCache = (
	context: SanityLoaderCacheContext,
	load: () => Promise<unknown>,
) => Promise<unknown>

export interface SanityLoaderValidationFailure {
	data: unknown
	diagnostics: readonly SanityValidationDiagnostic[]
	preview: boolean
	request: Request
	routeData: SanityRouteData
	type: string
}

// Heterogeneous decoders and callbacks retain their types in the input tuple.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyLoaderConfig<TType extends string> = SanityLoaderConfig<TType, any>

export interface CreateSanityLoadersConfig<
	TType extends string,
	TLoaders extends readonly AnyLoaderConfig<TType>[] =
		readonly AnyLoaderConfig<TType>[],
> {
	/** Client registry returned by `createSanityRoutes`. */
	routes: { types: readonly TType[] }
	kit: SanityKit
	loaders: TLoaders
	/** Published-data cache adapter. Preview requests always bypass it. */
	cache?: SanityLoaderCache
	validation?: {
		/** Defaults to `throw`. */
		published?: SanityLoaderValidationPolicy
		/** Defaults to `passthrough` so incomplete drafts can render. */
		preview?: SanityLoaderValidationPolicy
		onFailure?: (failure: SanityLoaderValidationFailure) => void | Promise<void>
	}
}

export interface SanityLoaders<TData extends SanityRoutable> {
	loader: (args: LoaderFunctionArgs) => Promise<TData>
}

type RuntimeLoaderConfig = SanityLoaderConfig<string, SanityRoutable>

type LoaderData<TLoader> =
	TLoader extends SanityLoaderConfig<string, infer TData> ? TData : never

/**
 * Build the server half of a Sanity-driven route. The factory validates client
 * and server registry parity immediately, then resolves route data and page
 * data with explicit preview, validation, mutation, and cache boundaries.
 */
export function createSanityLoaders<
	const TRoutes extends { types: readonly string[] },
	const TLoaders extends readonly AnyLoaderConfig<TRoutes['types'][number]>[],
>(config: {
	routes: TRoutes
	kit: SanityKit
	loaders: TLoaders
	cache?: SanityLoaderCache
	validation?: CreateSanityLoadersConfig<
		TRoutes['types'][number],
		TLoaders
	>['validation']
}): SanityLoaders<LoaderData<TLoaders[number]>> {
	const loadersByType = createLoaderMap(config.routes.types, config.loaders)

	async function loader(args: LoaderFunctionArgs): Promise<unknown> {
		const previewContext = await config.kit.preview.getContext(args.request)
		const url = args.url
		const routeData = await loadRouteData(
			config,
			previewContext,
			args.request,
			url.pathname,
		)
		const matched = loadersByType.get(routeData._type)
		if (!matched) {
			// React Router uses thrown responses for route-level HTTP failures.
			// eslint-disable-next-line @typescript-eslint/only-throw-error
			throw jsonErrorResponse(404, 'SANITY_ROUTE_NOT_REGISTERED', {
				message: `No Sanity route is registered for _type "${routeData._type}".`,
				pathname: url.pathname,
				type: routeData._type,
			})
		}

		const context: SanityLoaderContext = {
			client: previewContext.client,
			context: args.context,
			params: args.params,
			pattern: args.pattern,
			perspective: previewContext.perspective,
			preview: previewContext.preview,
			request: args.request,
			routeData,
			url,
		}
		const cacheKey = previewContext.preview
			? null
			: matched.cacheKey
				? matched.cacheKey(context)
				: matched.params
					? null
					: `${defaultRouteCachePrefix}${url.pathname}${url.search}`
		const raw = await loadWithCache(
			config.cache,
			previewContext.preview,
			cacheKey,
			{
				request: args.request,
				scope: 'route',
				type: matched.type,
			},
			async () => {
				const additionalParams = matched.params
					? await matched.params(context)
					: {}
				return previewContext.client.fetch<unknown>(
					matched.query,
					{
						...additionalParams,
						id: routeData._id,
						pathname: routeData.pathname,
					},
					{
						...previewContext.options,
						signal: args.request.signal,
					},
				)
			},
		)

		const validation = await validateSanityData(raw, matched.decoder)
		let data: unknown
		if (validation.result.success) {
			data = previewContext.preview ? validation.data : validation.result.value
		} else {
			await config.validation?.onFailure?.({
				data: validation.data,
				diagnostics: validation.result.diagnostics,
				preview: previewContext.preview,
				request: args.request,
				routeData,
				type: matched.type,
			})

			const policy = previewContext.preview
				? (config.validation?.preview ?? 'passthrough')
				: (config.validation?.published ?? 'throw')
			if (policy === 'throw') {
				// React Router uses thrown responses for route-level HTTP failures.
				// eslint-disable-next-line @typescript-eslint/only-throw-error
				throw jsonErrorResponse(500, 'SANITY_ROUTE_INVALID', {
					diagnostics: validation.result.diagnostics,
					message: `Sanity route data for "${url.pathname}" failed validation.`,
					pathname: url.pathname,
					type: matched.type,
				})
			}
			data = validation.data
		}

		assertLoadedType(data, matched.type, url.pathname)
		const mutated = matched.mutate ? await matched.mutate(data, context) : data
		assertLoadedType(mutated, matched.type, url.pathname)
		return mutated
	}

	return {
		loader: loader as SanityLoaders<LoaderData<TLoaders[number]>>['loader'],
	}
}

function createLoaderMap<TType extends string>(
	routeTypes: readonly TType[],
	loaders: readonly AnyLoaderConfig<TType>[],
): Map<string, RuntimeLoaderConfig> {
	const routeTypeSet = new Set<string>(routeTypes)
	const loadersByType = new Map<string, RuntimeLoaderConfig>()

	for (const entry of loaders) {
		assertNonEmpty(entry.type, 'loader type')
		assertNonEmpty(entry.query, `query for loader "${entry.type}"`)
		if (loadersByType.has(entry.type)) {
			throw new TypeError(
				`[sanity-kit] Duplicate loader registered for type "${entry.type}".`,
			)
		}
		// Heterogeneous loader data is narrowed by its decoder before callbacks run.
		// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
		loadersByType.set(entry.type, entry)
	}

	const missing = [...routeTypeSet].filter((type) => !loadersByType.has(type))
	const unexpected = [...loadersByType.keys()].filter(
		(type) => !routeTypeSet.has(type),
	)
	if (missing.length > 0 || unexpected.length > 0) {
		throw new TypeError(
			'[sanity-kit] Sanity route and loader registries do not match. ' +
				`Missing loaders: ${formatList(missing)}. ` +
				`Unexpected loaders: ${formatList(unexpected)}.`,
		)
	}

	return loadersByType
}

async function loadRouteData(
	config: {
		kit: SanityKit
		cache?: SanityLoaderCache
	},
	previewContext: SanityPreviewContext,
	request: Request,
	pathname: string,
): Promise<SanityRouteData> {
	const raw = await loadWithCache(
		config.cache,
		previewContext.preview,
		`${defaultRouteDataCachePrefix}${pathname}`,
		{ request, scope: 'route-data' },
		() =>
			previewContext.client.fetch<unknown>(
				sanityRouteDataQuery,
				{ pathname },
				{ ...previewContext.options, signal: request.signal },
			),
	)

	const validation = await validateSanityData(raw, sanityRouteDataDecoder)
	if (!validation.result.success) {
		const missing = raw === null || raw === undefined
		// React Router uses thrown responses for route-level HTTP failures.
		// eslint-disable-next-line @typescript-eslint/only-throw-error
		throw jsonErrorResponse(
			missing ? 404 : 500,
			missing ? 'SANITY_ROUTE_NOT_FOUND' : 'SANITY_ROUTE_DATA_INVALID',
			{
				diagnostics: validation.result.diagnostics,
				message: missing
					? `No Sanity route found for "${pathname}".`
					: `Sanity route lookup data for "${pathname}" is invalid.`,
				pathname,
			},
		)
	}
	return validation.result.value
}

async function loadWithCache(
	cache: SanityLoaderCache | undefined,
	preview: boolean,
	key: string | null,
	context: Omit<SanityLoaderCacheContext, 'key'>,
	load: () => Promise<unknown>,
): Promise<unknown> {
	if (preview || !cache || key === null) return load()
	return cache({ ...context, key }, load)
}

function assertLoadedType(
	data: unknown,
	expectedType: string,
	pathname: string,
): asserts data is SanityRoutable {
	if (
		typeof data !== 'object' ||
		data === null ||
		!('_type' in data) ||
		data._type !== expectedType
	) {
		// React Router uses thrown responses for route-level HTTP failures.
		// eslint-disable-next-line @typescript-eslint/only-throw-error
		throw jsonErrorResponse(500, 'SANITY_ROUTE_TYPE_MISMATCH', {
			message: `Sanity route data for "${pathname}" must have _type "${expectedType}".`,
			pathname,
			type: expectedType,
		})
	}
}

function jsonErrorResponse(
	status: number,
	code: string,
	details: Record<string, unknown>,
): Response {
	return new Response(JSON.stringify({ code, ...details }), {
		status,
		headers: {
			'Cache-Control': 'no-store',
			'Content-Type': 'application/json; charset=utf-8',
		},
	})
}

function assertNonEmpty(value: string, name: string): void {
	if (value.trim().length === 0) {
		throw new TypeError(`[sanity-kit] \`${name}\` must not be empty.`)
	}
}

function formatList(values: readonly string[]): string {
	return values.length === 0
		? 'none'
		: values.map((value) => `"${value}"`).join(', ')
}
