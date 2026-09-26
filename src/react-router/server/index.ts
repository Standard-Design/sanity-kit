import type {
	ClientPerspective,
	FilteredResponseQueryOptions,
	SanityClient,
} from '@sanity/client'
import type { CookieOptions } from 'react-router'
import { createClient } from '@sanity/client'
import { validatePreviewUrl } from '@sanity/preview-url-secret'
import { createCookieSessionStorage } from 'react-router'
import {
	defineSanityConfig,
	type SanityPublicConfig,
} from '../../core/index.js'

export {
	createSanitySitemapLoader,
	type CreateSanitySitemapLoaderConfig,
	type SanitySitemapCache,
} from './sitemap.js'

export {
	createSanityLoaders,
	defineSanityLoader,
	type CreateSanityLoadersConfig,
	type SanityLoaderCache,
	type SanityLoaderCacheContext,
	type SanityLoaderConfig,
	type SanityLoaderContext,
	type SanityLoaders,
	type SanityLoaderValidationFailure,
	type SanityLoaderValidationPolicy,
} from './loaders.js'

const defaultCookieName = '__sanity_preview'
const defaultRedirect = '/'
const minimumSessionSecretLength = 32

export interface SanityPreviewCookieConfig {
	name?: string
	domain?: string
	path?: string
	sameSite?: Exclude<CookieOptions['sameSite'], undefined>
	secure?: boolean
	maxAge?: number
}

export interface SanityPreviewUrlValidation {
	isValid: boolean
	redirectTo?: string | undefined
	studioOrigin?: string | undefined
	studioPreviewPerspective?: string | null | undefined
}

export type SanityPreviewUrlValidator = (
	client: SanityClient,
	url: string,
) => Promise<SanityPreviewUrlValidation>

export type SanityPreviewPerspectiveParser = (
	value: string | null | undefined,
) => ClientPerspective

export interface CreateSanityKitConfig extends SanityPublicConfig {
	studioUrl: string
	/** Token used only by the server preview client. */
	readToken: string
	/** Independent secret used to sign the preview session cookie. */
	sessionSecret: string
	/** Published client CDN behavior. Defaults to true. */
	useCdn?: boolean
	preview?: {
		cookie?: SanityPreviewCookieConfig
		parsePerspective?: SanityPreviewPerspectiveParser
		validateUrl?: SanityPreviewUrlValidator
	}
}

export interface SanityPreviewContext {
	preview: boolean
	perspective: ClientPerspective
	client: SanityClient
	options: FilteredResponseQueryOptions
}

export interface SanityPreviewHandlers {
	getContext: (request: Request) => Promise<SanityPreviewContext>
	enable: (args: { request: Request }) => Promise<Response>
	disable: (args: { request: Request }) => Promise<Response>
}

export interface SanityKit {
	publishedClient: SanityClient
	previewClient: SanityClient
	clientFor: (preview: boolean) => SanityClient
	preview: SanityPreviewHandlers
}

interface SanityPreviewSessionData {
	preview: boolean
	perspective: ClientPerspective
}

/**
 * Create explicit Sanity clients and React Router preview-session handlers.
 * This entrypoint is server-only and never reaches browser-safe barrels.
 */
export function createSanityKit(config: CreateSanityKitConfig): SanityKit {
	assertNonEmpty(config.studioUrl, 'studioUrl')
	const publicConfig = defineSanityConfig({
		apiVersion: config.apiVersion,
		dataset: config.dataset,
		projectId: config.projectId,
		studioUrl: config.studioUrl,
	})
	assertNonEmpty(config.readToken, 'readToken')
	assertNonEmpty(config.sessionSecret, 'sessionSecret')
	if (config.sessionSecret.trim().length < minimumSessionSecretLength) {
		throw new TypeError(
			`[sanity-kit] \`sessionSecret\` must contain at least ${minimumSessionSecretLength} characters.`,
		)
	}

	const publishedClient = createClient({
		apiVersion: publicConfig.apiVersion,
		dataset: publicConfig.dataset,
		perspective: 'published',
		projectId: publicConfig.projectId,
		stega: false,
		useCdn: config.useCdn ?? true,
	})
	const previewClient = publishedClient.withConfig({
		perspective: 'drafts',
		stega: {
			enabled: true,
			studioUrl: publicConfig.studioUrl,
		},
		token: config.readToken,
		useCdn: false,
	})
	const sessionStorage = createCookieSessionStorage<SanityPreviewSessionData>({
		cookie: {
			name: defaultCookieName,
			path: '/',
			sameSite: 'none',
			secure: true,
			...config.preview?.cookie,
			httpOnly: true,
			secrets: [config.sessionSecret],
		},
	})
	const parsePerspective =
		config.preview?.parsePerspective ?? parseSanityPreviewPerspective
	const validateUrl: SanityPreviewUrlValidator =
		config.preview?.validateUrl ?? validatePreviewUrl

	async function getContext(request: Request): Promise<SanityPreviewContext> {
		const session = await sessionStorage.getSession(
			request.headers.get('Cookie'),
		)
		const preview = session.get('preview') === true
		const perspective = preview
			? normalizeStoredPerspective(session.get('perspective'))
			: 'published'

		return {
			preview,
			perspective,
			client: preview ? previewClient : publishedClient,
			options: preview
				? { perspective, stega: true }
				: { perspective: 'published', stega: false },
		}
	}

	async function enable({ request }: { request: Request }): Promise<Response> {
		const validation = await validateUrl(previewClient, request.url)
		if (!validation.isValid) {
			return new Response('Invalid preview URL.', {
				status: 401,
				headers: noStoreHeaders({
					'Content-Type': 'text/plain; charset=utf-8',
				}),
			})
		}

		const session = await sessionStorage.getSession(
			request.headers.get('Cookie'),
		)
		const perspective = parsePerspective(validation.studioPreviewPerspective)
		session.set('preview', true)
		session.set('perspective', perspective)

		return redirectResponse(
			safeRedirectLocation(new URL(request.url), validation.redirectTo),
			await sessionStorage.commitSession(session),
		)
	}

	async function disable({ request }: { request: Request }): Promise<Response> {
		const session = await sessionStorage.getSession(
			request.headers.get('Cookie'),
		)
		const url = new URL(request.url)
		const redirectTo = safeRedirectLocation(
			url,
			url.searchParams.get('redirect'),
		)

		return redirectResponse(
			redirectTo,
			await sessionStorage.destroySession(session),
		)
	}

	return {
		publishedClient,
		previewClient,
		clientFor: (preview) => (preview ? previewClient : publishedClient),
		preview: { getContext, enable, disable },
	}
}

/**
 * Parse Studio's perspective value without trusting arbitrary cookie or URL
 * data. Single built-in perspectives remain strings; release stacks become
 * a bounded array of safe tokens.
 */
export function parseSanityPreviewPerspective(
	value: string | null | undefined,
): ClientPerspective {
	if (value === undefined || value === null || value.trim() === '') {
		return 'drafts'
	}

	const perspectives = value.split(',').map((entry) => entry.trim())
	if (
		perspectives.length > 10 ||
		perspectives.some(
			(entry) =>
				entry.length === 0 ||
				entry.length > 256 ||
				!/^[a-zA-Z0-9._~:/-]+$/u.test(entry),
		)
	) {
		return 'drafts'
	}

	if (perspectives.length === 1 && isBuiltInPerspective(perspectives[0])) {
		return perspectives[0]
	}

	return perspectives
}

/** Return a same-origin relative redirect or `/` for unsafe input. */
export function safeRedirectLocation(
	requestUrl: URL,
	value: string | null | undefined,
): string {
	if (value === undefined || value === null || value === '') {
		return defaultRedirect
	}

	try {
		const target = new URL(value, requestUrl)
		if (target.origin !== requestUrl.origin) return defaultRedirect
		return `${target.pathname}${target.search}${target.hash}`
	} catch {
		return defaultRedirect
	}
}

function normalizeStoredPerspective(value: unknown): ClientPerspective {
	if (typeof value === 'string') return parseSanityPreviewPerspective(value)
	if (
		Array.isArray(value) &&
		value.every((entry) => typeof entry === 'string')
	) {
		return parseSanityPreviewPerspective(value.join(','))
	}
	return 'drafts'
}

function isBuiltInPerspective(
	value: string | undefined,
): value is 'published' | 'drafts' | 'raw' | 'previewDrafts' {
	return (
		value === 'published' ||
		value === 'drafts' ||
		value === 'raw' ||
		value === 'previewDrafts'
	)
}

function safeRedirectHeaders(cookie: string, location: string): Headers {
	return noStoreHeaders({ Location: location, 'Set-Cookie': cookie })
}

function redirectResponse(location: string, cookie: string): Response {
	return new Response(null, {
		status: 307,
		headers: safeRedirectHeaders(cookie, location),
	})
}

function noStoreHeaders(initial: HeadersInit): Headers {
	const headers = new Headers(initial)
	headers.set('Cache-Control', 'no-store')
	return headers
}

function assertNonEmpty(value: unknown, name: string): void {
	if (typeof value !== 'string') {
		throw new TypeError(`[sanity-kit] \`${name}\` must be a string.`)
	}
	if (value.trim().length === 0) {
		throw new TypeError(`[sanity-kit] \`${name}\` must not be empty.`)
	}
}
