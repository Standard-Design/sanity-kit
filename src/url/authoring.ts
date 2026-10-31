/**
 * Private preparation layer for the forthcoming Studio URL field. Reading a URL
 * must never repair it; an explicit editor action may propose a cleaned value.
 * These helpers return candidates, not Sanity patches or permission to publish.
 * @see docs/url.md#authoring-preparation-internal
 */
import { stegaClean } from '@sanity/client/stega'
import speakingurl from 'speakingurl'
import {
	createSanityUrlResolver,
	type SanityResolvedUrl,
	type SanityUrlFailureReason,
} from './resolve.js'
import {
	createPagesRegistry,
	pagePathname,
	pageSlug,
	type PagesRouteConfig,
	type RegisteredPageType,
} from './registry.js'

export interface UrlCandidate {
	readonly url: SanityResolvedUrl
	/** The actual configured string field; do not persist the derived URL parts. */
	readonly fieldPath: string
	readonly storedValue: string
}

export type UrlPreparationReason =
	SanityUrlFailureReason | 'invalid-prefix' | 'locked-prefix' | 'missing-slug'
export type UrlPreparationResult =
	| { readonly ok: true; readonly value: UrlCandidate }
	| { readonly ok: false; readonly reason: UrlPreparationReason }

/**
 * Repair only literal internal separators and a trailing slash. Reject an
 * authority-like leading // before cleanup, and never decode, trim, add a leading
 * slash, or resolve dot segments. '/about//team/' can be cleaned; '//host' cannot.
 */
function cleanPathname(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined
	const clean = stegaClean(value)
	if (!pagePathname(clean)) return undefined
	return clean.replace(/\/{2,}/gu, '/').replace(/\/$/u, '') || '/'
}

/** Build an isolated query-shaped object for the existing shared URL resolver. */
function candidateDocument(type: RegisteredPageType, value: string) {
	const document: Record<string, unknown> = { _type: type.schemaType }
	let parent = document
	const parts = type.pathField.split('.')
	for (const part of parts.slice(0, -1)) {
		const next: Record<string, unknown> = {}
		parent[part] = next
		parent = next
	}
	parent[parts.at(-1)!] = value
	return document
}

/**
 * Snapshot registration for editor actions. The future field will choose when to
 * call these methods and will separately enforce read-only, conflict checks, and
 * publish/redirect policy. Do not invoke preparation while merely displaying data.
 * This is intentionally not exported from /url until the field API is reviewed.
 */
export function createUrlAuthoring(config: PagesRouteConfig) {
	const registry = createPagesRegistry(config)
	for (const type of registry.types) {
		if (type.pathField.startsWith('_'))
			throw new Error(
				`URL authoring cannot target document metadata: ${type.schemaType}.${type.pathField}`,
			)
	}
	for (const collection of registry.collections) {
		if (cleanPathname(collection.routePrefix) !== collection.routePrefix)
			throw new Error(
				`URL authoring needs a canonical collection prefix: ${collection.name}`,
			)
	}
	const resolve = createSanityUrlResolver(config)
	function prepareStored(
		schemaType: string,
		stored: unknown,
	): UrlPreparationResult {
		const type = registry.types.find((entry) => entry.schemaType === schemaType)
		if (!type) return { ok: false, reason: 'unregistered-type' }
		const value = typeof stored === 'string' ? stegaClean(stored) : stored
		if (value === null || value === undefined || value === '')
			return { ok: false, reason: 'missing-value' }
		// A slash in a collection slug is never interpreted as another folder.
		const prepared =
			type.pathMode === 'slug' ? pageSlug(value) : cleanPathname(value)
		if (!prepared) return { ok: false, reason: 'invalid-value' }
		const result = resolve(candidateDocument(type, prepared))
		if (!result.ok) return result
		return {
			ok: true,
			value: {
				url: result.value,
				fieldPath: type.pathField,
				storedValue: prepared,
			},
		}
	}
	function prepareParts(
		schemaType: string,
		input: { readonly prefix: unknown; readonly slug: unknown },
	): UrlPreparationResult {
		const type = registry.types.find((entry) => entry.schemaType === schemaType)
		if (!type) return { ok: false, reason: 'unregistered-type' }
		const prefix = cleanPathname(input.prefix)
		if (!prefix) return { ok: false, reason: 'invalid-prefix' }
		const collection = registry.collections.find(
			(entry) => entry.name === type.collection,
		)
		// Even legacy full-path collection items cannot leave their configured group.
		// They may keep nested folders; slug-only items have one exact locked prefix.
		if (type.pathMode === 'slug' && prefix !== type.routePrefix)
			return { ok: false, reason: 'locked-prefix' }
		if (
			collection &&
			type.pathMode === 'pathname' &&
			prefix !== collection.routePrefix &&
			!prefix.startsWith(`${collection.routePrefix}/`)
		)
			return { ok: false, reason: 'locked-prefix' }
		const slug =
			typeof input.slug === 'string' ? stegaClean(input.slug) : input.slug
		if (slug === '' && prefix === '/' && !collection)
			return prepareStored(schemaType, '/')
		if (slug === '' || slug === null || slug === undefined)
			return { ok: false, reason: 'missing-slug' }
		const segment = pageSlug(slug)
		if (!segment) return { ok: false, reason: 'invalid-value' }
		return prepareStored(
			schemaType,
			type.pathMode === 'slug'
				? segment
				: `${prefix === '/' ? '' : prefix}/${segment}`,
		)
	}
	return Object.freeze({ prepareStored, prepareParts })
}

export type SlugGenerationResult =
	| { readonly ok: true; readonly value: string }
	| {
			readonly ok: false
			readonly reason:
				| 'missing-source'
				| 'invalid-source'
				| 'invalid-slug'
				| 'generation-failed'
	  }

/**
 * Match Sanity 6.17's default: speakingurl with symbols and truncation (200 unless
 * configured). Do not add our own Unicode normalization, encoding, or shortening.
 * Like native slugify, a custom generator may be async and bypasses maxLength.
 * Afterwards, our separate URL rules require a safe, nonempty single segment.
 * The field will bind native schema/context arguments, choose the title source,
 * and ignore stale async completions before offering a candidate for application.
 */
export async function generateUrlSlug(
	source: unknown,
	options: {
		readonly maxLength?: number
		readonly slugify?: (source: string) => string | Promise<string>
	} = {},
): Promise<SlugGenerationResult> {
	if (source === null || source === undefined || source === '')
		return { ok: false, reason: 'missing-source' }
	if (typeof source !== 'string') return { ok: false, reason: 'invalid-source' }
	const clean = stegaClean(source)
	if (!clean) return { ok: false, reason: 'missing-source' }
	let candidate: unknown
	try {
		candidate = options.slugify
			? await options.slugify(clean)
			: speakingurl(clean, {
					truncate:
						typeof options.maxLength === 'number' ? options.maxLength : 200,
					symbols: true,
				})
	} catch {
		return { ok: false, reason: 'generation-failed' }
	}
	const slug = pageSlug(candidate)
	if (!slug) return { ok: false, reason: 'invalid-slug' }
	return { ok: true, value: slug }
}
