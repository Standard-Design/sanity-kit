/**
 * Fetch page data for the browser route registry defined in ../index.tsx.
 *
 * Each request reads preview state, finds a route, runs that type's page query,
 * validates the result, and applies any app mutation before returning the page.
 * The route lookup and full-page query both use the same raw-data cache helper.
 * Preview never uses that cache. Published results must validate before storage
 * and after retrieval; raw data means the query result before decoder transforms.
 *
 * The app owns storage, cache key prefixes, schemas, safe logging, and wrappers
 * such as `{ page, diagnostics }`. It also owns successful response headers.
 * tests/react-router/loaders.test.ts and packed consumers check behavior and types.
 *
 * @see docs/loaders.md#what-happens-on-a-request
 * @see docs/loaders.md#cache-raw-data-not-decoder-output
 */
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

// These distinguish query stages, not projects or datasets. Adapters must add
// deployment/query-version namespaces before using shared persistent storage.
const defaultRouteDataCachePrefix = 'SANITY_ROUTE_DATA:'
const defaultRouteCachePrefix = 'SANITY_ROUTE:'

/** Whether a strict published-schema failure can be tolerated in preview; never in published mode. */
export type SanityLoaderValidationPolicy = 'throw' | 'passthrough'

/** Request-scoped inputs passed to page params, cacheKey, and mutate callbacks. */
export interface SanityLoaderContext {
	/** Selected published/preview client; never serialize this context to the browser. */
	client: SanityClient
	/** The app's original React Router context, not a kit-created dependency container. */
	context: LoaderFunctionArgs['context']
	params: LoaderFunctionArgs['params']
	pattern: string
	perspective: ClientPerspective
	preview: boolean
	request: Request
	/** Validated first-stage lookup used to protect `$id` and `$pathname`. */
	routeData: SanityRouteData
	/** React Router's normalized args.url, not the raw data-request URL. */
	url: URL
}

/**
 * Query and decoders for one type registered with `defineSanityRoute`.
 * The renderer must handle both published and draft decoder outputs. Without
 * a draft decoder, only `_type` is guaranteed for preview—not published fields.
 * @see docs/loaders.md#published-and-draft-decoders
 */
export interface SanityLoaderConfig<
	TType extends string = string,
	TData extends SanityRoutable<TType> = SanityRoutable<TType>,
	TPreview extends SanityRoutable<TType> = SanityRoutable<TType>,
> {
	type: TType
	/** App GROQ query; receives protected id/pathname parameters from route lookup. */
	query: string
	/** Strict clean-shadow decoder, also run in preview to collect publication issues. */
	decoder: SanityDataDecoder<TData>
	/** Decode original preview data; preserve Stega strings used for rendering. */
	previewDecoder?: SanityDataDecoder<TPreview>
	/**
	 * Add parameters beyond the protected `id` and `pathname` defaults. Loaders
	 * with custom parameters bypass page caching unless `cacheKey` is supplied.
	 */
	params?: (context: SanityLoaderContext) => QueryParams | Promise<QueryParams>
	/**
	 * Request-specific transform after decoding, including on cache hits. Output
	 * is not cached and must retain `_type`. NoInfer keeps the decoder's output
	 * types in control rather than letting this callback infer a broader type.
	 */
	mutate?: (
		data: NoInfer<TData | TPreview>,
		context: SanityLoaderContext,
	) => NoInfer<TData | TPreview> | Promise<NoInfer<TData | TPreview>>
	/** Override the published page cache key, or return null to bypass caching. */
	cacheKey?: (context: SanityLoaderContext) => string | null
}

/**
 * Preserve each loader's own data types when combining different page loaders.
 * NoInfer stops the containing list from supplying `any` when previewDecoder is
 * omitted; preview must then keep its honest, minimal `_type` guarantee.
 * This helper adds no runtime checks. The factory checks registry structure,
 * and requests run the decoders against actual content.
 * @see docs/loaders.md#create-matching-server-loaders
 */
export function defineSanityLoader<
	const TType extends string,
	TData extends SanityRoutable<TType>,
	TPreview extends SanityRoutable<TType> = SanityRoutable<TType>,
>(
	config: SanityLoaderConfig<TType, TData, TPreview>,
): SanityLoaderConfig<NoInfer<TType>, NoInfer<TData>, NoInfer<TPreview>> {
	return config
}

/** Storage metadata; `type` exists only for full-page lookups, after routing resolves. */
export interface SanityLoaderCacheContext {
	key: string
	request: Request
	scope: 'route-data' | 'route'
	type?: string
}

/**
 * App-supplied storage function. Return a hit or call `load` and store its result.
 * `load` checks validity but returns the original query data, not transformed
 * decoder output. The kit decodes whatever the adapter returns again, including
 * values saved and restored as JSON. That is why the adapter returns `unknown`.
 * Do not transform data or cache a fallback when `load` rejects. The app chooses
 * expiry/eviction and prefixes both lookup and page keys with project, dataset,
 * API/query version, and any variants. It does not need to repeat the decoder.
 * @see docs/loaders.md#cache-raw-data-not-decoder-output
 */
export type SanityLoaderCache = (
	context: SanityLoaderCacheContext,
	load: () => Promise<unknown>,
) => Promise<unknown>

/**
 * Detailed failure information for a server callback, not a public response.
 * Raw data and Request may contain secrets: select safe fields instead of logging
 * the whole object. Collect preview issues in a new array for each request, never
 * a shared module-level array. A failed initial lookup has no routeData or type.
 * @see docs/loaders.md#request-scoped-diagnostics
 */
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

/**
 * Internal list constraint that accepts loaders with different page types.
 * `defineSanityLoader` keeps each entry's specific types; LoaderData combines
 * those into the public result union. Do not use this broad shape for app data.
 * Runtime validation still happens before any mutation is called.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyLoaderConfig<TType extends string> = SanityLoaderConfig<TType, any, any>

/** Dependencies supplied by the host; no environment or provider-specific storage. */
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
		/** Awaited for failed decoder results, not arbitrary thrown/fetch exceptions. */
		onFailure?: (failure: SanityLoaderValidationFailure) => void | Promise<void>
	}
}

/** Export loader directly from a route module, or wrap it in an app data envelope. */
export interface SanityLoaders<TData extends SanityRoutable> {
	loader: (args: LoaderFunctionArgs) => Promise<TData>
}

/** Erased runtime registry shape; each entry's decoder restores its data contract. */
type RuntimeLoaderConfig = SanityLoaderConfig<string, SanityRoutable>

/** Result union across every registered type and its draft variant. */
type LoaderData<TLoader> =
	TLoader extends SanityLoaderConfig<string, infer TData, infer TPreview>
		? TData | TPreview
		: never

/**
 * Build the server half of a Sanity-driven route. The factory validates client
 * and server registry parity immediately, then resolves route data and page
 * data with explicit preview, validation, mutation, and cache boundaries.
 *
 * Return the page document, not a wrapper containing diagnostics. In preview
 * without a previewDecoder, this is the original data with a checked `_type`.
 * Apps add their own diagnostic wrapper and successful response headers, including
 * no-store for preview. Kit errors are generic no-store Responses; unexpected
 * decoder, fetch, or hook exceptions go to the application's error handling.
 * @throws TypeError at construction for duplicate or mismatched registries.
 * @see docs/loaders.md#create-matching-server-loaders
 * @see docs/loaders.md#request-scoped-diagnostics
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

	/** One invocation per React Router request; never retain request data in the factory. */
	async function loader(args: LoaderFunctionArgs): Promise<unknown> {
		const requestContext = await config.kit.getContext(args.request)
		// Data requests may have a transport suffix in request.url. Routing and
		// default cache keys must use the router-normalized URL instead.
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
		// Short-circuit before calling app cacheKey in preview. Custom params can
		// change query results, so implicit pathname-only caching is unsafe for them.
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
						// Set these last so app parameters cannot replace the matched document.
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
				// The strict decoder observes clean text even for an incomplete draft.
				// Its parsed output is authoritative only in published mode.
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
							// Preview may tolerate failed publication rules, but a failed
							// draft decoder cannot safely claim its own output type.
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

		// Mutation must run on both cache hits and misses, outside the cache writer.
		const mutated = matched.mutate ? await matched.mutate(data, context) : data
		assertLoadedType(mutated, matched.type)
		return mutated
	}

	return {
		loader: loader as SanityLoaders<LoaderData<TLoaders[number]>>['loader'],
	}
}

/**
 * Fail at factory creation if client renderers and server fetchers disagree.
 * Only registry.types participates; extraLinkableTypes may be served elsewhere.
 */
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

/**
 * First-stage identity lookup. Clean decoded routing fields guide page fetching,
 * even in preview; they are not the Stega-bearing text that the page renders.
 * Null/undefined means missing (404); a malformed object means invalid data (500).
 */
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

/**
 * Apply the same cache rules to the initial route lookup and the full page query.
 * The callback validates before handing raw data to storage. Decode the adapter's
 * return value again because a hit or JSON-restored value must not be trusted.
 * On a miss this may decode twice, but both calls receive raw input: defaults or
 * transforms are never applied to an earlier decoder output. A bad hit throws;
 * the app decides whether to evict or retry. A compliant adapter stores nothing
 * when the callback rejects.
 * @see docs/loaders.md#cache-raw-data-not-decoder-output
 */
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

/**
 * Check raw, decoded, and mutated page identity against the selected registry entry.
 * A decoder must not disguise data for a different renderer by rewriting `_type`.
 * This checks only `_type`, the field used to choose a renderer. It does not
 * rerun the full schema after mutation; app mutations must honor their types.
 */
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

/** Public errors omit documents, diagnostic text, tokens, and paths; details stay in onFailure. */
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

/** Check developer-supplied registry labels/query source at factory construction. */
function assertNonEmpty(value: string, name: string): void {
	if (value.trim().length === 0) {
		throw new TypeError(`[sanity-kit] \`${name}\` must not be empty.`)
	}
}

/** Human-readable registry mismatch details; used only in configuration errors. */
function formatList(values: readonly string[]): string {
	return values.length === 0
		? 'none'
		: values.map((value) => `"${value}"`).join(', ')
}
