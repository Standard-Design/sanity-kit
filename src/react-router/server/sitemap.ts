/**
 * Fetch published content for a React Router sitemap resource route.
 *
 * Run the app's query, validate raw results before any cache write, decode the
 * returned data, and let the app map it to entries for `/sitemap` to serialize.
 * Unlike page loaders, this never reads preview cookies: sitemap fetches remain
 * published even when an editor visits. Use the kit's published client; storage
 * is supplied by the app, with no Cloudflare or Node cache assumed.
 *
 * @see docs/sitemaps.md#react-router-integration
 * @see docs/sitemaps.md#query-caching
 */
import type { QueryParams, SanityClient } from '@sanity/client'
import type { LoaderFunctionArgs } from 'react-router'
import {
	requireValidSanityData,
	validateSanityData,
	type SanityDataDecoder,
} from '../../core/index.js'
import {
	createSitemapResponse,
	serializeSitemap,
	type SitemapEntry,
	type SitemapResponseOptions,
} from '../../sitemap/index.js'

/**
 * App-owned storage for original query results, not decoder output or XML Responses.
 * Like page caching, results validate before storage and after retrieval.
 * Let `load` failures reach the caller; do not cache a substitute result. The app
 * chooses expiry/eviction and must keep this cache separate from preview data.
 * @see docs/sitemaps.md#query-caching
 */
export interface SanitySitemapCache {
	/** Include site/project/dataset, API/query version, and variants; null skips caching. */
	key: (args: LoaderFunctionArgs) => string | null
	/** Store query data, not Responses. Values are validated after every lookup. */
	getOrLoad: (key: string, load: () => Promise<unknown>) => Promise<unknown>
}

/** App-supplied query, decoder, and entry mapper, plus optional storage/response settings. */
export interface CreateSanitySitemapLoaderConfig<
	TData,
> extends SitemapResponseOptions {
	/** Prefer kit.publishedClient. Fetch options always force published data. */
	client: SanityClient
	/** App-owned query must exclude noindex pages and select canonical routes. */
	query: string
	params?:
		| QueryParams
		| ((args: LoaderFunctionArgs) => QueryParams | Promise<QueryParams>)
	/** Strict decoder with no side effects; may run twice on the same raw result. */
	decoder: SanityDataDecoder<TData>
	/** Map decoded records to loc/lastmod, not arbitrary XML; called per request. */
	toEntries: (
		data: TData,
		args: LoaderFunctionArgs,
	) => readonly SitemapEntry[] | Promise<readonly SitemapEntry[]>
	cache?: SanitySitemapCache
}

/**
 * Build a resource-route loader with strict validation and published-only fetches.
 * Export the returned function as the app's sitemap route loader. Construction
 * checks canonical origin/query configuration. Requests accept GET/HEAD only,
 * forward the abort signal, and force published perspective with Stega disabled.
 * HEAD still performs validation/serialization to return matching XML headers.
 *
 * Decoder failures throw SanityDataValidationError; invalid entries/limits throw
 * serializer errors. The app owns safe error handling and any custom HTTP cache
 * headers. Only query data is cached: mapping/XML failures may occur after a
 * successfully decoded raw result has entered that cache.
 * @see docs/sitemaps.md#react-router-integration
 * @see docs/sitemaps.md#query-caching
 */
export function createSanitySitemapLoader<TData>(
	config: CreateSanitySitemapLoaderConfig<TData>,
): (args: LoaderFunctionArgs) => Promise<Response> {
	// Fail immediately for invalid canonical configuration.
	serializeSitemap([], config)
	if (config.query.trim().length === 0)
		throw new TypeError('[sanity-kit] Sitemap query must not be empty.')

	return async (args) => {
		if (args.request.method !== 'GET' && args.request.method !== 'HEAD') {
			return new Response('Method not allowed.', {
				status: 405,
				headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' },
			})
		}
		const load = async (): Promise<unknown> => {
			const params =
				typeof config.params === 'function'
					? await config.params(args)
					: (config.params ?? {})
			const raw = await config.client.fetch<unknown>(config.query, params, {
				perspective: 'published',
				stega: false,
				filterResponse: true,
				signal: args.request.signal,
			})
			// Never populate the cache with a response that fails the decoder.
			requireValidSanityData(await validateSanityData(raw, config.decoder))
			return raw
		}
		const key = config.cache?.key(args)
		const raw =
			config.cache && key != null
				? await config.cache.getOrLoad(key, load)
				: await load()
		// Validate what storage actually returned, even if this request just wrote
		// it. Without a cache, this also decodes the fetched raw value again. Never
		// pass an earlier decoder output here: transforms could then apply twice.
		const data = requireValidSanityData(
			await validateSanityData(raw, config.decoder),
		)
		const entries = await config.toEntries(data, args)
		const response = createSitemapResponse(entries, config)
		return args.request.method === 'HEAD'
			? new Response(null, { headers: response.headers })
			: response
	}
}
