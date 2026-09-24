import { stegaClean } from '@sanity/client/stega'

export interface SitemapEntry {
	/** Root-relative path or an absolute URL on the configured site origin. */
	loc: string
	/** Actual modification date, never the sitemap generation time. */
	lastmod?: string | Date
}

export interface SitemapOptions {
	/** Canonical HTTP(S) origin, independent of the incoming request host. */
	siteUrl: string
}

export interface SitemapResponseOptions extends SitemapOptions {
	/** Application cache policy and other headers; XML content type is fixed. */
	headers?: HeadersInit
}

const namespace = 'http://www.sitemaps.org/schemas/sitemap/0.9'
const maxEntries = 50_000
const maxBytes = 52_428_800
const encoder = new TextEncoder()

/** Serialize a sitemap. Duplicate canonical URLs retain the latest lastmod. */
export function serializeSitemap(
	entries: readonly SitemapEntry[],
	options: SitemapOptions,
): string {
	return serialize(entries, options, 'urlset', 'url')
}

/** Serialize an index of same-origin sitemap files, using their update dates. */
export function serializeSitemapIndex(
	entries: readonly SitemapEntry[],
	options: SitemapOptions,
): string {
	return serialize(entries, options, 'sitemapindex', 'sitemap')
}

export function createSitemapResponse(
	entries: readonly SitemapEntry[],
	options: SitemapResponseOptions,
): Response {
	return xmlResponse(serializeSitemap(entries, options), options.headers)
}

export function createSitemapIndexResponse(
	entries: readonly SitemapEntry[],
	options: SitemapResponseOptions,
): Response {
	return xmlResponse(serializeSitemapIndex(entries, options), options.headers)
}

function xmlResponse(xml: string, initial?: HeadersInit): Response {
	const headers = new Headers(initial)
	headers.set('Content-Type', 'application/xml; charset=utf-8')
	headers.set('X-Content-Type-Options', 'nosniff')
	if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'no-cache')
	return new Response(xml, { headers })
}

function serialize(
	entries: readonly SitemapEntry[],
	options: SitemapOptions,
	root: 'urlset' | 'sitemapindex',
	tag: 'url' | 'sitemap',
): string {
	const site = parseSite(options.siteUrl)
	if (!isArray(entries)) {
		throw new TypeError('[sanity-kit] Sitemap entries must be an array.')
	}
	const unique = new Map<string, string | undefined>()
	for (const entry of entries) {
		if (!entry || typeof entry.loc !== 'string') {
			throw new TypeError('[sanity-kit] A sitemap entry requires a loc string.')
		}
		const loc = parseLocation(stegaClean(entry.loc), site)
		const lastmod =
			entry.lastmod === undefined ? undefined : parseLastmod(entry.lastmod)
		const previous = unique.get(loc)
		if (
			!unique.has(loc) ||
			(lastmod !== undefined &&
				(previous === undefined || Date.parse(lastmod) > Date.parse(previous)))
		) {
			unique.set(loc, lastmod)
		}
		if (unique.size > maxEntries) {
			throw new RangeError(
				'[sanity-kit] A sitemap may contain at most 50,000 unique entries. Split it into multiple sitemaps.',
			)
		}
	}

	const opening = `<?xml version="1.0" encoding="UTF-8"?>\n<${root} xmlns="${namespace}">\n`
	const closing = `</${root}>`
	const parts = [opening]
	let bytes = encoder.encode(opening + closing).byteLength
	for (const [loc, lastmod] of unique) {
		const row = `<${tag}><loc>${escapeXml(loc)}</loc>${lastmod === undefined ? '' : `<lastmod>${escapeXml(lastmod)}</lastmod>`}</${tag}>\n`
		bytes += encoder.encode(row).byteLength
		if (bytes > maxBytes) {
			throw new RangeError(
				'[sanity-kit] A sitemap may be at most 50 MiB uncompressed. Split it into multiple sitemaps.',
			)
		}
		parts.push(row)
	}
	parts.push(closing)
	return parts.join('')
}

function isArray(value: unknown): value is readonly unknown[] {
	return Array.isArray(value)
}

function parseSite(value: string): URL {
	if (
		typeof value !== 'string' ||
		!/^https?:\/\/[^/?#]+\/?$/iu.test(value) ||
		hasUnsafeCharacters(value)
	) {
		throw new TypeError(
			'[sanity-kit] siteUrl must be a canonical HTTP(S) origin.',
		)
	}
	const url = new URL(value)
	if (
		url.username ||
		url.password ||
		url.pathname !== '/' ||
		value.includes('?') ||
		value.includes('#')
	) {
		throw new TypeError(
			'[sanity-kit] siteUrl must contain only an origin, without credentials, path, query, or fragment.',
		)
	}
	return url
}

function parseLocation(value: string, site: URL): string {
	if (
		value.length === 0 ||
		hasUnsafeCharacters(value) ||
		value.trim() !== value ||
		value.includes('#') ||
		/%(?![\da-f]{2})/iu.test(value) ||
		!(
			(value.startsWith('/') && !value.startsWith('//')) ||
			/^https?:\/\//iu.test(value)
		)
	) {
		throw new TypeError(
			'[sanity-kit] Sitemap loc must be a root-relative path or an absolute HTTP(S) URL without a fragment.',
		)
	}
	const url = new URL(value, site)
	if (url.origin !== site.origin || url.username || url.password) {
		throw new TypeError(
			'[sanity-kit] Sitemap URLs must share siteUrl’s origin and contain no credentials.',
		)
	}
	if (url.href.length >= 2048) {
		throw new RangeError(
			'[sanity-kit] Sitemap URLs must be shorter than 2,048 characters.',
		)
	}
	return url.href
}

function hasUnsafeCharacters(value: string): boolean {
	// URL parsers silently discard controls and rewrite backslashes. Reject them.
	// eslint-disable-next-line no-control-regex
	return /[\u0000-\u0020\u007f\\]/u.test(value) || !value.isWellFormed()
}

function parseLastmod(value: string | Date): string {
	if (value instanceof Date) {
		if (!Number.isFinite(value.getTime()))
			throw new TypeError('[sanity-kit] Invalid sitemap lastmod date.')
		value = value.toISOString()
	}
	if (typeof value !== 'string')
		throw new TypeError('[sanity-kit] Invalid sitemap lastmod date.')
	value = stegaClean(value)
	const match =
		/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2}))?$/u.exec(
			value,
		)
	if (!match)
		throw new TypeError(
			'[sanity-kit] lastmod must be YYYY-MM-DD or an ISO timestamp with a timezone.',
		)
	const year = Number(match[1])
	const month = Number(match[2])
	const day = Number(match[3])
	const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
	const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
	if (
		year === 0 ||
		month < 1 ||
		month > 12 ||
		day < 1 ||
		day > (days[month - 1] ?? 0) ||
		Number(match[4] ?? 0) > 23 ||
		Number(match[5] ?? 0) > 59 ||
		Number(match[6] ?? 0) > 59 ||
		!Number.isFinite(Date.parse(value))
	) {
		throw new TypeError('[sanity-kit] Invalid sitemap lastmod date.')
	}
	return value
}

function escapeXml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;')
}
