import type { SanityClient } from '@sanity/client'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	createFixtureHttpHandler,
	type FixtureMode,
} from '../fixtures/pages-studio/preview-http.js'

const servers: Server[] = []
afterEach(async () => {
	await Promise.all(
		servers.splice(0).map(
			(server) =>
				new Promise<void>((resolve, reject) => {
					server.closeAllConnections()
					server.close((error) => (error ? reject(error) : resolve()))
				}),
		),
	)
})
const rule = {
	_id: 'redirect-proof',
	_type: 'sanityKitRedirect',
	source: '/old',
	destination: '/new',
	status: 301,
	enabled: true,
}
async function fixture(mode: FixtureMode, rows: unknown = [rule]) {
	const fetch = vi.fn(() => Promise.resolve(rows))
	const contentFetch = vi.fn(() => Promise.resolve({ page: null, links: [] }))
	const client = {
		config: () => ({ projectId: 'proof123', dataset: 'development' }),
		withConfig: () => ({ fetch }),
		fetch: contentFetch,
	} as unknown as SanityClient
	const server = createServer()
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject)
		server.listen(0, '127.0.0.1', () => {
			server.off('error', reject)
			resolve()
		})
	})
	servers.push(server)
	const port = (server.address() as AddressInfo).port
	const handler = createFixtureHttpHandler({
		mode,
		port,
		client,
		projectId: 'proof123',
		dataset: 'development',
		assets: { '/fixture-client.js': 'asset' },
	})
	server.on('request', (request, response) => {
		void handler(request, response)
	})
	const request = (path: string, init?: RequestInit) =>
		globalThis.fetch(`http://127.0.0.1:${port}${path}`, {
			redirect: 'manual',
			...init,
		})
	return { request, fetch, contentFetch, port }
}

describe('proof frontend HTTP redirects', () => {
	it.each(['GET', 'HEAD'])(
		'delivers saved redirects for published %s requests',
		async (method) => {
			const t = await fixture('published')
			const response = await t.request(
				'/old?token=private&sanity-preview-perspective=drafts',
				{ method },
			)
			expect(response.status).toBe(301)
			expect(response.headers.get('location')).toBe('/new')
			expect(response.headers.get('cache-control')).toBe('no-store')
			expect(await response.text()).toBe('')
			expect(t.fetch).toHaveBeenCalledOnce()
			expect(t.fetch.mock.calls[0]).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ perspective: 'published' }),
				]),
			)
		},
	)
	it('loads fresh rules after a redirect is retired without retaining a fixture cache', async () => {
		const t = await fixture('published')
		expect((await t.request('/old')).status).toBe(301)
		t.fetch.mockResolvedValue([{ ...rule, enabled: false }])
		const response = await t.request('/old')
		expect(response.status).toBe(200)
		expect(await response.text()).toContain('data-fixture-mode="published"')
		expect(t.fetch).toHaveBeenCalledTimes(2)
	})
	it('bypasses saved redirects on the preview listener even with published perspective', async () => {
		const t = await fixture('preview')
		const response = await t.request(
			'/old?sanity-preview-perspective=published',
		)
		expect(response.status).toBe(200)
		expect(await response.text()).toContain('data-fixture-mode="preview"')
		expect(t.fetch).not.toHaveBeenCalled()
	})
	it.each(['bad-data', 'network'])(
		'fails closed when the published redirect inventory has %s',
		async (failure) => {
			const t = await fixture('published', [{ ...rule, destination: '/old' }])
			if (failure === 'network')
				t.fetch.mockRejectedValue(new Error('private credentials'))
			const response = await t.request('/unrelated')
			expect(response.status).toBe(503)
			expect(response.headers.get('cache-control')).toBe('no-store')
			expect(await response.text()).not.toContain('private credentials')
		},
	)
	it('does not redirect assets or check rules for unsupported methods', async () => {
		const t = await fixture('published')
		const asset = await t.request('/fixture-client.js')
		expect(await asset.text()).toBe('asset')
		const method = await t.request('/old', { method: 'POST' })
		expect(method.status).toBe(405)
		expect(method.headers.get('allow')).toBe('GET, HEAD')
		expect(t.fetch).not.toHaveBeenCalled()
	})
	it('rejects foreign origins before using server credentials', async () => {
		const t = await fixture('published')
		expect(
			(
				await t.request('/old', {
					headers: { origin: 'https://untrusted.example' },
				})
			).status,
		).toBe(403)
		expect(t.fetch).not.toHaveBeenCalled()
	})
	it('pins published data reads despite browser-supplied preview flags', async () => {
		const t = await fixture('published', [
			{
				_id: 'kitProofArticleRouting',
				_rev: 'settings-revision',
				_type: 'sanityKitCollectionRoute',
				collection: 'articles',
				prefix: { _type: 'slug', current: '/articles' },
			},
		])
		const response = await t.request(
			'/fixture-data?path=/&perspective=%22drafts%22',
		)
		expect(response.status).toBe(200)
		expect(t.contentFetch).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({ articlePrefix: '/articles' }),
			expect.objectContaining({ perspective: 'published' }),
		)
	})
})
