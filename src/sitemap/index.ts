/**
 * Turn page URLs or sitemap-file URLs into validated XML and Web Responses.
 *
 * The server sitemap adapter fetches published data, decodes it, and asks the app
 * to map it into these entries. Other runtimes can call these helpers directly.
 * The app chooses canonical URLs and real update dates, filters noindex pages,
 * and splits large sites into files. This module checks URLs/dates, combines
 * duplicates, escapes XML, and enforces entry and UTF-8 byte limits.
 * It does not query Sanity, read preview cookies, or discover application routes.
 *
 * @see docs/sitemaps.md#portable-xml-helpers
 * @see docs/sitemaps.md#large-sites-and-sitemap-indexes
 */
import { stegaClean } from '@sanity/client/stega'

/** Shared input for a page URL in a sitemap or a sitemap URL in an index. */
export interface SitemapEntry {
	/** Root-relative path or an absolute URL on the configured site origin. */
	loc: string
	/** Actual modification date, never the sitemap generation time. */
	lastmod?: string | Date
}

/** The app supplies the canonical origin; never derive it from a visitor's Host header. */
export interface SitemapOptions {
	/** Canonical HTTP(S) origin, independent of the incoming request host. */
	siteUrl: string
}

/** Web-response settings shared by these helpers and the React Router adapter. */
export interface SitemapResponseOptions extends SitemapOptions {
	/** Application cache policy and other headers; XML content type is fixed. */
	headers?: HeadersInit
}

// Count unique entries and the complete uncompressed XML, including outer tags
// and escaped characters. The app must split oversized collections into files.
const namespace = 'http://www.sitemaps.org/schemas/sitemap/0.9'
const maxEntries = 50_000
const maxBytes = 52_428_800
const encoder = new TextEncoder()

/**
 * Serialize a sitemap. Duplicate canonical URLs retain the latest lastmod.
 * Stega is removed from loc/date strings, not from the caller's input objects.
 * Relative locations resolve against siteUrl; every resulting URL must share
 * that origin. Input order determines first occurrence order after deduplication.
 * @throws TypeError for invalid entries/origin/dates, RangeError for size limits.
 * @see docs/sitemaps.md#url-rules
 * @see docs/sitemaps.md#modification-dates-and-duplicates
 */
export function serializeSitemap(
	entries: readonly SitemapEntry[],
	options: SitemapOptions,
): string {
	return serialize(entries, options, 'urlset', 'url')
}

/**
 * Serialize an index of same-origin sitemap files, using their update dates.
 * Uses the same canonicalization, deduplication, and limits as serializeSitemap.
 * Supply sitemap locations explicitly; this does not split or write sitemap files.
 * @see docs/sitemaps.md#large-sites-and-sitemap-indexes
 */
export function serializeSitemapIndex(
	entries: readonly SitemapEntry[],
	options: SitemapOptions,
): string {
	return serialize(entries, options, 'sitemapindex', 'sitemap')
}

/**
 * Wrap a page sitemap in an XML Response. Used by the React Router adapter;
 * also suitable for any runtime implementing the Web Response/Headers APIs.
 * Defaults to no-cache (revalidation), not no-store; apps may supply cache policy.
 * @see docs/sitemaps.md#response-headers
 */
export function createSitemapResponse(
	entries: readonly SitemapEntry[],
	options: SitemapResponseOptions,
): Response {
	return xmlResponse(serializeSitemap(entries, options), options.headers)
}

/** XML Response counterpart of serializeSitemapIndex, with identical header policy. */
export function createSitemapIndexResponse(
	entries: readonly SitemapEntry[],
	options: SitemapResponseOptions,
): Response {
	return xmlResponse(serializeSitemapIndex(entries, options), options.headers)
}

/** Allow app caching headers while always setting the XML content type and nosniff. */
function xmlResponse(xml: string, initial?: HeadersInit): Response {
	const headers = new Headers(initial)
	headers.set('Content-Type', 'application/xml; charset=utf-8')
	headers.set('X-Content-Type-Options', 'nosniff')
	if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'no-cache')
	return new Response(xml, { headers })
}

/** Build page sitemaps and indexes the same way; only their outer and entry tags differ. */
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
	// A relative path and its equivalent absolute URL should appear only once.
	// Updating a Map value keeps the first occurrence's position but lets us use
	// a later modification date for a duplicate URL.
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
	// Measure UTF-8 bytes after XML escaping, not JavaScript string length.
	// Include the outer tags before adding entries so the full document fits.
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

/** Keep runtime validation effective for JavaScript/untyped callers. */
function isArray(value: unknown): value is readonly unknown[] {
	return Array.isArray(value)
}

/** Accept only an HTTP(S) origin, excluding paths, credentials, query, and fragment. */
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

/**
 * Reject unsafe input before URL parsing can silently rewrite it. Then check
 * the origin and final URL length. Queries are allowed; fragments and URLs
 * starting with `//` are not. The final href is also the duplicate-detection key.
 */
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

/** Shared guard against parser normalization surprises and malformed Unicode. */
function hasUnsafeCharacters(value: string): boolean {
	// URL parsers silently discard controls and rewrite backslashes. Reject them.
	// eslint-disable-next-line no-control-regex
	return /[\u0000-\u0020\u007f\\]/u.test(value) || !value.isWellFormed()
}

/**
 * Accept a calendar date or a timestamp with a timezone. Check each calendar
 * field because Date.parse can silently turn impossible dates into valid ones.
 * Date objects become UTC ISO strings; valid authored strings keep their precision
 * and offset. Only the app can know whether this date reflects a real content edit.
 */
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

/** Escape text only after URL/date validation; ampersands must be replaced first. */
function escapeXml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;')
}
