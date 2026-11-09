/**
 * Connect the redirect subsystem to React Router's server request lifecycle.
 * The app installs this middleware on its root or CMS route; React Router owns
 * document responses and the different redirect format used by data requests.
 * See docs/redirects.md for placement, preview, and consumer-owned caching.
 */
import { createContext, redirect, type MiddlewareFunction } from 'react-router'
import { captureRedirectPolicy } from '../../redirect/load.js'
import {
	redirectResponse,
	resolveRedirectRequest,
	type RedirectRequestOptions,
} from '../../redirect/request.js'
import type { SanityKit } from './index.js'

export interface CreateSanityRedirectMiddlewareConfig extends Omit<
	RedirectRequestOptions,
	'preview'
> {
	/** The same server kit used by content loaders and preview resource routes. */
	readonly kit: Pick<SanityKit, 'getContext' | 'publishedClient'>
}

/**
 * Check redirects before content loaders run. Preview comes from the kit's
 * trusted session, never a search parameter. The published client supplies
 * rules even when the caller has other draft-aware clients in its application.
 * Returns an array for the route middleware export (spread into an existing
 * array). Keep both functions in order. This helper stays private until the
 * consumer-integration/export review.
 */
export function createSanityRedirectMiddleware(
	config: CreateSanityRedirectMiddlewareConfig,
): MiddlewareFunction<Response>[] {
	const { kit, cache } = config
	const policy = captureRedirectPolicy(config)
	const queryParameterAllowlist = [...(config.queryParameterAllowlist ?? [])]
	const failedCheck = createContext(false)
	const check: MiddlewareFunction<Response> = async (
		{ request, url, context },
		next,
	) => {
		if (request.method !== 'GET' && request.method !== 'HEAD') return next()
		request.signal.throwIfAborted()
		const { preview } = await kit.getContext(request)
		request.signal.throwIfAborted()
		// args.url is the logical route URL supplied by React Router. A literal
		// /report.data page is distinct from the /report data-request transport.
		const logicalRequest = new Request(url, {
			method: request.method,
			signal: request.signal,
		})
		const result = await resolveRedirectRequest(
			kit.publishedClient,
			logicalRequest,
			{
				...policy,
				preview,
				...(cache ? { cache } : {}),
				queryParameterAllowlist,
			},
		)
		request.signal.throwIfAborted()
		if (result.kind === 'redirect') {
			// React Router uses thrown Responses for navigation and error boundaries.
			// eslint-disable-next-line @typescript-eslint/only-throw-error
			throw redirect(result.location, {
				status: result.status,
				headers: { 'Cache-Control': 'no-store' },
			})
		}
		const failure = redirectResponse(result)
		if (failure) {
			context.set(failedCheck, true)
			// eslint-disable-next-line @typescript-eslint/only-throw-error
			throw failure
		}
		return next()
	}
	// React Router renders thrown middleware errors before next() resolves, but
	// does not preserve their headers. Apply no-store to that finished response,
	// while retaining the router's own document/data error encoding.
	return [
		async ({ context }, next) => {
			const response = await next()
			if (context.get(failedCheck))
				response.headers.set('Cache-Control', 'no-store')
			return response
		},
		check,
	]
}
