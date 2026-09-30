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
import type { SanityKit, SanityRequestContext } from './index.js'

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
	TPreview extends SanityRoutable<TType> = SanityRoutable<TType>,
> {
	type: TType
	query: string
	decoder: SanityDataDecoder<TData>
	/** Decode original preview data; preserve Stega strings used for rendering. */
	previewDecoder?: SanityDataDecoder<TPreview>
	/**
	 * Add parameters beyond the protected `id` and `pathname` defaults. Loaders
	 * with custom parameters bypass page caching unless `cacheKey` is supplied.
	 */
	params?: (context: SanityLoaderContext) => QueryParams | Promise<QueryParams>
	/** Transform validated or preview-preserving data after fetch/cache lookup. */
	mutate?: (
		data: NoInfer<TData | TPreview>,
		context: SanityLoaderContext,
	) => NoInfer<TData | TPreview> | Promise<NoInfer<TData | TPreview>>
	/** Override the published page cache key, or return null to bypass caching. */
	cacheKey?: (context: SanityLoaderContext) => string | null
}

/** Identity helper that preserves loader type and decoded data inference. */
export function defineSanityLoader<
	const TType extends string,
	TData extends SanityRoutable<TType>,
	TPreview extends SanityRoutable<TType> = SanityRoutable<TType>,
>(
	config: SanityLoaderConfig<TType, TData, TPreview>,
): SanityLoaderConfig<NoInfer<TType>, NoInfer<TData>, NoInfer<TPreview>> {
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
 * may JSON-roundtrip values. `load` returns strictly validated RAW data, never
 * decoder output. Every adapter-returned value is decoded again by the kit.
 * Do not transform values or catch a load failure and cache its error/fallback.
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
	routeData?: SanityRouteData
	type?: string
	stage: 'route-data' | 'published' | 'preview'
	/** Cache means adapter-returned data, including a read-through miss. */
	source: 'fetch' | 'cache'
}

// Heterogeneous decoders and callbacks retain their types in the input tuple.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyLoaderConfig<TType extends string> = SanityLoaderConfig<TType, any, any>

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
		/** Published data must pass validation, including before cache writes. */
		published?: 'throw'
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
	TLoader extends SanityLoaderConfig<string, infer TData, infer TPreview>
		? TData | TPreview
		: never

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
		const requestContext = await config.kit.getContext(args.request)
		const url = args.url
		const routeData = await loadRouteData(
			config,
			requestContext,
			args.request,
			url.pathname,
		)
		const matched = loadersByType.get(routeData._type)
		if (!matched) {
			// React Router uses thrown responses for route-level HTTP failures.
			// eslint-disable-next-line @typescript-eslint/only-throw-error
			throw jsonErrorResponse(404, 'SANITY_ROUTE_NOT_REGISTERED')
		}

		const context: SanityLoaderContext = {
			client: requestContext.client,
			context: args.context,
			params: args.params,
			pattern: args.pattern,
			perspective: requestContext.perspective,
			preview: requestContext.preview,
			request: args.request,
			routeData,
			url,
		}
		const cacheKey = requestContext.preview
			? null
			: matched.cacheKey
				? matched.cacheKey(context)
				: matched.params
					? null
					: `${defaultRouteCachePrefix}${url.pathname}${url.search}`
		const data = await loadWithCache(
			config.cache,
			requestContext.preview,
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
				return requestContext.client.fetch<unknown>(
					matched.query,
					{
						...additionalParams,
						id: routeData._id,
						pathname: routeData.pathname,
					},
					{
						...requestContext.options,
						signal: args.request.signal,
					},
				)
			},
			async (raw, source) => {
				const validation = await validateSanityData(raw, matched.decoder)
				const report = async (
					stage: 'published' | 'preview',
					diagnostics: readonly SanityValidationDiagnostic[],
				) => {
					await config.validation?.onFailure?.({
						data: raw,
						diagnostics,
						preview: context.preview,
						request: args.request,
						routeData,
						type: matched.type,
						stage,
						source,
					})
				}
				if (!validation.result.success) {
					await report('published', validation.result.diagnostics)
					if (!context.preview || config.validation?.preview === 'throw') {
						// eslint-disable-next-line @typescript-eslint/only-throw-error
						throw jsonErrorResponse(500, 'SANITY_ROUTE_INVALID')
					}
				}

				let value: unknown = raw
				if (context.preview) {
					if (matched.previewDecoder) {
						// Deliberately not validateSanityData: render strings retain Stega.
						const draft = await matched.previewDecoder.decode(raw)
						if (!draft.success) {
							await report('preview', draft.diagnostics)
							// eslint-disable-next-line @typescript-eslint/only-throw-error
							throw jsonErrorResponse(500, 'SANITY_PREVIEW_INVALID')
						}
						value = draft.value
					}
				} else if (validation.result.success) {
					value = validation.result.value
				}
				// Check raw identity as well as decoded output before permitting a write.
				assertLoadedType(raw, matched.type)
				assertLoadedType(value, matched.type)
				return value
			},
		)

		const mutated = matched.mutate ? await matched.mutate(data, context) : data
		assertLoadedType(mutated, matched.type)
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
		validation?: CreateSanityLoadersConfig<string>['validation']
	},
	requestContext: SanityRequestContext,
	request: Request,
	pathname: string,
): Promise<SanityRouteData> {
	return loadWithCache(
		config.cache,
		requestContext.preview,
		`${defaultRouteDataCachePrefix}${pathname}`,
		{ request, scope: 'route-data' },
		() =>
			requestContext.client.fetch<unknown>(
				sanityRouteDataQuery,
				{ pathname },
				{ ...requestContext.options, signal: request.signal },
			),
		async (raw, source) => {
			const validation = await validateSanityData(raw, sanityRouteDataDecoder)
			if (!validation.result.success) {
				await config.validation?.onFailure?.({
					data: raw,
					diagnostics: validation.result.diagnostics,
					preview: requestContext.preview,
					request,
					stage: 'route-data',
					source,
				})
				const missing = raw === null || raw === undefined
				// eslint-disable-next-line @typescript-eslint/only-throw-error
				throw jsonErrorResponse(
					missing ? 404 : 500,
					missing ? 'SANITY_ROUTE_NOT_FOUND' : 'SANITY_ROUTE_DATA_INVALID',
				)
			}
			return validation.result.value
		},
	)
}

async function loadWithCache<TValue>(
	cache: SanityLoaderCache | undefined,
	preview: boolean,
	key: string | null,
	context: Omit<SanityLoaderCacheContext, 'key'>,
	load: () => Promise<unknown>,
	decode: (raw: unknown, source: 'fetch' | 'cache') => Promise<TValue>,
): Promise<TValue> {
	if (preview || !cache || key === null) return decode(await load(), 'fetch')
	const raw = await cache({ ...context, key }, async () => {
		const fetched = await load()
		await decode(fetched, 'fetch')
		return fetched
	})
	return decode(raw, 'cache')
}

function assertLoadedType(
	data: unknown,
	expectedType: string,
): asserts data is SanityRoutable {
	if (
		typeof data !== 'object' ||
		data === null ||
		!('_type' in data) ||
		data._type !== expectedType
	) {
		// React Router uses thrown responses for route-level HTTP failures.
		// eslint-disable-next-line @typescript-eslint/only-throw-error
		throw jsonErrorResponse(500, 'SANITY_ROUTE_TYPE_MISMATCH')
	}
}

function jsonErrorResponse(status: number, code: string): Response {
	return new Response(
		JSON.stringify({
			code,
			message:
				status === 404
					? 'Sanity content not found.'
					: 'Unable to load Sanity content.',
		}),
		{
			status,
			headers: {
				'Cache-Control': 'no-store',
				'Content-Type': 'application/json; charset=utf-8',
			},
		},
	)
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
