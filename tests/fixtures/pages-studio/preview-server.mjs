/**
 * Local-only acceptance frontend. It reads ONLY kitProof* types and never writes.
 * A server-side viewer token enables drafts; no credentials enter the JS bundle.
 * Do not deploy this development server or bind it to a public interface.
 */
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { createClient } from '@sanity/client'
import { build } from 'esbuild'

const projectId = process.env.SANITY_STUDIO_PROJECT_ID
const dataset = process.env.SANITY_STUDIO_DATASET
if (!projectId || !dataset)
	throw new Error('Set the test project and dataset environment variables.')
const client = createClient({
	projectId,
	dataset,
	apiVersion: '2026-10-01',
	useCdn: false,
	token: process.env.SANITY_API_READ_TOKEN,
})
const bundle = await build({
	entryPoints: [fileURLToPath(new URL('./preview-client.ts', import.meta.url))],
	bundle: true,
	write: false,
	outfile: 'fixture-client.js',
	format: 'esm',
	platform: 'browser',
})
const query = `{
  "page": *[_type in ["kitProofPage", "kitProofPost", "kitProofLanding"] && coalesce(pathname.current, route) == $path][0]{
    _id, _type, title, body, "pathname": coalesce(pathname.current, route),
    "shared": select(shared->_type == "kitProofShared" => shared->{_id, _type, title, body})
  },
  "links": *[_type in ["kitProofPage", "kitProofPost", "kitProofLanding"] && defined(coalesce(pathname.current, route))] | order(_id asc)[0...50]{title, "pathname": coalesce(pathname.current, route)}
}`
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Pages fixture preview</title><link rel="stylesheet" href="/fixture-client.css"><style>body{font:18px/1.6 system-ui;margin:3rem;color:#20232b}nav{font-size:14px}footer{border-top:1px solid #ddd;margin-top:5rem;padding:2rem 0}</style></head><body><main>Loading fixture preview…</main><script type="module" src="/fixture-client.js"></script></body></html>`

createServer(async (request, response) => {
	response.setHeader('Cache-Control', 'no-store')
	// Host and Origin checks keep the local token-backed reader off other sites.
	if (
		!['localhost:3334', '127.0.0.1:3334'].includes(request.headers.host) ||
		(request.headers.origin &&
			!['http://localhost:3334', 'http://127.0.0.1:3334'].includes(
				request.headers.origin,
			))
	) {
		response.writeHead(403).end('Local fixture only')
		return
	}
	if (request.method !== 'GET') {
		response.writeHead(405).end()
		return
	}
	const url = new URL(request.url, 'http://localhost:3334')
	try {
		if (['/fixture-client.js', '/fixture-client.css'].includes(url.pathname)) {
			const isCss = url.pathname.endsWith('.css')
			response.setHeader('Content-Type', isCss ? 'text/css' : 'text/javascript')
			response.end(
				bundle.outputFiles.find((file) => file.path.endsWith(url.pathname))
					?.text ?? '',
			)
		} else if (url.pathname === '/fixture-data') {
			const perspective = JSON.parse(
				url.searchParams.get('perspective') ?? '"drafts"',
			)
			if (!(
				perspective === 'drafts' ||
				perspective === 'published' ||
				(Array.isArray(perspective) &&
					perspective.length <= 20 &&
					perspective.every(
						(item) =>
							typeof item === 'string' && /^[a-zA-Z0-9_-]+$/u.test(item),
					))
			)) {
				response.writeHead(400).end('Invalid perspective')
				return
			}
			const data = await client.fetch(
				query,
				{ path: url.searchParams.get('path') ?? '/' },
				{ perspective },
			)
			// Fixture authors can enter invalid URLs. Never render them as executable links.
			data.links = data.links.filter(
				({ pathname }) =>
					typeof pathname === 'string' &&
					pathname.startsWith('/') &&
					!pathname.startsWith('//') &&
					!/[\\\s?#]/u.test(pathname),
			)
			response.setHeader('Content-Type', 'application/json')
			response.end(JSON.stringify({ ...data, projectId, dataset }))
		} else {
			response.setHeader('Content-Type', 'text/html')
			response.end(html)
		}
	} catch {
		response
			.writeHead(502)
			.end(
				'Fixture data unavailable. Check server credentials and dataset access.',
			)
	}
}).listen(3334, '127.0.0.1', () =>
	console.log('Pages fixture preview: http://localhost:3334'),
)
