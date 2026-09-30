/**
 * Server-only clients and preview sessions. Never import this entrypoint into shared UI.
 *
 * `createSanityKit` uses supplied settings and secrets to create separate
 * published/preview clients and signed-cookie handlers. Page loaders read its
 * request context; sitemap loaders normally use its published
 * client. The root UI receives only a serializable preview flag so it can enable
 * Visual Editing. Never return the kit, a client, or the whole context as loader data.
 *
 * Uses standard Request/Response and React Router cookies, not Node-only sessions
 * or Cloudflare bindings. The app supplies secrets and registers resource routes.
 *
 * @see docs/server.md for setup, cookie settings, and request context.
 * @see docs/loaders.md and docs/sitemaps.md for content fetching.
 */
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

/**
 * Cookie deployment settings. Defaults support cross-origin Studio iframes:
 * SameSite=None, Secure, path=/, name=__sanity_preview. HttpOnly and signing are
 * enforced by the factory and cannot be overridden here. maxAge is in seconds.
 * Use distinct names/scopes if multiple apps share a host; the host owns HTTPS
 * and any local-development overrides.
 */
export interface SanityPreviewCookieConfig {
	name?: string
	domain?: string
	path?: string
	sameSite?: Exclude<CookieOptions['sameSite'], undefined>
	secure?: boolean
	maxAge?: number
}

/**
 * Result of Sanity's preview URL check, or an app's trusted replacement.
 * Only `isValid: true` permits a preview cookie. The handlers also use the
 * redirect and perspective; `studioOrigin` is accepted for compatibility but
 * does not expand allowed redirects. A query parameter alone is not proof of access.
 */
export interface SanityPreviewUrlValidation {
	isValid: boolean
	redirectTo?: string | undefined
	studioOrigin?: string | undefined
	studioPreviewPerspective?: string | null | undefined
}

/** Async server seam; defaults to @sanity/preview-url-secret's validator. */
export type SanityPreviewUrlValidator = (
	client: SanityClient,
	url: string,
) => Promise<SanityPreviewUrlValidation>

/** Trusted override for the validated Studio URL's perspective string. */
export type SanityPreviewPerspectiveParser = (
	value: string | null | undefined,
) => ClientPerspective

/** Explicit server configuration; do not pass this whole object to browser code. */
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

/**
 * Published or preview client and fetch settings selected for this request.
 * Without a valid preview session, this describes a normal published request.
 * Keep them server-side. Passing only `client` to a fetch is not enough: also pass
 * `options`, since the session may select a release stack instead of default drafts.
 * @see docs/server.md#published-and-preview-clients
 */
export interface SanityRequestContext {
	preview: boolean
	perspective: ClientPerspective
	client: SanityClient
	options: FilteredResponseQueryOptions
}

/** Handlers for app resource routes; the app selects route paths and HTTP exports. */
export interface SanityPreviewHandlers {
	/** Validate Studio's preview URL, commit session, and return a safe redirect. */
	enable: (args: { request: Request }) => Promise<Response>
	/** Destroy preview session and redirect; paired with SanityPreviewExit's href. */
	disable: (args: { request: Request }) => Promise<Response>
}

/** Clients and session handlers used by page loaders, sitemap loaders, and the app. */
export interface SanityKit {
	/**
	 * Select published or preview fetching for this request by reading session state.
	 * Does not enable preview or write a cookie; safe to destructure the result.
	 * @see docs/server.md#published-and-preview-clients
	 */
	getContext: (request: Request) => Promise<SanityRequestContext>
	/** Untokened client with published perspective and Stega disabled. */
	publishedClient: SanityClient
	/** Tokened, non-CDN client; must never enter browser loader data. */
	previewClient: SanityClient
	/** Low-level selection only; getContext also supplies request-specific perspective. */
	clientFor: (preview: boolean) => SanityClient
	preview: SanityPreviewHandlers
}

/** Cookie payload contains preview state, never the Sanity token or signing secret. */
interface SanityPreviewSessionData {
	preview: boolean
	perspective: ClientPerspective
}

/**
 * Create the server kit from settings and secrets supplied by the application.
 * Call this in a server module, or in an app factory if the host supplies secrets
 * per request. Construction checks configuration but makes no Sanity request.
 * The session secret is independent of the read token; its trimmed length must
 * be at least 32 characters, but the actual supplied string is used for signing.
 * This length check does not generate entropy or establish an app login session.
 * @throws TypeError for invalid public config, missing secrets, or a short secret.
 * @see docs/server.md#create-the-server-kit
 * @see docs/server.md#cookie-configuration
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
	// Separate clients prevent a published request from inheriting draft tokens,
	// Stega, or cache behavior through mutation of a shared client's configuration.
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
			// Apply these last: callers may tune deployment settings, never signing
			// or JS access to the cookie. Cookie contents are signed, not encrypted.
			httpOnly: true,
			secrets: [config.sessionSecret],
		},
	})
	const parsePerspective =
		config.preview?.parsePerspective ?? parseSanityPreviewPerspective
	const validateUrl: SanityPreviewUrlValidator =
		config.preview?.validateUrl ?? validatePreviewUrl

	/** Read session state without writing it; page loaders reuse this selection for both queries. */
	async function getContext(request: Request): Promise<SanityRequestContext> {
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

	/** Only a successfully validated preview URL may create/refresh preview state. */
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

	/** Full-document exit navigation reaches this handler and applies Set-Cookie. */
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
		getContext,
		publishedClient,
		previewClient,
		clientFor: (preview) => (preview ? previewClient : publishedClient),
		preview: { enable, disable },
	}
}

/**
 * Read the content perspective supplied by Studio or stored in a preview cookie.
 * Recognized built-ins such as `drafts` stay strings; custom release names become
 * an array, even for one release. Limit the count, length, and allowed characters
 * before passing the selection to Sanity. This does not check that releases exist.
 * Missing or malformed input falls back to drafts. Stored cookie selections are
 * checked again on every request, even though the cookie signature was verified.
 * @see docs/server.md#perspectives-and-trusted-extension-points
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

/**
 * Keep preview enable/disable redirects on the request's origin, falling back to `/`.
 * Relative and same-origin absolute targets become a path, query, and fragment.
 * The app must supply the correct public request URL when running behind a proxy;
 * this helper cannot establish which host should be trusted or authorize a visitor.
 * @see docs/server.md#wire-enable-and-disable-resource-routes
 */
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

/** Revalidate session payload shape even though the cookie signature was checked. */
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

/** Preserve scalar form only for upstream's recognized built-in perspective names. */
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

/** Keep session writes and navigation together, with caching disabled. */
function safeRedirectHeaders(cookie: string, location: string): Headers {
	return noStoreHeaders({ Location: location, 'Set-Cookie': cookie })
}

/** Shared 307 response for enable/disable; redirect policy is checked by callers. */
function redirectResponse(location: string, cookie: string): Response {
	return new Response(null, {
		status: 307,
		headers: safeRedirectHeaders(cookie, location),
	})
}

/** Copy initial headers and prevent caching of preview authentication responses. */
function noStoreHeaders(initial: HeadersInit): Headers {
	const headers = new Headers(initial)
	headers.set('Cache-Control', 'no-store')
	return headers
}

/** Give field-named config errors without exposing token/secret contents. */
function assertNonEmpty(value: unknown, name: string): void {
	if (typeof value !== 'string') {
		throw new TypeError(`[sanity-kit] \`${name}\` must be a string.`)
	}
	if (value.trim().length === 0) {
		throw new TypeError(`[sanity-kit] \`${name}\` must not be empty.`)
	}
}
