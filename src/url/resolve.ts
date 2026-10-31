import { stegaClean } from '@sanity/client/stega'
import {
	createPagesRegistry,
	pagePathname,
	pageSlug,
	storedPagePathname,
	type PagesRouteConfig,
} from './registry.js'

/** Derived URL parts, not three values to persist in a document. */
export interface SanityResolvedUrl {
	readonly pathname: string
	/** Parent path of the final segment; '/' for root-level pages and home. */
	readonly prefix: string
	/** Final URL segment, still percent-encoded if stored that way; '' only at '/'. */
	readonly slug: string
}

export type SanityUrlFailureReason =
	| 'missing-document'
	| 'invalid-document'
	| 'unregistered-type'
	| 'missing-value'
	| 'invalid-value'
	| 'disallowed-path'
	| 'noncanonical-path'

export type SanityUrlResult =
	| { readonly ok: true; readonly value: SanityResolvedUrl }
	| { readonly ok: false; readonly reason: SanityUrlFailureReason }

export type SanityUrlResolver = (document: unknown) => SanityUrlResult

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Read only stored object fields, never inherited properties or array indices. */
function readField(document: Record<string, unknown>, field: string): unknown {
	let value: unknown = document
	for (const part of field.split('.')) {
		if (!record(value) || !Object.hasOwn(value, part)) return undefined
		value = value[part]
	}
	return value
}

/**
 * Validate and snapshot shared Pages registration once, then resolve many query
 * results. Invalid configuration throws at setup; missing/invalid document data
 * returns an explicit failure instead of inventing a link.
 *
 * The resolver reads _type and the registered string field (e.g. slug.current).
 * Stega is removed only from the comparison value; render data stays untouched.
 * Fixed prefixes are supported today. Settings loading, reverse lookup, URL
 * uniqueness, and application route matching are separate responsibilities.
 */
export function createSanityUrlResolver(
	config: PagesRouteConfig,
): SanityUrlResolver {
	const registry = createPagesRegistry(config)
	return (document) => {
		if (document === null || document === undefined)
			return { ok: false, reason: 'missing-document' }
		if (
			!record(document) ||
			!Object.hasOwn(document, '_type') ||
			typeof document._type !== 'string' ||
			!document._type
		)
			return { ok: false, reason: 'invalid-document' }
		const type = registry.types.find(
			(entry) => entry.schemaType === document._type,
		)
		if (!type) return { ok: false, reason: 'unregistered-type' }
		const stored = readField(document, type.pathField)
		const value = typeof stored === 'string' ? stegaClean(stored) : stored
		if (value === undefined || value === null || value === '')
			return { ok: false, reason: 'missing-value' }
		if (!(type.pathMode === 'slug' ? pageSlug(value) : pagePathname(value)))
			return { ok: false, reason: 'invalid-value' }
		const pathname = storedPagePathname(registry, type, value)
		if (!pathname) return { ok: false, reason: 'disallowed-path' }
		// Legacy Studio navigation still exposes authored noncanonical paths so
		// editors can fix them. A new frontend helper must not silently normalize
		// those paths or report an empty slug for a non-home page.
		if (pathname !== '/' && (pathname.endsWith('/') || pathname.includes('//')))
			return { ok: false, reason: 'noncanonical-path' }
		const separator = pathname.lastIndexOf('/')
		return {
			ok: true,
			value: {
				pathname,
				prefix: pathname.slice(0, separator) || '/',
				slug: pathname.slice(separator + 1),
			},
		}
	}
}
