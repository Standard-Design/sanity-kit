/** Local acceptance transport, deliberately separate from production preview auth. */
import type { SanityClient } from '@sanity/client'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
	redirectResponse,
	resolveRedirectRequest,
} from '../../../src/redirect/request.js'
import { loadFixtureArticlePrefix } from './preview-routing.js'

export type FixtureMode = 'preview' | 'published'
export interface FixtureHttpOptions {
	readonly mode: FixtureMode
	readonly port: number
	readonly client: SanityClient
	readonly projectId: string
	readonly dataset: string
	readonly assets: Readonly<Record<string, string>>
}

const query = `{
  "page": *[_type in ["kitProofPage", "kitProofPost", "kitProofLanding", "kitProofCollectionArticle"] && coalesce(pathname.current, route, select(_type == "kitProofCollectionArticle" && defined(slug.current) => $articlePrefix + "/" + slug.current)) == $path][0]{
    _id, _type, title, body, "pathname": coalesce(pathname.current, route, select(_type == "kitProofCollectionArticle" && defined(slug.current) => $articlePrefix + "/" + slug.current)),
    "shared": select(shared->_type == "kitProofShared" => shared->{_id, _type, title, body})
  },
  "links": *[_type in ["kitProofPage", "kitProofPost", "kitProofLanding", "kitProofCollectionArticle"] && defined(coalesce(pathname.current, route, select(_type == "kitProofCollectionArticle" && defined(slug.current) => $articlePrefix + "/" + slug.current)))] | order(_id asc)[0...50]{title, "pathname": coalesce(pathname.current, route, select(_type == "kitProofCollectionArticle" && defined(slug.current) => $articlePrefix + "/" + slug.current))}
}`
const html = (mode: FixtureMode) =>
	`<!doctype html><html data-fixture-mode="${mode}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Pages fixture ${mode}</title><link rel="stylesheet" href="/fixture-client.css"><style>body{font:18px/1.6 system-ui;margin:3rem;color:#20232b}nav{font-size:14px}footer{border-top:1px solid #ddd;margin-top:5rem;padding:2rem 0}</style></head><body><main>Loading fixture ${mode}…</main><script type="module" src="/fixture-client.js"></script></body></html>`

/** The listener chooses mode. Query strings and cookies never grant preview access. */
export function createFixtureHttpHandler(options: FixtureHttpOptions) {
	const { mode, client, port } = options
	const hosts = [`localhost:${port}`, `127.0.0.1:${port}`]
	const reservedPaths = [
		'/fixture-data',
		'/fixture-client.js',
		'/fixture-client.css',
	]
	return async (request: IncomingMessage, response: ServerResponse) => {
		response.setHeader('Cache-Control', 'no-store')
		if (
			!hosts.includes(request.headers.host ?? '') ||
			(request.headers.origin &&
				!hosts.map((host) => `http://${host}`).includes(request.headers.origin))
		) {
			response.writeHead(403).end('Local fixture only')
			return
		}
		if (request.method !== 'GET' && request.method !== 'HEAD') {
			response.setHeader('Allow', 'GET, HEAD')
			response.writeHead(405).end()
			return
		}
		const controller = new AbortController()
		const abort = () => {
			if (!response.writableEnded) controller.abort()
		}
		request.once('aborted', abort)
		response.once('close', abort)
		try {
			const url = new URL(request.url ?? '/', `http://localhost:${port}`)
			if (
				url.pathname === '/fixture-client.js' ||
				url.pathname === '/fixture-client.css'
			) {
				response.setHeader(
					'Content-Type',
					url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript',
				)
				response.end(
					request.method === 'HEAD'
						? undefined
						: (options.assets[url.pathname] ?? ''),
				)
				return
			}
			if (url.pathname === '/fixture-data') {
				// Published content stays published even if a browser sends preview parameters.
				const perspective: unknown =
					mode === 'published'
						? 'published'
						: JSON.parse(url.searchParams.get('perspective') ?? '"drafts"')
				if (!(
					perspective === 'drafts' ||
					perspective === 'published' ||
					(Array.isArray(perspective) &&
						perspective.length <= 20 &&
						perspective.every(
							(item: unknown) =>
								typeof item === 'string' && /^[a-zA-Z0-9_-]+$/u.test(item),
						))
				)) {
					response.writeHead(400).end('Invalid perspective')
					return
				}
				const articlePrefix = await loadFixtureArticlePrefix(
					client,
					perspective,
				)
				const data = await client.fetch<{
					page: unknown
					links: { title: string | null; pathname: unknown }[]
				}>(
					query,
					{ path: url.searchParams.get('path') ?? '/', articlePrefix },
					{
						perspective: perspective as 'published' | 'drafts' | string[],
						signal: controller.signal,
					},
				)
				if (controller.signal.aborted) return
				data.links = data.links.filter(
					({ pathname }) =>
						typeof pathname === 'string' &&
						pathname.startsWith('/') &&
						!pathname.startsWith('//') &&
						!/[\\\s?#]/u.test(pathname),
				)
				response.setHeader('Content-Type', 'application/json')
				response.end(
					request.method === 'HEAD'
						? undefined
						: JSON.stringify({
								...data,
								projectId: options.projectId,
								dataset: options.dataset,
							}),
				)
				return
			}
			const redirect = redirectResponse(
				await resolveRedirectRequest(
					client,
					new Request(url, {
						method: request.method,
						signal: controller.signal,
					}),
					{
						preview: mode === 'preview',
						reservedPaths,
						// This fixture tests delivery, not the publication review's full page inventory.
						destinations: 'unverified',
					},
				),
			)
			if (redirect) {
				redirect.headers.forEach((value, key) => response.setHeader(key, value))
				response
					.writeHead(redirect.status)
					.end(request.method === 'HEAD' ? undefined : await redirect.text())
				return
			}
			if (controller.signal.aborted) return
			response.setHeader('Content-Type', 'text/html')
			response.end(request.method === 'HEAD' ? undefined : html(mode))
		} catch {
			if (!controller.signal.aborted)
				response
					.writeHead(502)
					.end(
						request.method === 'HEAD'
							? undefined
							: 'Fixture data unavailable. Check server credentials and dataset access.',
					)
		} finally {
			request.off('aborted', abort)
			response.off('close', abort)
		}
	}
}
