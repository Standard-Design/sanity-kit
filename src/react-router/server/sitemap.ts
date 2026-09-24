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

export interface SanitySitemapCache {
	/** Include query variants, dataset, and site origin; null bypasses caching. */
	key: (args: LoaderFunctionArgs) => string | null
	/** Store query data, not Responses. Values are validated after every lookup. */
	getOrLoad: (key: string, load: () => Promise<unknown>) => Promise<unknown>
}

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
	decoder: SanityDataDecoder<TData>
	toEntries: (
		data: TData,
		args: LoaderFunctionArgs,
	) => readonly SitemapEntry[] | Promise<readonly SitemapEntry[]>
	cache?: SanitySitemapCache
}

/** Build a resource-route loader with strict validation and published-only fetches. */
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
