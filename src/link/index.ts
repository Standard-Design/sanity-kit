import { stegaClean } from '@sanity/client/stega'

export const defaultSanityExternalLinkProtocols = [
	'http:',
	'https:',
	'mailto:',
	'tel:',
] as const

export interface SanityInternalLinkDestination<TType extends string = string> {
	_id: string
	_type: TType
	pathname: string
}

export interface SanityInternalLink<TType extends string = string> {
	linkType: 'internal'
	internalDestination: SanityInternalLinkDestination<TType>
	/** Optional URL query, including its leading `?`. */
	search?: string | null
	/** Optional URL fragment, including its leading `#`. */
	hash?: string | null
	openInNewTab?: boolean | null
}

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

export interface ResolvedSanityInternalLink<TType extends string = string> {
	linkType: 'internal'
	href: string
	internalDestination: Readonly<SanityInternalLinkDestination<TType>>
	search: string
	hash: string
	openInNewTab: boolean
}

export interface ResolvedSanityExternalLink {
	linkType: 'external'
	href: string
	url: string
	openInNewTab: boolean
}

export type ResolvedSanityLink<TType extends string = string> =
	ResolvedSanityInternalLink<TType> | ResolvedSanityExternalLink

export interface CreateSanityLinkResolverConfig<TType extends string = string> {
	/** Internal document types accepted by this application. */
	linkableTypes: readonly TType[]
	/** Explicit URL protocols accepted for external links. */
	allowedExternalProtocols?: readonly string[]
}

export interface SanityLinkResolver<TType extends string = string> {
	readonly linkableTypes: readonly TType[]
	readonly allowedExternalProtocols: readonly string[]
	/** Validate and resolve unknown Sanity link data into a safe href. */
	resolve: (link: unknown) => ResolvedSanityLink<TType>
}

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
 * Create a runtime-neutral link resolver. Bind it to the route registry's
 * `linkableTypes` so the CMS cannot navigate to an unhandled document type.
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

export interface CreateSanityLinkQueryFragmentsOptions {
	/** GROQ fields used to resolve `internalDestination`. */
	internalDestinationQueryFragment: string
}

/**
 * Build query fragments for the normalized link contract without imposing a
 * document model or schema library on the consumer.
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

function readOpenInNewTab(record: Record<string, unknown>): boolean {
	const value = record.openInNewTab
	if (value === undefined || value === null) return false
	if (typeof value === 'boolean') return value
	throw invalid(
		['openInNewTab'],
		'Expected `openInNewTab` to be a boolean, null, or undefined.',
	)
}

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

function containsControlCharacter(value: string): boolean {
	for (const character of value) {
		const codePoint = character.codePointAt(0)
		if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) {
			return true
		}
	}
	return false
}

function invalid(
	path: readonly string[],
	message: string,
): SanityLinkResolutionError {
	return new SanityLinkResolutionError(Object.freeze([...path]), message)
}
