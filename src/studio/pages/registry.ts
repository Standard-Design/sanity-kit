/**
 * One description of the app's page URLs, shared by the Pages browser and native
 * Presentation resolvers. This keeps their type lists and URL rules in agreement.
 * The app still owns its schemas and frontend routes; this module writes nothing.
 *
 * Start with docs/pages.md for the architecture and navigation flow. The exact
 * internal configuration is in tests/fixtures/pages-studio/ROUTING.md. Consumers
 * pass these definitions to pagesTool(); these helpers remain private. This is
 * not the frontend's React Router registry.
 */
import { stegaClean } from '@sanity/client/stega'

export interface PageTypeDefinition {
	readonly schemaType: string
	/** A string field containing the complete root-relative URL, not just a slug. */
	readonly pathnameField: string
	readonly slugField?: never
	/** Used for location-link text, not a replacement for the schema's preview. */
	readonly titleField?: string
}

/** A collection can store its full path or just one segment, never both. */
export type PageCollectionItemDefinition =
	| PageTypeDefinition
	| {
			readonly schemaType: string
			/** A string field such as slug.current; the collection supplies the prefix. */
			readonly slugField: string
			readonly pathnameField?: never
			readonly titleField?: string
	  }

export interface PageCollectionDefinition {
	/** Stable configuration identity, independent of the visible title. */
	readonly name: string
	readonly title: string
	/** Plural item label, e.g. “Posts” or “People”; defaults to the collection title. */
	readonly itemsTitle?: string
	/** An existing ordinary page is the collection's overview, not a second item. */
	readonly overview: { readonly schemaType: string; readonly pathname: string }
	/** Bounds full-path items; also supplies the locked prefix for slug-only items. */
	readonly routePrefix: string
	/** A schema type belongs to exactly one collection, or to ordinary pages. */
	readonly items: readonly PageCollectionItemDefinition[]
}

export interface PagesRouteConfig {
	readonly pages: readonly PageTypeDefinition[]
	readonly collections?: readonly PageCollectionDefinition[]
	/** Exact app-owned paths, e.g. ['/']. Documents stay editable without a preview. */
	readonly excludePaths?: readonly string[]
}

/** Checked internal mapping. pathField always names the actual stored string. */
export interface RegisteredPageType {
	readonly schemaType: string
	readonly pathField: string
	readonly pathMode: 'pathname' | 'slug'
	readonly routePrefix?: string
	readonly titleField: string
	readonly collection?: string
}

export interface PagesRegistry {
	readonly types: readonly RegisteredPageType[]
	readonly collections: readonly PageCollectionDefinition[]
	readonly excludePaths: readonly string[]
}

const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/u
const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor'])

// Check JavaScript callers too, without narrowing typed readonly arrays to any[].
function isArray(value: unknown): boolean {
	return Array.isArray(value)
}

/**
 * Fields become GROQ syntax, unlike document values, which become parameters.
 * Limit them to dotted object fields: no expressions, arrays, or dereferences.
 */
export function assertFieldPath(value: string, label: string): void {
	if (
		typeof value !== 'string' ||
		!value
			.split('.')
			.every((part) => identifier.test(part) && !forbiddenKeys.has(part))
	)
		throw new Error(
			`${label} must be a dotted field path, such as pathname.current.`,
		)
}

/**
 * Keep valid authored URLs unchanged. Silently fixing a URL here could send the
 * iframe somewhere different from the app's exact route lookup. The existing
 * link helper has a looser, private validator, so we do not import its renderer.
 */
export function pagePathname(value: unknown): string | undefined {
	if (typeof value === 'string') value = stegaClean(value)
	if (
		typeof value !== 'string' ||
		!value.startsWith('/') ||
		value.startsWith('//')
	)
		return undefined
	if (
		/[\\\s?#]/u.test(value) ||
		[...value].some((character) => {
			const code = character.charCodeAt(0)
			return code < 32 || code === 127
		})
	)
		return undefined
	try {
		const parsed = new URL(value, 'https://pages.invalid')
		if (parsed.origin !== 'https://pages.invalid' || parsed.pathname !== value)
			return undefined
		// Encoded separators and controls are interpreted differently by routers.
		const decoded = decodeURIComponent(value)
		if (
			/%(?:2f|5c)/iu.test(value) ||
			[...decoded].some((character) => {
				const code = character.charCodeAt(0)
				return code < 32 || code === 127
			})
		)
			return undefined
		return value
	} catch {
		return undefined
	}
}

function requiredPath(value: string, label: string): string {
	const path = pagePathname(value)
	if (!path)
		throw new Error(
			`${label} must be a valid root-relative pathname without a query or hash.`,
		)
	return path
}

function descendantOf(path: string, prefix: string): boolean {
	return path.startsWith(`${prefix}/`) && path.length > prefix.length + 1
}

/** Slugs are one exact segment. Read-time routing never trims or slugifies them. */
export function pageSlug(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined
	const slug = stegaClean(value)
	return slug && !slug.includes('/') && pagePathname(`/${slug}`)
		? slug
		: undefined
}

/** Convert a stored value into a full path, then apply the shared ownership rules. */
export function storedPagePathname(
	registry: PagesRegistry,
	type: RegisteredPageType,
	value: unknown,
) {
	if (type.pathMode === 'slug') {
		const slug = pageSlug(value)
		return slug
			? registeredPathname(
					registry,
					type.schemaType,
					`${type.routePrefix}/${slug}`,
				)
			: undefined
	}
	return registeredPathname(registry, type.schemaType, value)
}

/**
 * Check the app's configuration once and copy it so later caller changes cannot
 * silently change routing. pagesTool() creates this once and shares it with the
 * browser model and native resolver setup.
 *
 * This checks definitions, not stored documents. validatePagesSchema() separately
 * checks that the configured fields exist; neither check creates an overview or
 * proves that every document already has a usable, unique URL.
 */
export function createPagesRegistry(config: PagesRouteConfig): PagesRegistry {
	if (!isArray(config.pages) || !config.pages.length)
		throw new Error('pages must register at least one document type.')
	if (config.collections !== undefined && !isArray(config.collections))
		throw new Error('collections must be an array.')
	if (config.excludePaths !== undefined && !isArray(config.excludePaths))
		throw new Error('excludePaths must be an array.')
	const types: RegisteredPageType[] = []
	const register = (
		definition: PageCollectionItemDefinition,
		collection?: string,
		routePrefix?: string,
	) => {
		if (
			!definition ||
			typeof definition.schemaType !== 'string' ||
			!identifier.test(definition.schemaType) ||
			forbiddenKeys.has(definition.schemaType)
		)
			throw new Error('schemaType must be a non-empty schema identifier.')
		if (types.some((type) => type.schemaType === definition.schemaType))
			throw new Error(
				`Document type "${definition.schemaType}" is registered more than once. A type cannot belong to both pages and a collection, or to multiple collections.`,
			)
		const slugOnly = definition.slugField !== undefined
		if (
			slugOnly &&
			(collection === undefined || definition.pathnameField !== undefined)
		)
			throw new Error(
				'slugField is only supported for collection items and cannot be combined with pathnameField.',
			)
		const pathField = slugOnly ? definition.slugField : definition.pathnameField
		assertFieldPath(
			pathField,
			`${definition.schemaType}.${slugOnly ? 'slugField' : 'pathnameField'}`,
		)
		if (slugOnly && (!routePrefix || routePrefix.includes('//')))
			throw new Error(
				'Slug-only collections need a routePrefix without repeated slashes.',
			)
		const titleField = definition.titleField ?? 'title'
		assertFieldPath(titleField, `${definition.schemaType}.titleField`)
		const type: RegisteredPageType = Object.freeze({
			schemaType: definition.schemaType,
			pathField,
			pathMode: slugOnly ? 'slug' : 'pathname',
			...(slugOnly ? { routePrefix: routePrefix! } : {}),
			titleField,
			...(collection === undefined ? {} : { collection }),
		})
		types.push(type)
		return type
	}
	config.pages.forEach((page) => register(page))
	const excludePaths = Object.freeze([
		...new Set(
			(config.excludePaths ?? []).map((path) =>
				requiredPath(path, 'excludePaths entry'),
			),
		),
	])
	const collections: PageCollectionDefinition[] = []
	for (const collection of config.collections ?? []) {
		if (
			!collection ||
			typeof collection.name !== 'string' ||
			!/^[A-Za-z][A-Za-z0-9_-]*$/u.test(collection.name) ||
			forbiddenKeys.has(collection.name)
		)
			throw new Error(
				'A collection name must be a stable identifier containing letters, numbers, hyphens, or underscores.',
			)
		if (collections.some(({ name }) => name === collection.name))
			throw new Error(`Duplicate collection name "${collection.name}".`)
		if (typeof collection.title !== 'string' || !collection.title.trim())
			throw new Error(`Collection "${collection.name}" needs a title.`)
		if (
			collection.itemsTitle !== undefined &&
			(typeof collection.itemsTitle !== 'string' ||
				!collection.itemsTitle.trim())
		)
			throw new Error(
				`Collection "${collection.name}" needs a non-empty itemsTitle.`,
			)
		const overview = collection.overview
		if (
			!overview ||
			!types.some(
				(type) =>
					type.schemaType === overview.schemaType &&
					type.collection === undefined,
			)
		)
			throw new Error(
				`Collection "${collection.name}" must use a registered ordinary page type for its overview.`,
			)
		const pathname = requiredPath(
			overview.pathname,
			`${collection.name}.overview.pathname`,
		)
		if (excludePaths.includes(pathname))
			throw new Error(
				`Collection "${collection.name}" cannot use an excluded overview path.`,
			)
		if (collections.some((item) => item.overview.pathname === pathname))
			throw new Error(
				`Multiple collections claim the overview path "${pathname}".`,
			)
		const routePrefix = requiredPath(
			collection.routePrefix,
			`${collection.name}.routePrefix`,
		)
		if (routePrefix === '/' || routePrefix.endsWith('/'))
			throw new Error(
				`Collection "${collection.name}" needs a non-root routePrefix without a trailing slash.`,
			)
		if (
			collections.some(
				(item) =>
					item.routePrefix === routePrefix ||
					descendantOf(item.routePrefix, routePrefix) ||
					descendantOf(routePrefix, item.routePrefix),
			)
		)
			throw new Error(
				`Collection "${collection.name}" has an overlapping routePrefix.`,
			)
		if (!isArray(collection.items) || !collection.items.length)
			throw new Error(
				`Collection "${collection.name}" needs at least one item type.`,
			)
		const items = Object.freeze(
			collection.items.map((item) => {
				const type = register(item, collection.name, routePrefix)
				return Object.freeze({
					schemaType: type.schemaType,
					titleField: type.titleField,
					...(type.pathMode === 'slug'
						? { slugField: type.pathField }
						: { pathnameField: type.pathField }),
				})
			}),
		)
		collections.push(
			Object.freeze({
				name: collection.name,
				title: collection.title,
				...(collection.itemsTitle === undefined
					? {}
					: { itemsTitle: collection.itemsTitle }),
				overview: Object.freeze({ schemaType: overview.schemaType, pathname }),
				routePrefix,
				items,
			}),
		)
	}
	return Object.freeze({
		types: Object.freeze(types),
		collections: Object.freeze(collections),
		excludePaths,
	})
}

/**
 * Decide whether this type may use this complete pathname. Both browser clicks
 * and native location links use this check; reverse lookup uses it to decide
 * which types to query. It does not join a prefix to a slug or check the dataset
 * for duplicate URLs. Those are different jobs.
 *
 * undefined means "no preview URL", not "hide this document". The browser can
 * still open its native editor while leaving the previous page in the iframe.
 */
export function registeredPathname(
	registry: PagesRegistry,
	schemaType: string,
	value: unknown,
): string | undefined {
	const type = registry.types.find((entry) => entry.schemaType === schemaType)
	const path = pagePathname(value)
	if (!type || !path || registry.excludePaths.includes(path)) return undefined
	const owner = registry.collections.find(
		(collection) => collection.overview.pathname === path,
	)
	if (
		owner &&
		(type.collection !== undefined || owner.overview.schemaType !== schemaType)
	)
		return undefined
	if (type.collection !== undefined) {
		const collection = registry.collections.find(
			(entry) => entry.name === type.collection,
		)
		if (!collection || !descendantOf(path, collection.routePrefix))
			return undefined
		if (
			type.pathMode === 'slug' &&
			!pageSlug(path.slice(collection.routePrefix.length + 1))
		)
			return undefined
	}
	return path
}

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object'
}

/**
 * Run against Studio's compiled schema, not the app's raw defineType objects.
 * The small structural interface keeps this module free of Studio runtime imports.
 */
export function validatePagesSchema(
	registry: PagesRegistry,
	schema: { get(name: string): unknown },
): void {
	for (const route of registry.types) {
		const definition = schema.get(route.schemaType)
		if (
			!record(definition) ||
			!record(definition.type) ||
			definition.type.name !== 'document'
		)
			throw new Error(
				`Pages type "${route.schemaType}" must be a document in the Studio schema.`,
			)
		for (const fieldPath of [route.pathField, route.titleField]) {
			let current: unknown = definition
			for (const part of fieldPath.split('.')) {
				if (
					!record(current) ||
					current.jsonType !== 'object' ||
					!Array.isArray(current.fields)
				) {
					current = undefined
					break
				}
				const fields: unknown[] = current.fields
				const field = fields.find(
					(entry) => record(entry) && entry.name === part,
				)
				current = record(field) ? field.type : undefined
			}
			if (!record(current) || current.jsonType !== 'string')
				throw new Error(
					`Pages field "${route.schemaType}.${fieldPath}" must resolve to a string through object fields.`,
				)
		}
	}
}
