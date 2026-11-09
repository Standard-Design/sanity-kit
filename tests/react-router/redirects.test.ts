import { createRequestHandler, type ServerBuild } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { createSanityKit } from '../../src/react-router/server/index.js'
import { createSanityRedirectMiddleware } from '../../src/react-router/server/redirects.js'
import {
	invalidateRedirectCache,
	type RedirectCache,
} from '../../src/redirect/request.js'

const rule = {
	_id: 'rule',
	_type: 'sanityKitRedirect',
	enabled: true,
	source: '/old',
	destination: '/new',
	status: 301,
}
const policy = { destinations: 'unverified' as const }

function setup(cache?: RedirectCache) {
	const kit = createSanityKit({
		projectId: 'project123',
		dataset: 'test',
		apiVersion: '2026-10-01',
		studioUrl: 'https://studio.example',
		readToken: 'server-only-token',
		sessionSecret: 'test-secret-with-at-least-32-characters',
		preview: {
			validateUrl: () =>
				Promise.resolve({
					isValid: true,
					studioPreviewPerspective: 'published',
				}),
		},
	})
	const fetch = vi.fn((): Promise<unknown> => Promise.resolve([{ ...rule }]))
	// Keep the real server kit and its signed preview sessions. Only the network
	// boundary is replaced; all HTTP routing below uses React Router itself.
	kit.publishedClient.config({
		requestHandler: async () => ({ result: await fetch() }),
	})
	const loader = vi.fn(() => ({ page: true }))
	const action = vi.fn(() => ({ saved: true }))
	const build: ServerBuild = {
		entry: {
			module: {
				default: (_request, status, headers, context) =>
					new Response(JSON.stringify(context.staticHandlerContext), {
						status,
						headers,
					}),
				handleError: vi.fn(),
			},
		},
		routes: {
			root: {
				id: 'root',
				path: '',
				module: {
					default: () => null,
					middleware: createSanityRedirectMiddleware({
						kit,
						...policy,
						reservedPathPrefixes: ['/account'],
						queryParameterAllowlist: ['lang'],
						...(cache ? { cache } : {}),
					}),
					loader: () => null,
				},
			},
			page: {
				id: 'page',
				parentId: 'root',
				path: '*',
				module: { default: () => null, loader, action },
			},
		},
		assets: {
			entry: { imports: [], module: '/entry.js' },
			routes: {},
			url: '/manifest.js',
			version: 'test',
		},
		publicPath: '/',
		assetsBuildDirectory: 'build/client',
		future: {},
		ssr: true,
		isSpaMode: false,
		prerender: [],
		routeDiscovery: { mode: 'initial', manifestPath: '/__manifest' },
	}
	const handler = createRequestHandler(build, 'test')
	const request = (path: string, init?: RequestInit) =>
		handler(new Request(`https://app.example${path}`, init))
	return { kit, fetch, loader, action, request, build }
}

describe('private React Router redirect middleware', () => {
	it.each(['GET', 'HEAD'])(
		'redirects %s documents before content loaders',
		async (method) => {
			const io = setup()
			const response = await io.request('/old?lang=en&token=secret', { method })
			expect(response.status).toBe(301)
			expect(response.headers.get('Location')).toBe('/new?lang=en')
			expect(response.headers.get('Cache-Control')).toBe('no-store')
			expect(io.loader).not.toHaveBeenCalled()
		},
	)

	it('uses the logical URL and lets React Router encode data-navigation redirects', async () => {
		const io = setup()
		const response = await io.request('/old.data?lang=fr&_routes=page')
		const body = await response.text()
		expect(response.status).toBe(202)
		expect(response.headers.get('Location')).toBeNull()
		expect(response.headers.get('Cache-Control')).toBe('no-store')
		expect(body).toContain('/new?lang=fr')
		expect(body).toContain('301')
		expect(io.loader).not.toHaveBeenCalled()
	})

	it('does not mistake a literal .data page for its transport URL', async () => {
		const io = setup()
		io.fetch.mockResolvedValue([{ ...rule, source: '/report.data' }])
		const response = await io.request('/report.data.data')
		expect(response.status).toBe(202)
		expect(await response.text()).toContain('/new')
	})

	it.each(['/old', '/old.data'])(
		'bypasses %s for a signed preview session, including published perspective',
		async (path) => {
			const io = setup()
			const enabled = await io.kit.preview.enable({
				request: new Request('https://app.example/preview'),
			})
			const cookie = enabled.headers.get('Set-Cookie')!.split(';')[0]!
			const response = await io.request(path, { headers: { Cookie: cookie } })
			expect(response.status).toBe(200)
			expect(io.fetch).not.toHaveBeenCalled()
			expect(io.loader).toHaveBeenCalledOnce()
		},
	)

	it('does not trust preview query parameters or a forged cookie', async () => {
		const io = setup()
		const response = await io.request(
			'/old?preview=true&sanity-preview-perspective=drafts',
			{
				headers: { Cookie: '__sanity_preview=forged' },
			},
		)
		expect(response.status).toBe(301)
		expect(response.headers.get('Location')).toBe('/new')
	})

	it('continues normal routing on a miss, reserved path, or POST', async () => {
		const io = setup()
		expect((await io.request('/ordinary')).status).toBe(200)
		expect((await io.request('/account/settings')).status).toBe(200)
		expect((await io.request('/old', { method: 'POST' })).status).toBe(200)
		expect(io.fetch).toHaveBeenCalledOnce()
		expect(io.loader).toHaveBeenCalledTimes(3)
		expect(io.action).toHaveBeenCalledOnce()
	})

	it.each(['/old', '/old.data'])(
		'reports failed rule loading through the router for %s',
		async (path) => {
			const io = setup()
			io.fetch.mockRejectedValue(new Error('private transport details'))
			const response = await io.request(path)
			expect(response.status).toBe(503)
			expect(response.headers.get('Cache-Control')).toBe('no-store')
			const body = await response.text()
			expect(body).toContain('Redirects are temporarily unavailable')
			expect(body).not.toContain('private transport details')
			expect(io.loader).not.toHaveBeenCalled()
		},
	)

	it('isolates failed-check headers between simultaneous requests and preserves app caching', async () => {
		const io = setup()
		io.build.routes.page!.module.headers = {
			'Cache-Control': 'public, max-age=60',
		}
		let rejectFirst: (error: Error) => void = () => undefined
		let firstStarted: () => void = () => undefined
		const started = new Promise<void>((resolve) => {
			firstStarted = resolve
		})
		io.fetch.mockImplementationOnce(
			() =>
				new Promise((_, reject) => {
					rejectFirst = reject
					firstStarted()
				}),
		)
		const failed = io.request('/old.data')
		await started
		const ordinary = await io.request('/ordinary.data')
		expect(ordinary.status).toBe(200)
		expect(ordinary.headers.get('Cache-Control')).toBe('public, max-age=60')
		rejectFirst(new Error('offline'))
		const error = await failed
		expect(error.status).toBe(503)
		expect(error.headers.get('Cache-Control')).toBe('no-store')
		const later = await io.request('/ordinary')
		expect(later.headers.get('Cache-Control')).toBe('public, max-age=60')
		expect(io.loader).toHaveBeenCalledTimes(2)
	})

	it('reports corrupt cache data without running content loaders or fetching a replacement', async () => {
		const io = setup({
			getOrLoad: () => Promise.resolve({}),
			invalidate: () => Promise.resolve(),
		})
		const response = await io.request('/old.data')
		expect(response.status).toBe(503)
		expect(response.headers.get('Cache-Control')).toBe('no-store')
		expect(io.loader).not.toHaveBeenCalled()
		expect(io.fetch).not.toHaveBeenCalled()
	})

	it('uses consumer storage across requests and refreshes after invalidation', async () => {
		const entries = new Map<string, unknown>()
		const cache: RedirectCache = {
			getOrLoad: async (key, load) => {
				if (!entries.has(key)) entries.set(key, await load())
				return entries.get(key)
			},
			invalidate: (key) => {
				entries.delete(key)
				return Promise.resolve()
			},
		}
		const io = setup(cache)
		await io.request('/old')
		await io.request('/old.data')
		expect(io.fetch).toHaveBeenCalledOnce()
		io.fetch.mockResolvedValue([{ ...rule, destination: '/changed' }])
		await invalidateRedirectCache(
			io.kit.publishedClient,
			{ ...policy, reservedPathPrefixes: ['/account'] },
			cache,
		)
		const response = await io.request('/old')
		expect(response.headers.get('Location')).toBe('/changed')
		expect(io.fetch).toHaveBeenCalledTimes(2)
	})
})
