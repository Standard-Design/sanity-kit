/**
 * Private bridge from separately loaded routing settings to the existing URL
 * registry. Content keeps its slug; only the routing context changes. No fetch,
 * cache, Studio schema, publication, or document mutation happens here.
 * @see docs/collection-routing.md
 */
import {
	createPagesRegistry,
	pagePathname,
	type PageCollectionDefinition,
	type PagesRegistry,
	type PagesRouteConfig,
} from '../registry.js'
import { createSanityUrlResolver, type SanityUrlResolver } from '../resolve.js'

export const COLLECTION_ROUTE_TYPE = 'sanityKitCollectionRoute'
export const MAX_SETTINGS_COLLECTIONS = 100
export const MAX_SETTINGS_DOCUMENTS = 1000
export const MAX_COLLECTION_PREFIX_LENGTH = 2048

/** A configured singleton identity, never inferred from an overview page. */
export interface CollectionPrefixBinding {
	readonly documentId: string
}

export interface SettingsCollectionDefinition extends Omit<
	PageCollectionDefinition,
	'routePrefix'
> {
	readonly routePrefix: string | CollectionPrefixBinding
}

export interface CollectionRoutingConfig extends Omit<
	PagesRouteConfig,
	'collections'
> {
	readonly site: string
	readonly collections?: readonly SettingsCollectionDefinition[]
}

/**
 * Raw identities are preserved. Completeness covers all configured published IDs,
 * plus their draft counterparts only when coverage is published-and-drafts. A
 * public read can supply published coverage without permission to read drafts.
 */
export type RoutingSettingsSnapshot =
	| { readonly status: 'unavailable' }
	| {
			readonly status: 'available'
			readonly perspective: 'raw'
			readonly coverage: 'published' | 'published-and-drafts'
			readonly complete: true
			readonly documents: readonly unknown[]
	  }

export type RoutingPerspective = 'published' | 'drafts'

export interface ResolvedCollectionSetting {
	readonly collection: string
	readonly documentId: string
	readonly revision: string
	readonly prefix: string
}

export type CollectionRoutingResult =
	| {
			readonly ok: true
			readonly value: {
				readonly routes: PagesRouteConfig
				readonly resolveUrl: SanityUrlResolver
				readonly settings: readonly ResolvedCollectionSetting[]
			}
	  }
	| {
			readonly ok: false
			readonly reason:
				| 'unsupported-perspective'
				| 'settings-unavailable'
				| 'settings-missing'
				| 'settings-invalid'
				| 'settings-ambiguous'
				| 'routing-conflict'
			readonly collection?: string
	  }

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function own(value: Record<string, unknown>, key: string): unknown {
	return Object.hasOwn(value, key) ? value[key] : undefined
}

function canonicalPrefix(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		value.length <= MAX_COLLECTION_PREFIX_LENGTH &&
		value !== '/' &&
		pagePathname(value) === value &&
		!value.endsWith('/') &&
		!value.includes('//')
	)
}

/** Return the registry's immutable copies, not mutable caller-owned definitions. */
function routeConfig(registry: PagesRegistry): PagesRouteConfig {
	return Object.freeze({
		pages: Object.freeze(
			registry.types
				.filter((type) => type.collection === undefined)
				.map((type) =>
					Object.freeze({
						schemaType: type.schemaType,
						pathnameField: type.pathField,
						titleField: type.titleField,
					}),
				),
		),
		collections: registry.collections,
		excludePaths: registry.excludePaths,
	})
}

/**
 * Snapshot app configuration once. Dynamic prefixes have no fallback. Temporary
 * setup-only prefixes let the existing registry validate every other setting;
 * those placeholders never escape into results or become document URLs.
 */
export function createCollectionRouting(config: CollectionRoutingConfig) {
	if (
		typeof config.site !== 'string' ||
		!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(config.site)
	)
		throw new Error(
			'Collection routing needs a stable site identifier (1–64 characters).',
		)
	if (config.collections !== undefined && !Array.isArray(config.collections))
		throw new Error('collections must be an array.')
	const site = config.site
	const definitions: readonly SettingsCollectionDefinition[] =
		config.collections ?? []
	const bindings = new Map<string, string>()
	const fixedPrefixes: string[] = []
	for (const collection of definitions) {
		if (!collection) throw new Error('Invalid collection registration.')
		if (typeof collection.routePrefix === 'string') {
			if (!canonicalPrefix(collection.routePrefix))
				throw new Error(
					'Collection routing needs canonical, non-root fixed prefixes.',
				)
			fixedPrefixes.push(collection.routePrefix)
			continue
		}
		const binding = collection.routePrefix
		const documentId = record(binding) ? own(binding, 'documentId') : undefined
		if (
			!record(binding) ||
			typeof documentId !== 'string' ||
			!/^[A-Za-z0-9_][A-Za-z0-9_-]{0,120}$/u.test(documentId) ||
			['drafts', 'versions'].includes(documentId)
		)
			throw new Error(
				'Settings bindings need a non-dotted published document ID (1–121 characters).',
			)
		if ([...bindings.values()].includes(documentId))
			throw new Error('Each collection needs its own settings document.')
		if (
			!Array.isArray(collection.items) ||
			collection.items.some(
				(item: unknown) =>
					!record(item) ||
					typeof own(item, 'slugField') !== 'string' ||
					own(item, 'pathnameField') !== undefined,
			)
		)
			throw new Error(
				'Settings-backed collections require slug-only item fields.',
			)
		bindings.set(collection.name, documentId)
	}
	if (bindings.size > MAX_SETTINGS_COLLECTIONS)
		throw new Error(
			`At most ${MAX_SETTINGS_COLLECTIONS} settings-backed collections are supported.`,
		)
	let placeholderIndex = 0
	const usedPrefixes = [...fixedPrefixes]
	const temporary = definitions.map((collection) => {
		if (typeof collection.routePrefix === 'string')
			return { ...collection, routePrefix: collection.routePrefix }
		let prefix: string
		do {
			prefix = `/_sanity-kit-settings-${placeholderIndex++}`
		} while (
			usedPrefixes.some(
				(existing) =>
					existing === prefix ||
					existing.startsWith(`${prefix}/`) ||
					prefix.startsWith(`${existing}/`),
			)
		)
		usedPrefixes.push(prefix)
		return { ...collection, routePrefix: prefix }
	})
	const base = routeConfig(
		createPagesRegistry({
			pages: config.pages,
			collections: temporary,
			...(config.excludePaths === undefined
				? {}
				: { excludePaths: config.excludePaths }),
		}),
	)
	const documentIds = Object.freeze([...bindings.values()])

	return Object.freeze({
		/** IDs a later loader must read, with draft counterparts for preview. */
		documentIds,
		resolve(
			snapshot: unknown,
			perspective: RoutingPerspective,
		): CollectionRoutingResult {
			if (perspective !== 'published' && perspective !== 'drafts')
				return { ok: false, reason: 'unsupported-perspective' }
			let documents: readonly unknown[] = []
			if (bindings.size) {
				if (!record(snapshot) || own(snapshot, 'status') === 'unavailable')
					return { ok: false, reason: 'settings-unavailable' }
				if (
					own(snapshot, 'status') !== 'available' ||
					own(snapshot, 'perspective') !== 'raw' ||
					own(snapshot, 'complete') !== true ||
					(own(snapshot, 'coverage') !== 'published' &&
						own(snapshot, 'coverage') !== 'published-and-drafts') ||
					(perspective === 'drafts' &&
						own(snapshot, 'coverage') !== 'published-and-drafts')
				)
					return { ok: false, reason: 'settings-unavailable' }
				const rows = own(snapshot, 'documents')
				if (!Array.isArray(rows) || rows.length > MAX_SETTINGS_DOCUMENTS)
					return { ok: false, reason: 'settings-invalid' }
				documents = rows as unknown[]
				if (
					documents.some(
						(document) =>
							!record(document) || typeof own(document, '_id') !== 'string',
					)
				)
					return { ok: false, reason: 'settings-invalid' }
			}
			const selected: ResolvedCollectionSetting[] = []
			const collections: PageCollectionDefinition[] = []
			for (const collection of base.collections ?? []) {
				const documentId = bindings.get(collection.name)
				if (!documentId) {
					collections.push(collection)
					continue
				}
				const published = documents.filter(
					(document) => record(document) && own(document, '_id') === documentId,
				)
				const drafts =
					perspective === 'drafts'
						? documents.filter(
								(document) =>
									record(document) &&
									own(document, '_id') === `drafts.${documentId}`,
							)
						: []
				const versions = drafts.length ? drafts : published
				if (!versions.length)
					return {
						ok: false,
						reason: 'settings-missing',
						collection: collection.name,
					}
				if (versions.length > 1)
					return {
						ok: false,
						reason: 'settings-ambiguous',
						collection: collection.name,
					}
				const document = versions[0] as Record<string, unknown>
				const prefix = own(document, 'prefix')
				const revision = own(document, '_rev')
				const pathname = record(prefix) ? own(prefix, 'current') : undefined
				const originalId = own(document, '_originalId')
				if (
					(originalId !== undefined && originalId !== own(document, '_id')) ||
					own(document, '_type') !== COLLECTION_ROUTE_TYPE ||
					own(document, 'site') !== site ||
					own(document, 'collection') !== collection.name ||
					typeof revision !== 'string' ||
					!revision.trim() ||
					!record(prefix) ||
					own(prefix, '_type') !== 'slug' ||
					!canonicalPrefix(pathname)
				)
					return {
						ok: false,
						reason: 'settings-invalid',
						collection: collection.name,
					}
				selected.push(
					Object.freeze({
						collection: collection.name,
						documentId: document._id as string,
						revision,
						prefix: pathname,
					}),
				)
				collections.push({ ...collection, routePrefix: pathname })
			}
			// The complete resolved set must pass the same overlap and ownership
			// configuration checks as code-fixed routes, not independent per-prefix checks.
			try {
				const routes = routeConfig(
					createPagesRegistry({ ...base, collections }),
				)
				return {
					ok: true,
					value: Object.freeze({
						routes,
						resolveUrl: createSanityUrlResolver(routes),
						settings: Object.freeze(selected),
					}),
				}
			} catch {
				return { ok: false, reason: 'routing-conflict' }
			}
		},
	})
}
