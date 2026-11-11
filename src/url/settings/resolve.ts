/**
 * Pure bridge from separately loaded routing settings to the existing URL
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
export const MAX_COLLECTION_DISPLAY_NAME_LENGTH = 100

/** A default seeds a new settings draft; a locked value remains owned by code. */
export interface CollectionSettingValue {
	readonly mode: 'default' | 'locked'
	readonly value: string
}

/** Settings identity and field ownership are independent collection options. */
export interface SettingsCollectionDefinition extends Omit<
	PageCollectionDefinition,
	'routePrefix' | 'title'
> {
	/** Optional code label; the stable name is the final fallback. */
	readonly title?: string
	/** One explicit settings singleton, never inferred from an index page. */
	readonly settingsDocumentId?: string
	/** Omit to let editors supply the first prefix in the settings document. */
	readonly routePrefix?: string | CollectionSettingValue
	/** Studio label ownership is independent of URL-prefix ownership. */
	readonly displayName?: CollectionSettingValue
}

export interface CollectionRoutingConfig extends Omit<
	PagesRouteConfig,
	'collections'
> {
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

function validSetting(value: unknown): value is CollectionSettingValue {
	return (
		record(value) &&
		(own(value, 'mode') === 'default' || own(value, 'mode') === 'locked') &&
		typeof own(value, 'value') === 'string' &&
		Object.keys(value).every((key) => key === 'mode' || key === 'value')
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
		reservedPathPrefixes: registry.reservedPathPrefixes,
	})
}

/**
 * Snapshot app configuration once. Editable prefixes have no runtime fallback:
 * their default value only seeds Studio drafts. Locked prefixes never read a
 * document, even if Studio has an associated settings form. Temporary
 * setup-only prefixes let the existing registry validate every other setting;
 * those placeholders never escape into results or become document URLs.
 */
export function createCollectionRouting(config: CollectionRoutingConfig) {
	if (config.collections !== undefined && !Array.isArray(config.collections))
		throw new Error('collections must be an array.')
	const definitions: readonly SettingsCollectionDefinition[] =
		config.collections ?? []
	const bindings = new Map<string, string>()
	const settingsIds = new Set<string>()
	const fixedPrefixes: string[] = []
	for (const collection of definitions) {
		if (!collection) throw new Error('Invalid collection registration.')
		if (
			collection.displayName !== undefined &&
			(!validSetting(collection.displayName) ||
				!collection.displayName.value.trim() ||
				collection.displayName.value.length >
					MAX_COLLECTION_DISPLAY_NAME_LENGTH)
		)
			throw new Error(
				'Collection display names need a default or locked mode and a value between 1 and 100 characters.',
			)
		const prefix = collection.routePrefix
		if (typeof prefix === 'string') {
			if (!canonicalPrefix(prefix))
				throw new Error(
					'Collection routing needs canonical, non-root fixed prefixes.',
				)
			fixedPrefixes.push(prefix)
		} else if (prefix !== undefined) {
			if (!validSetting(prefix) || !canonicalPrefix(prefix.value))
				throw new Error(
					'Collection prefixes need a default or locked mode and a canonical, non-root value.',
				)
			if (prefix.mode === 'locked') fixedPrefixes.push(prefix.value)
		}
		const editablePrefix =
			prefix === undefined ||
			(typeof prefix !== 'string' && prefix.mode === 'default')
		const documentId = collection.settingsDocumentId
		if (documentId !== undefined) {
			if (
				typeof documentId !== 'string' ||
				!/^[A-Za-z0-9_][A-Za-z0-9_-]{0,120}$/u.test(documentId) ||
				['drafts', 'versions'].includes(documentId)
			)
				throw new Error(
					'Settings bindings need a non-dotted published document ID (1–121 characters).',
				)
			if (settingsIds.has(documentId))
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
			settingsIds.add(documentId)
		} else if (editablePrefix || collection.displayName?.mode === 'default') {
			throw new Error(
				'Editable collection settings require settingsDocumentId.',
			)
		}
		if (editablePrefix) bindings.set(collection.name, documentId!)
	}
	if (settingsIds.size > MAX_SETTINGS_COLLECTIONS)
		throw new Error(
			`At most ${MAX_SETTINGS_COLLECTIONS} settings-backed collections are supported.`,
		)
	let placeholderIndex = 0
	const usedPrefixes = [...fixedPrefixes]
	const temporary = definitions.map((definition) => {
		const collection = {
			...definition,
			title:
				definition.displayName?.value.trim() ??
				definition.title ??
				definition.name,
		}
		if (typeof collection.routePrefix === 'string')
			return { ...collection, routePrefix: collection.routePrefix }
		if (collection.routePrefix?.mode === 'locked')
			return { ...collection, routePrefix: collection.routePrefix.value }
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
			...(config.reservedPathPrefixes === undefined
				? {}
				: { reservedPathPrefixes: config.reservedPathPrefixes }),
		}),
	)
	const documentIds = Object.freeze([...bindings.values()])

	return Object.freeze({
		/** Editable-prefix IDs a loader must read; locked settings need no read. */
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
