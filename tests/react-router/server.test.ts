import { describe, expect, it, vi } from 'vitest'
import {
	createSanityKit,
	parseSanityPreviewPerspective,
	safeRedirectLocation,
} from '../../src/react-router/server/index.js'

const baseConfig = {
	apiVersion: '2026-09-19',
	dataset: 'production',
	projectId: 'project123',
	readToken: 'read-token',
	sessionSecret: 'a-secure-session-secret-with-32-characters',
	studioUrl: 'https://studio.example.com',
} as const

describe('createSanityKit', () => {
	it('creates separate published and preview clients', () => {
		const kit = createSanityKit(baseConfig)

		expect(kit.publishedClient.config()).toMatchObject({
			perspective: 'published',
			stega: { enabled: false },
			useCdn: true,
		})
		expect(kit.publishedClient.config().token).toBeUndefined()
		expect(kit.previewClient.config()).toMatchObject({
			perspective: 'drafts',
			stega: {
				enabled: true,
				studioUrl: 'https://studio.example.com',
			},
			token: 'read-token',
			useCdn: false,
		})
		expect(kit.clientFor(false)).toBe(kit.publishedClient)
		expect(kit.clientFor(true)).toBe(kit.previewClient)
	})

	it('returns a published context without a preview cookie', async () => {
		const kit = createSanityKit(baseConfig)
		const context = await kit.preview.getContext(
			new Request('https://example.com/page'),
		)

		expect(context).toEqual({
			preview: false,
			perspective: 'published',
			client: kit.publishedClient,
			options: { perspective: 'published', stega: false },
		})
	})

	it('enables preview with a signed, secure session cookie', async () => {
		const validateUrl = vi.fn().mockResolvedValue({
			isValid: true,
			redirectTo: '/draft?from=studio',
			studioPreviewPerspective: 'drafts,release-2026',
		})
		const kit = createSanityKit({
			...baseConfig,
			preview: { validateUrl },
		})

		const response = await kit.preview.enable({
			request: new Request(
				'https://example.com/preview/enable?sanity-preview-secret=secret',
			),
		})
		const setCookie = response.headers.get('Set-Cookie')

		expect(response.status).toBe(307)
		expect(response.headers.get('Location')).toBe('/draft?from=studio')
		expect(response.headers.get('Cache-Control')).toBe('no-store')
		expect(setCookie).toContain('__sanity_preview=')
		expect(setCookie).toContain('HttpOnly')
		expect(setCookie).toContain('Secure')
		expect(setCookie).toContain('SameSite=None')
		expect(validateUrl).toHaveBeenCalledWith(
			kit.previewClient,
			'https://example.com/preview/enable?sanity-preview-secret=secret',
		)

		const cookie = setCookie?.split(';', 1)[0]
		const context = await kit.preview.getContext(
			new Request('https://example.com/draft', {
				headers: { Cookie: cookie ?? '' },
			}),
		)

		expect(context).toEqual({
			preview: true,
			perspective: ['drafts', 'release-2026'],
			client: kit.previewClient,
			options: {
				perspective: ['drafts', 'release-2026'],
				stega: true,
			},
		})
	})

	it('rejects invalid preview URLs without creating a session', async () => {
		const kit = createSanityKit({
			...baseConfig,
			preview: {
				validateUrl: vi.fn().mockResolvedValue({ isValid: false }),
			},
		})

		const response = await kit.preview.enable({
			request: new Request('https://example.com/preview/enable'),
		})

		expect(response.status).toBe(401)
		expect(response.headers.get('Set-Cookie')).toBeNull()
		expect(response.headers.get('Cache-Control')).toBe('no-store')
	})

	it('prevents a custom validator from redirecting off origin', async () => {
		const kit = createSanityKit({
			...baseConfig,
			preview: {
				validateUrl: vi.fn().mockResolvedValue({
					isValid: true,
					redirectTo: 'https://attacker.example/page',
				}),
			},
		})

		const response = await kit.preview.enable({
			request: new Request('https://example.com/preview/enable'),
		})

		expect(response.headers.get('Location')).toBe('/')
	})

	it('disables preview and prevents external redirects', async () => {
		const kit = createSanityKit(baseConfig)
		const response = await kit.preview.disable({
			request: new Request(
				'https://example.com/preview/disable?redirect=https://attacker.example',
			),
		})

		expect(response.status).toBe(307)
		expect(response.headers.get('Location')).toBe('/')
		expect(response.headers.get('Set-Cookie')).toContain(
			'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
		)
	})

	it('allows explicit local-development cookie policy', async () => {
		const kit = createSanityKit({
			...baseConfig,
			preview: {
				cookie: { sameSite: 'lax', secure: false },
				validateUrl: vi.fn().mockResolvedValue({ isValid: true }),
			},
		})
		const response = await kit.preview.enable({
			request: new Request('http://localhost:5173/preview/enable'),
		})
		const cookie = response.headers.get('Set-Cookie')

		expect(cookie).toContain('SameSite=Lax')
		expect(cookie).not.toContain('Secure')
	})

	it('requires independent non-empty token and strong session secret', () => {
		expect(() => createSanityKit({ ...baseConfig, readToken: ' ' })).toThrow(
			'`readToken` must not be empty',
		)
		expect(() =>
			createSanityKit({ ...baseConfig, sessionSecret: 'short' }),
		).toThrow('`sessionSecret` must contain at least 32 characters')
		expect(() =>
			createSanityKit({ ...baseConfig, sessionSecret: ' '.repeat(32) }),
		).toThrow('`sessionSecret` must not be empty')
	})
})

describe('parseSanityPreviewPerspective', () => {
	it.each([
		[undefined, 'drafts'],
		[null, 'drafts'],
		['published', 'published'],
		['drafts', 'drafts'],
		['raw', 'raw'],
		['release-2026', ['release-2026']],
		['drafts,release-2026', ['drafts', 'release-2026']],
	] as const)('parses %s', (value, expected) => {
		expect(parseSanityPreviewPerspective(value)).toEqual(expected)
	})

	it.each(['drafts,<script>', 'drafts,', ' ', 'a'.repeat(257)])(
		'falls back for unsafe value %s',
		(value) => {
			expect(parseSanityPreviewPerspective(value)).toBe('drafts')
		},
	)
})

describe('safeRedirectLocation', () => {
	const requestUrl = new URL('https://example.com/preview/disable')

	it('keeps same-origin path, search, and hash', () => {
		expect(
			safeRedirectLocation(requestUrl, '/page?mode=published#content'),
		).toBe('/page?mode=published#content')
	})

	it.each([undefined, null, '', 'https://attacker.example/page', 'http://['])(
		'uses the fallback for %s',
		(value) => {
			expect(safeRedirectLocation(requestUrl, value)).toBe('/')
		},
	)
})
