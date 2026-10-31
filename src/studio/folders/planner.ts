/**
 * Private, pure plans used by the additive folder writer and future removal UI.
 * Folder records
 * keep empty editor folders visible; page URLs still determine page placement.
 * A plan is not a mutation or proof that a later write is safe. See docs/folders.md.
 */
import {
	createPagesRegistry,
	pagePathname,
	pageSlug,
	storedPagePathname,
	type PagesRouteConfig,
} from '../../url/registry.js'

export const FOLDER_LIMITS = Object.freeze({
	folders: 1000,
	pathnameLength: 2048,
	registryBytes: 512000,
	inventoryDocuments: 10000,
})

export interface FolderRecord {
	readonly _key: string
	readonly pathname: string
}

export interface FolderRegistryData {
	readonly _id: string
	readonly _type: 'sanityKitFolderRegistry'
	readonly schemaVersion: 1
	readonly folders: readonly FolderRecord[]
}

export interface FolderInventory {
	readonly perspective: 'raw'
	readonly complete: boolean
	/** Caller attestation, never a permission check performed by this planner. */
	readonly readAccess: 'all-registered-versions' | 'unknown'
	readonly documents: readonly unknown[]
}

export interface FolderPlan {
	readonly operation: 'create' | 'update' | 'unchanged'
	readonly guard:
		| { readonly kind: 'absent' }
		| { readonly kind: 'revision'; readonly revision: string }
	/** Owned fields only; write.ts appends additions without replacing existing metadata. */
	readonly document: FolderRegistryData
	readonly added: readonly FolderRecord[]
	readonly removed: readonly FolderRecord[]
}

type FailureReason =
	| 'invalid-registry'
	| 'invalid-folder'
	| 'collection-group'
	| 'limit-exceeded'
	| 'invalid-key'
	| 'incomplete-inventory'
	| 'invalid-inventory'
	| 'folder-not-found'
	| 'folder-not-empty'

type Result<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly reason: FailureReason }

const failed = (reason: FailureReason): Result<never> => ({ ok: false, reason })
const record = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value)
const keyIsValid = (value: unknown): value is string =>
	typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(value)
const within = (path: string, folder: string) =>
	path === folder || path.startsWith(`${folder}/`)

/** Never clean persisted metadata implicitly, even when cleanup would be harmless. */
function canonicalPath(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		value.length <= FOLDER_LIMITS.pathnameLength &&
		pagePathname(value) === value &&
		(value === '/' || (!value.endsWith('/') && !value.includes('//')))
	)
}

function ancestors(pathname: string): string[] {
	const paths: string[] = []
	let path = pathname.slice(0, pathname.lastIndexOf('/'))
	while (path) {
		paths.push(path)
		path = path.slice(0, path.lastIndexOf('/'))
	}
	return paths.reverse()
}

function fieldValue(document: Record<string, unknown>, path: string): unknown {
	let value: unknown = document
	for (const part of path.split('.')) {
		if (!record(value) || !Object.hasOwn(value, part)) return undefined
		value = value[part]
	}
	return value
}

/**
 * One managed singleton serves the configured project/dataset. Configuration is
 * copied by the shared registry, so caller changes cannot alter an existing plan.
 * null means the caller established that the registry is absent; undefined does not.
 */
export function createFolderPlanner(options: {
	readonly routes: PagesRouteConfig
}) {
	const registry = createPagesRegistry(options.routes)
	const id = 'sanityKit.folders'
	// Collection groups live at the overview URL in today's navigator, which may
	// differ from the item prefix. Descendant ordinary folders remain permissible.
	const groups = new Set(
		registry.collections.map((item) => item.overview.pathname),
	)
	for (const collection of registry.collections)
		if (
			!canonicalPath(collection.overview.pathname) ||
			!canonicalPath(collection.routePrefix)
		)
			throw new Error('Folder planning needs canonical collection paths.')
	const empty: FolderRegistryData = {
		_id: id,
		_type: 'sanityKitFolderRegistry',
		schemaVersion: 1,
		folders: [],
	}
	const withinSize = (document: FolderRegistryData) =>
		new TextEncoder().encode(JSON.stringify(document)).byteLength <=
		FOLDER_LIMITS.registryBytes

	function validateRegistry(input: unknown): Result<{
		document: FolderRegistryData
		guard: FolderPlan['guard']
	}> {
		if (input === null)
			return {
				ok: true,
				value: {
					document: { ...empty, folders: [] },
					guard: { kind: 'absent' },
				},
			}
		if (
			!record(input) ||
			input._id !== id ||
			input._type !== empty._type ||
			input.schemaVersion !== 1 ||
			typeof input._rev !== 'string' ||
			!input._rev ||
			!Array.isArray(input.folders)
		)
			return failed('invalid-registry')
		if (input.folders.length > FOLDER_LIMITS.folders)
			return failed('limit-exceeded')
		const folders: FolderRecord[] = []
		const keys = new Set<string>(),
			paths = new Set<string>()
		for (const item of input.folders as unknown[]) {
			if (
				!record(item) ||
				!keyIsValid(item._key) ||
				!canonicalPath(item.pathname) ||
				item.pathname === '/' ||
				groups.has(item.pathname) ||
				keys.has(item._key) ||
				paths.has(item.pathname)
			)
				return failed('invalid-registry')
			keys.add(item._key)
			paths.add(item.pathname)
			folders.push({ _key: item._key, pathname: item.pathname })
		}
		// Every ordinary parent must be explicit; a collection group is a virtual
		// parent owned by route registration and is never duplicated as a folder.
		if (
			folders.some((item) =>
				ancestors(item.pathname).some(
					(path) => !paths.has(path) && !groups.has(path),
				),
			)
		)
			return failed('invalid-registry')
		if (!withinSize({ ...empty, folders })) return failed('limit-exceeded')
		return {
			ok: true,
			value: {
				document: { ...empty, folders },
				guard: { kind: 'revision', revision: input._rev },
			},
		}
	}

	function plan(
		current: { document: FolderRegistryData; guard: FolderPlan['guard'] },
		folders: FolderRecord[],
		added: FolderRecord[],
		removed: FolderRecord[],
	): Result<FolderPlan> {
		if (!withinSize({ ...current.document, folders }))
			return failed('limit-exceeded')
		return {
			ok: true,
			value: {
				operation:
					added.length || removed.length
						? current.guard.kind === 'absent'
							? 'create'
							: 'update'
						: 'unchanged',
				guard: { ...current.guard },
				document: { ...current.document, folders },
				added,
				removed,
			},
		}
	}

	function add(
		input: unknown,
		desired: readonly string[],
		createKey: () => string,
	): Result<FolderPlan> {
		const current = validateRegistry(input)
		if (!current.ok) return current
		const folders = [...current.value.document.folders]
		const existing = new Set(folders.map((folder) => folder.pathname))
		const missing = [...new Set(desired)].filter(
			(path) => !existing.has(path) && !groups.has(path),
		)
		if (folders.length + missing.length > FOLDER_LIMITS.folders)
			return failed('limit-exceeded')
		const keys = new Set(folders.map((folder) => folder._key)),
			added: FolderRecord[] = []
		for (const pathname of missing) {
			let key: unknown
			try {
				key = createKey()
			} catch {
				return failed('invalid-key')
			}
			if (!keyIsValid(key) || keys.has(key)) return failed('invalid-key')
			keys.add(key)
			added.push({ _key: key, pathname })
		}
		return plan(current.value, [...folders, ...added], added, [])
	}

	/** Creates missing ancestors and the selected folder; existing keys never change. */
	function planCreate(
		input: unknown,
		pathname: unknown,
		createKey: () => string,
	): Result<FolderPlan> {
		if (!canonicalPath(pathname) || pathname === '/')
			return failed('invalid-folder')
		if (groups.has(pathname)) return failed('collection-group')
		return add(input, [...ancestors(pathname), pathname], createKey)
	}

	function readInventory(
		input: FolderInventory,
	): Result<{ occupied: string[]; inferred: string[] }> {
		if (
			!input ||
			input.perspective !== 'raw' ||
			input.complete !== true ||
			input.readAccess !== 'all-registered-versions'
		)
			return failed('incomplete-inventory')
		if (!Array.isArray(input.documents)) return failed('invalid-inventory')
		if (input.documents.length > FOLDER_LIMITS.inventoryDocuments)
			return failed('limit-exceeded')
		const occupied: string[] = [],
			inferred = new Set<string>()
		const seen = new Set<string>()
		for (const document of input.documents) {
			if (!record(document) || typeof document._type !== 'string')
				return failed('invalid-inventory')
			const type = registry.types.find(
				(entry) => entry.schemaType === document._type,
			)
			if (!type) continue
			if (
				typeof document._id !== 'string' ||
				!document._id ||
				typeof document._rev !== 'string' ||
				!document._rev ||
				seen.has(document._id) ||
				(document._originalId !== undefined &&
					document._originalId !== document._id)
			)
				return failed('invalid-inventory')
			seen.add(document._id)
			const stored = fieldValue(document, type.pathField)
			if (stored === null || stored === undefined || stored === '') continue
			const slug = type.pathMode === 'slug' ? pageSlug(stored) : undefined
			if (type.pathMode === 'slug' && !slug) return failed('invalid-inventory')
			const pathname =
				type.pathMode === 'slug' ? `${type.routePrefix}/${slug}` : stored
			if (!canonicalPath(pathname)) return failed('invalid-inventory')
			// Even a page with disallowed ownership can make removal unsafe. Do not
			// hide it merely because the navigator cannot offer its preview URL.
			occupied.push(pathname)
			if (!type.collection && storedPagePathname(registry, type, stored)) {
				for (const parent of ancestors(pathname))
					if (!groups.has(parent)) inferred.add(parent)
				if (inferred.size > FOLDER_LIMITS.folders)
					return failed('limit-exceeded')
			}
		}
		// The navigator also infers ancestors of configured collection overviews,
		// including when no overview document exists yet.
		for (const group of groups)
			for (const parent of ancestors(group))
				if (!groups.has(parent)) inferred.add(parent)
		if (inferred.size > FOLDER_LIMITS.folders) return failed('limit-exceeded')
		return { ok: true, value: { occupied, inferred: [...inferred] } }
	}

	/** Explicit additive adoption: this never prunes a folder that has become empty. */
	function planSynchronize(
		input: unknown,
		inventory: FolderInventory,
		createKey: () => string,
	): Result<FolderPlan> {
		const evidence = readInventory(inventory)
		return evidence.ok
			? add(input, evidence.value.inferred, createKey)
			: evidence
	}

	/**
	 * Empty-only removal considers all supplied versions and saved descendants.
	 * Completeness/access are caller assertions, not permission or freshness proof.
	 * A future writer must recheck and coordinate writes; this plan is not race-proof.
	 */
	function planRemove(
		input: unknown,
		pathname: unknown,
		inventory: FolderInventory,
	): Result<FolderPlan> {
		if (!canonicalPath(pathname) || pathname === '/')
			return failed('invalid-folder')
		if (groups.has(pathname)) return failed('collection-group')
		const current = validateRegistry(input)
		if (!current.ok) return current
		const removed = current.value.document.folders.find(
			(folder) => folder.pathname === pathname,
		)
		if (!removed) return failed('folder-not-found')
		const evidence = readInventory(inventory)
		if (!evidence.ok) return evidence
		if (
			current.value.document.folders.some(
				(folder) =>
					folder.pathname !== pathname && within(folder.pathname, pathname),
			) ||
			[...groups].some((path) => within(path, pathname)) ||
			evidence.value.occupied.some((path) => within(path, pathname))
		)
			return failed('folder-not-empty')
		return plan(
			current.value,
			current.value.document.folders.filter(
				(folder) => folder.pathname !== pathname,
			),
			[],
			[removed],
		)
	}

	return Object.freeze({
		id,
		validateRegistry,
		planCreate,
		planSynchronize,
		planRemove,
	})
}
