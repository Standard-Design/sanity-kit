/**
 * Validate and resolve Sanity links without fetching data or requiring React.
 *
 * The app's query first turns stored references into destination objects. This
 * resolver checks those objects and returns a clean href plus new-tab settings.
 * `/react-router/links.tsx` renders the result; other callers can use it directly.
 * Allowed destination types normally come from the route registry's linkableTypes.
 * The app still owns Studio schemas, legacy-field conversion, and label rendering.
 *
 * @see docs/link.md#stored-fields-versus-query-results
 * @see docs/link.md#resolve-links-without-react
 */
import { stegaClean } from '@sanity/client/stega'

/**
 * Fields to select for a labeled link in an app query. Insert this literal into
 * a named `defineQuery` so TypeGen can read it without executing a factory.
 * Stored references become the same destination shape as route-data.ts, without
 * importing React Router. Labels keep their editing metadata. The label fallback
 * for `_key` does not guarantee unique array keys; the app must ensure those.
 * @see docs/link.md#query-fragments-and-typegen
 */
export const sanityLinkQueryFragment = /* groq */ `
	"_key": coalesce(_key, label),
	_type,
	linkType,
	label,
	internalDestination->{"pathname": pathname.current, _type, _id},
	search,
	hash,
	url,
	openInNewTab
`

/**
 * Literal projection for Portable Text markDefs, which use `_key` to attach marks
 * and do not need a separate label. The application still owns the Portable Text
 * serializer; this export only supplies GROQ fields for its link annotations.
 * @see docs/link.md#query-fragments-and-typegen
 */
export const sanityPortableTextLinkQueryFragment = /* groq */ `
	_type,
	_key,
	linkType,
	internalDestination->{"pathname": pathname.current, _type, _id},
	search,
	hash,
	url,
	openInNewTab
`

/** Conservative default protocol allowlist; config overrides are trusted app policy. */
export const defaultSanityExternalLinkProtocols = [
	'http:',
	'https:',
	'mailto:',
	'tel:',
] as const

/** Destination fields selected by the query, not the stored `{ _ref }` reference. */
export interface SanityInternalLinkDestination<TType extends string = string> {
	_id: string
	_type: TType
	pathname: string
}

/** Canonical internal link after projection; destination must have a route pathname. */
export interface SanityInternalLink<TType extends string = string> {
	linkType: 'internal'
	internalDestination: SanityInternalLinkDestination<TType>
	/** Optional URL query, including its leading `?`. */
	search?: string | null
	/** Optional URL fragment, including its leading `#`. */
	hash?: string | null
	openInNewTab?: boolean | null
}

/** An explicit absolute URL; even a same-site URL here uses external navigation policy. */
export interface SanityExternalLink {
	linkType: 'external'
	url: string
	openInNewTab?: boolean | null
}

/** Normalized link data shared by buttons, navigation, and Portable Text. */
export type SanityLink<TType extends string = string> =
	SanityInternalLink<TType> | SanityExternalLink

/** Link object variant whose visible label is stored in Sanity. */
export type SanityLabeledLink<TType extends string = string> =
	SanityLink<TType> & { label: string }

/** Clean, immutable navigation result; render the original label separately. */
export interface ResolvedSanityInternalLink<TType extends string = string> {
	linkType: 'internal'
	href: string
	internalDestination: Readonly<SanityInternalLinkDestination<TType>>
	search: string
	hash: string
	openInNewTab: boolean
}

/** Validated protocol and clean href; URL existence/reachability is not checked. */
export interface ResolvedSanityExternalLink {
	linkType: 'external'
	href: string
	url: string
	openInNewTab: boolean
}

/** `linkType` tells the React adapter whether to use router or document navigation. */
export type ResolvedSanityLink<TType extends string = string> =
	ResolvedSanityInternalLink<TType> | ResolvedSanityExternalLink

/** App settings for allowed document types and external URL protocols. */
export interface CreateSanityLinkResolverConfig<TType extends string = string> {
	/** Internal document types accepted by this application. */
	linkableTypes: readonly TType[]
	/** Explicit URL protocols accepted for external links. */
	allowedExternalProtocols?: readonly string[]
}

/** Frozen policy snapshot plus a validator reusable across many links. */
export interface SanityLinkResolver<TType extends string = string> {
	readonly linkableTypes: readonly TType[]
	readonly allowedExternalProtocols: readonly string[]
	/** Validate and resolve unknown Sanity link data into a safe href. */
	resolve: (link: unknown) => ResolvedSanityLink<TType>
}

/**
 * Invalid-link error whose `path` identifies the field that failed. The React
 * adapter lets it reach the app rather than silently rendering a broken anchor.
 * The app chooses a fallback; error messages may not be safe to show publicly.
 * @see docs/link.md#invalid-links-and-migration-from-application-specific-shapes
 */
export class SanityLinkResolutionError extends TypeError {
	readonly code = 'SANITY_LINK_INVALID'

	constructor(
		readonly path: readonly string[],
		message: string,
	) {
		super(`[sanity-kit] ${message}`)
		this.name = 'SanityLinkResolutionError'
	}
}

/**
 * Configure a resolver once and reuse it for many links. With React Router,
 * supply the registry's `linkableTypes` so links and renderers share one list.
 * An allowed type does not prove that a document exists or that a visitor may
 * access it. Only navigation fields are Stega-cleaned; the original object and
 * its label stay unchanged so visible text can retain Visual Editing metadata.
 *
 * @throws TypeError for invalid factory configuration.
 * @throws SanityLinkResolutionError when `resolve` receives malformed link data.
 * @see docs/link.md#resolve-links-without-react
 */
export function createSanityLinkResolver<const TType extends string>(
	config: CreateSanityLinkResolverConfig<TType>,
): SanityLinkResolver<TType> {
	const linkableTypes = normalizeLinkableTypes(config.linkableTypes)
	const linkableTypeSet = new Set<string>(linkableTypes)
	const allowedExternalProtocols = normalizeProtocols(
		config.allowedExternalProtocols ?? defaultSanityExternalLinkProtocols,
	)
	const allowedExternalProtocolSet = new Set(allowedExternalProtocols)

	/** Called by the React adapter on render, or directly by other integrations. */
	function resolve(link: unknown): ResolvedSanityLink<TType> {
		const value = readRecord(link, [], 'Expected a Sanity link object.')
		const linkType = readString(value, 'linkType', ['linkType'])
		const openInNewTab = readOpenInNewTab(value)

		if (linkType === 'internal') {
			const destination = readRecord(
				value.internalDestination,
				['internalDestination'],
				'Expected an internal link destination.',
			)
			const id = readString(destination, '_id', ['internalDestination', '_id'])
			const type = readString(destination, '_type', [
				'internalDestination',
				'_type',
			])

			if (!linkableTypeSet.has(type)) {
				throw invalid(
					['internalDestination', '_type'],
					`Internal destination type "${type}" is not registered as linkable.`,
				)
			}

			// Keep path, search, and hash separate until each has passed its own
			// checks; a document pathname must not smuggle another origin or suffix.
			const pathname = readString(destination, 'pathname', [
				'internalDestination',
				'pathname',
			])
			assertInternalPathname(pathname)
			const search = readUrlSuffix(value, 'search', '?')
			const hash = readUrlSuffix(value, 'hash', '#')
			const internalDestination = Object.freeze({
				_id: id,
				_type: type as TType,
				pathname,
			})

			return Object.freeze({
				linkType: 'internal',
				href: `${pathname}${search}${hash}`,
				internalDestination,
				search,
				hash,
				openInNewTab,
			})
		}

		if (linkType === 'external') {
			const url = readString(value, 'url', ['url'])
			if (url !== url.trim() || containsControlCharacter(url)) {
				throw invalid(
					['url'],
					'External URLs must not contain surrounding whitespace or control characters.',
				)
			}
			// Parse for protocol validation, but retain the cleaned authored URL
			// rather than imposing URL-parser serialization on mailto/tel/etc.
			let protocol: string
			try {
				protocol = new URL(url).protocol.toLowerCase()
			} catch {
				throw invalid(['url'], 'External links must contain an absolute URL.')
			}

			if (!allowedExternalProtocolSet.has(protocol)) {
				throw invalid(
					['url'],
					`External URL protocol "${protocol}" is not allowed.`,
				)
			}

			return Object.freeze({
				linkType: 'external',
				href: url,
				url,
				openInNewTab,
			})
		}

		throw invalid(
			['linkType'],
			'Expected `linkType` to be either "internal" or "external".',
		)
	}

	return Object.freeze({
		linkableTypes,
		allowedExternalProtocols,
		resolve,
	})
}

/** Trusted GROQ source supplied by developers, never interpolated user input. */
export interface CreateSanityLinkQueryFragmentsOptions {
	/** GROQ fields used to resolve `internalDestination`. */
	internalDestinationQueryFragment: string
}

/**
 * Build link projections using the app's destination fields. This assembles GROQ
 * at runtime; it does not validate returned links or install a Studio schema.
 * TypeGen may not evaluate this function call and the destructuring that follows.
 * For generation, prefer the static exports above or app-owned literal fragments
 * for custom schemas. Only pass trusted query source, never visitor input.
 * @see docs/link.md#query-fragments-and-typegen
 */
export function createSanityLinkQueryFragments(
	options: CreateSanityLinkQueryFragmentsOptions,
): Readonly<{
	linkQueryFragment: string
	portableTextLinkQueryFragment: string
}> {
	const destination = options.internalDestinationQueryFragment.trim()
	if (destination.length === 0) {
		throw new TypeError(
			'[sanity-kit] `internalDestinationQueryFragment` must not be empty.',
		)
	}

	return Object.freeze({
		linkQueryFragment: /* groq */ `
		"_key": coalesce(_key, label),
		_type,
		linkType,
		label,
		internalDestination->{${destination}},
		search,
		hash,
		url,
		openInNewTab`,
		portableTextLinkQueryFragment: /* groq */ `
		_type,
		_key,
		linkType,
		internalDestination->{${destination}},
		search,
		hash,
		url,
		openInNewTab`,
	})
}

/** Copy the type list so changing the caller's array cannot change allowed links. */
function normalizeLinkableTypes<const TType extends string>(
	types: readonly TType[],
): readonly TType[] {
	const normalized: TType[] = []
	const seen = new Set<string>()
	for (const type of types) {
		if (typeof type !== 'string' || type.trim().length === 0) {
			throw new TypeError(
				'[sanity-kit] Linkable document types must not be empty.',
			)
		}
		if (seen.has(type)) {
			throw new TypeError(
				`[sanity-kit] Duplicate linkable document type: "${type}".`,
			)
		}
		seen.add(type)
		normalized.push(type)
	}

	return Object.freeze(normalized)
}

/** Lowercase and deduplicate protocols without adding any the app did not allow. */
function normalizeProtocols(protocols: readonly string[]): readonly string[] {
	const normalized: string[] = []
	const seen = new Set<string>()
	for (const input of protocols) {
		if (typeof input !== 'string') {
			throw new TypeError(
				'[sanity-kit] External URL protocols must be strings.',
			)
		}
		const protocol = input.toLowerCase()
		if (!/^[a-z][a-z0-9+.-]*:$/.test(protocol)) {
			throw new TypeError(
				`[sanity-kit] Invalid external URL protocol: "${input}".`,
			)
		}
		if (!seen.has(protocol)) {
			seen.add(protocol)
			normalized.push(protocol)
		}
	}

	return Object.freeze(normalized)
}

/** Fail with the caller's field path instead of allowing property-access errors. */
function readRecord(
	value: unknown,
	path: readonly string[],
	message: string,
): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw invalid(path, message)
	}
	return value as Record<string, unknown>
}

/** Clean only fields used for navigation logic, not the original CMS object. */
function readString(
	record: Record<string, unknown>,
	key: string,
	path: readonly string[],
): string {
	const value = record[key]
	if (typeof value !== 'string') {
		throw invalid(path, `Expected \`${key}\` to be a non-empty string.`)
	}

	const cleaned = stegaClean(value)
	if (cleaned.trim().length === 0) {
		throw invalid(path, `Expected \`${key}\` to be a non-empty string.`)
	}
	return cleaned
}

/** Treat unset draft flags as false; reject truthy non-booleans rather than coercing. */
function readOpenInNewTab(record: Record<string, unknown>): boolean {
	const value = record.openInNewTab
	if (value === undefined || value === null) return false
	if (typeof value === 'boolean') return value
	throw invalid(
		['openInNewTab'],
		'Expected `openInNewTab` to be a boolean, null, or undefined.',
	)
}

/** Preserve authored suffixes, requiring their delimiter and rejecting mixed query/hash. */
function readUrlSuffix(
	record: Record<string, unknown>,
	key: 'search' | 'hash',
	prefix: '?' | '#',
): string {
	const value = record[key]
	if (value === undefined || value === null || value === '') return ''
	if (typeof value !== 'string') {
		throw invalid([key], `Expected \`${key}\` to be a string when present.`)
	}

	const cleaned = stegaClean(value)
	if (cleaned === '') return ''
	if (!cleaned.startsWith(prefix)) {
		throw invalid([key], `Expected \`${key}\` to begin with \`${prefix}\`.`)
	}
	if (
		containsControlCharacter(cleaned) ||
		(key === 'search' && cleaned.includes('#'))
	) {
		throw invalid(
			[key],
			`Expected \`${key}\` to contain only its ${key} portion.`,
		)
	}
	return cleaned
}

/** Reject origin-like paths and URL separators that belong in separate link fields. */
function assertInternalPathname(pathname: string): void {
	if (
		!pathname.startsWith('/') ||
		pathname.startsWith('//') ||
		pathname.includes('\\') ||
		pathname.includes('?') ||
		pathname.includes('#') ||
		containsControlCharacter(pathname)
	) {
		throw invalid(
			['internalDestination', 'pathname'],
			'Internal destination `pathname` must be a root-relative path without a query or hash.',
		)
	}
}

/** Shared rejection of ASCII controls that URL parsers may discard or reinterpret. */
function containsControlCharacter(value: string): boolean {
	for (const character of value) {
		const codePoint = character.codePointAt(0)
		if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) {
			return true
		}
	}
	return false
}

/** Centralize typed errors and copy/freeze their path before returning to callers. */
function invalid(
	path: readonly string[],
	message: string,
): SanityLinkResolutionError {
	return new SanityLinkResolutionError(Object.freeze([...path]), message)
}
