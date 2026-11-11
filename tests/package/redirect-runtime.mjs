/** Installed public HTTP boundary; no Studio or router needed for this part. */
import assert from 'node:assert/strict'
import {
	resolveRedirectRequest,
	redirectResponse,
	invalidateRedirectCache,
} from '@standard-design/sanity-kit/redirect'

const rule = {
	_id: 'rule',
	_type: 'sanityKitRedirect',
	enabled: true,
	source: '/old',
	destination: '/new',
	status: 301,
}
let calls = 0
let fails = false
const client = {
	config: () => ({ projectId: 'project123', dataset: 'test' }),
	withConfig: (config) => {
		assert.equal(config.perspective, 'published')
		return {
			fetch: async () => {
				calls++
				if (fails) throw new Error('Test read failure')
				return [{ ...rule }]
			},
		}
	},
}
const policy = { destinations: 'unverified' }
const options = {
	...policy,
	preview: false,
	reservedPathPrefixes: ['/account'],
	queryParameterAllowlist: ['lang'],
}
const request = (path = '/old', init) =>
	new Request(`https://app.example${path}`, init)
for (const method of ['GET', 'HEAD']) {
	const result = await resolveRedirectRequest(
		client,
		request('/old?lang=en&token=secret', { method }),
		options,
	)
	assert.equal(result.kind, 'redirect')
	const response = redirectResponse(result)
	assert.equal(response.status, 301)
	assert.equal(response.headers.get('Location'), '/new?lang=en')
	assert.equal(response.headers.get('Cache-Control'), 'no-store')
	assert.equal(await response.text(), '')
}
calls = 0
for (const [req, config] of [
	[request('/old', { method: 'POST' }), options],
	[request('/old'), { ...options, preview: true }],
	[request('/account/profile'), options],
]) {
	assert.equal(
		(await resolveRedirectRequest(client, req, config)).kind,
		'bypass',
	)
}
assert.equal(calls, 0)
assert.equal(
	redirectResponse(
		await resolveRedirectRequest(client, request('/missing'), options),
	),
	undefined,
)
fails = true
assert.equal(
	redirectResponse(await resolveRedirectRequest(client, request(), options))
		.status,
	503,
)
fails = false
const abort = new globalThis.AbortController()
abort.abort()
assert.equal(
	(
		await resolveRedirectRequest(
			client,
			request('/old', { signal: abort.signal }),
			options,
		)
	).reason,
	'aborted',
)

// A test adapter only: consumers still own lifetime and stale-load prevention.
const entries = new Map()
const cache = {
	async getOrLoad(key, load) {
		if (!entries.has(key)) entries.set(key, await load())
		return entries.get(key)
	},
	async invalidate(key) {
		entries.delete(key)
	},
}
calls = 0
for (let index = 0; index < 2; index++)
	assert.equal(
		(await resolveRedirectRequest(client, request(), { ...options, cache }))
			.kind,
		'redirect',
	)
assert.equal(calls, 1)
assert.deepEqual(await invalidateRedirectCache(client, options, cache), {
	ok: true,
})
assert.equal(entries.size, 0)
await resolveRedirectRequest(client, request(), { ...options, cache })
assert.equal(calls, 2)
assert.equal(
	(
		await resolveRedirectRequest(client, request(), {
			...options,
			cache: {
				...cache,
				getOrLoad: async () => {
					throw new Error('Test cache failure')
				},
			},
		})
	).reason,
	'cache-failed',
)
await assert.rejects(
	import('@standard-design/sanity-kit/redirect/request.js'),
	{ code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' },
)
assert.equal(
	'compileRedirectSnapshot' in
		(await import('@standard-design/sanity-kit/redirect')),
	false,
)
console.log('PASS installed generic redirect HTTP/cache contracts')

if (process.argv.includes('--router')) {
	const { createRequestHandler } = await import('react-router')
	const { createSanityKit, createSanityRedirectMiddleware } =
		await import('@standard-design/sanity-kit/react-router/server')
	const kit = createSanityKit({
		projectId: 'project123',
		dataset: 'test',
		apiVersion: '2026-10-01',
		studioUrl: 'https://studio.example',
		readToken: 'test-only',
		sessionSecret: 'test-secret-with-at-least-32-characters',
		preview: {
			validateUrl: async () => ({
				isValid: true,
				studioPreviewPerspective: 'published',
			}),
		},
	})
	let reads = 0
	let loads = 0
	let failing = false
	// Keep real signed session handlers. Replace only the network boundary with
	// a structural client so the fixture does not depend on version-specific
	// SDK request-interception hooks; SDK compatibility is checked in redirect.ts.
	const routerKit = {
		...kit,
		publishedClient: {
			config: client.config,
			withConfig: () => ({
				fetch: async () => {
					reads++
					if (failing) throw new Error('Test read failure')
					return [{ ...rule }]
				},
			}),
		},
	}
	const middleware = createSanityRedirectMiddleware({
		kit: routerKit,
		...policy,
		queryParameterAllowlist: ['lang'],
	})
	assert.equal(middleware.length, 2)
	const handler = createRequestHandler(
		{
			entry: {
				module: {
					default: (_request, status, headers) =>
						new globalThis.Response('content', { status, headers }),
					handleError: () => {},
				},
			},
			routes: {
				root: {
					id: 'root',
					path: '',
					module: { default: () => null, middleware, loader: () => null },
				},
				page: {
					id: 'page',
					parentId: 'root',
					path: '*',
					module: {
						default: () => null,
						loader: () => {
							loads++
							return { page: true }
						},
					},
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
		},
		'test',
	)
	const document = await handler(request('/old?lang=en'))
	assert.equal(document.status, 301)
	assert.equal(document.headers.get('Location'), '/new?lang=en')
	assert.equal(loads, 0)
	const data = await handler(request('/old.data?lang=fr&_routes=page'))
	assert.equal(data.status, 202)
	assert.equal(data.headers.get('Location'), null)
	assert.match(await data.text(), /\/new\?lang=fr/u)
	assert.equal(data.headers.get('Cache-Control'), 'no-store')
	const enable = await kit.preview.enable({ request: request('/preview') })
	const cookie = enable.headers.get('Set-Cookie').split(';')[0]
	reads = 0
	for (const path of ['/old', '/old.data'])
		assert.equal(
			(await handler(request(path, { headers: { Cookie: cookie } }))).status,
			200,
		)
	assert.equal(reads, 0, 'Signed Published preview bypasses redirect reads.')
	failing = true
	for (const path of ['/old', '/old.data']) {
		const response = await handler(request(path))
		assert.equal(response.status, 503)
		assert.equal(response.headers.get('Cache-Control'), 'no-store')
	}
	assert.equal(
		'createSanityRedirectMiddleware' in
			(await import('@standard-design/sanity-kit/react-router')),
		false,
	)
	console.log('PASS installed React Router redirect transport contracts')
}
