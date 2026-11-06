/**
 * Review a folder rename without changing anything. Pages URLs remain the source
 * of placement; saved folder keys survive the rename. The output deliberately
 * describes URL-only changes rather than whole documents or executable mutations.
 * Permissions, fresh reads, transaction coordination and recovery belong to the
 * future writer. See docs/folders.md for those release gates.
 */
import {
	createPagesRegistry,
	pagePathname,
	pageSlug,
	storedPagePathname,
	type PagesRouteConfig,
	type RegisteredPageType,
} from '../../url/registry.js'
import { isReservedPath } from '../../url/reservations.js'
import { createFolderPlanner, FOLDER_LIMITS } from './planner.js'
import {
	planBulkRedirects,
	type BulkRedirectPlan,
	type BulkRedirectResult,
} from './rename-redirects.js'

export const FOLDER_RENAME_LIMITS = Object.freeze({
	pageVersions: 100,
	reviewBytes: 512000,
})
export interface FolderRenameRequest {
	readonly pathname: string
	/** Rename the last segment, not move the folder into a different parent. */
	readonly newName: string
	readonly registry: unknown
	readonly inventory: {
		readonly perspective: 'raw'
		readonly complete: boolean
		readonly readAccess: 'all-required-versions' | 'unknown'
		readonly documents: readonly unknown[]
		readonly redirects: readonly unknown[]
	}
	/** Caller attestation of document write eligibility, not proof of ACL or field readOnly. */
	readonly writableDocumentIds: readonly string[]
	/** The future adapter must separately evaluate conditional schema readOnly rules. */
	readonly protectedDocumentIds: readonly string[]
	readonly createRedirects: boolean
}
export interface FolderRenamePageChange {
	readonly id: string
	readonly revision: string
	readonly schemaType: string
	readonly pathField: string
	readonly oldPathname: string
	readonly newPathname: string
	readonly version: 'draft' | 'published'
}
export interface FolderRenamePlan {
	readonly oldPathname: string
	readonly newPathname: string
	readonly folderChanges: readonly {
		readonly key: string
		readonly oldPathname: string
		readonly newPathname: string
	}[]
	readonly pageChanges: readonly FolderRenamePageChange[]
	readonly redirects: BulkRedirectPlan
	/** Includes every read page/redirect version, even versions unchanged by the rename. */
	readonly reviewVersions: readonly {
		readonly id: string
		readonly revision: string
	}[]
	/** Required guards for changed existing records, including the folder registry. */
	readonly guards: readonly { readonly id: string; readonly revision: string }[]
	/** URL ownership after the plan, including all raw versions, for review/recheck. */
	readonly projectedUrls: readonly {
		readonly id: string
		readonly schemaType: string
		readonly pathname: string | null
	}[]
	/** Size of this review value; never the size of a future mutation/receipt request. */
	readonly reviewBytes: number
}
export type FolderRenameReason =
	| 'invalid-folder'
	| 'unchanged-name'
	| 'invalid-registry'
	| 'folder-not-found'
	| 'incomplete-inventory'
	| 'invalid-inventory'
	| 'collection-boundary'
	| 'destination-folder-exists'
	| 'reserved-path'
	| 'protected-url'
	| 'write-access-unverified'
	| 'release-version'
	| 'conflicting-draft-url'
	| 'url-collision'
	| 'limit-exceeded'
	| 'redirect-conflict'
export type FolderRenameResult =
	| { readonly ok: true; readonly value: FolderRenamePlan }
	| {
			readonly ok: false
			readonly reason: FolderRenameReason
			readonly documentId?: string
			readonly pathname?: string
			readonly redirect?: Extract<BulkRedirectResult, { ok: false }>
	  }
const record = (v: unknown): v is Record<string, unknown> =>
	v !== null && typeof v === 'object' && !Array.isArray(v)
const within = (path: string, prefix: string) =>
	path === prefix || path.startsWith(`${prefix}/`)
const canonical = (value: unknown): value is string =>
	typeof value === 'string' &&
	value.length <= FOLDER_LIMITS.pathnameLength &&
	pagePathname(value) === value &&
	(value === '/' || (!value.endsWith('/') && !value.includes('//')))
function field(document: Record<string, unknown>, path: string): unknown {
	let value: unknown = document
	for (const part of path.split('.')) {
		if (!record(value) || !Object.hasOwn(value, part)) return undefined
		value = value[part]
	}
	return value
}
function identity(id: unknown) {
	if (
		typeof id !== 'string' ||
		!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/u.test(id) ||
		id.includes('..') ||
		id.endsWith('.')
	)
		return
	const version = id.startsWith('drafts.')
		? 'draft'
		: id.startsWith('versions.')
			? 'release'
			: 'published'
	const parts = id.split('.')
	if (version === 'release' && parts.length < 3) return
	const base =
		version === 'draft'
			? id.slice(7)
			: version === 'release'
				? parts.slice(2).join('.')
				: id
	if (
		!base ||
		base.startsWith('-') ||
		base.startsWith('drafts.') ||
		base.split('.').includes('versions')
	)
		return
	return { id, base, version }
}
interface Row {
	id: string
	revision: string
	base: string
	version: string
	type: RegisteredPageType
	pathname: string | null
}

export function createFolderRenamePlanner({
	routes,
}: {
	readonly routes: PagesRouteConfig
}) {
	const registry = createPagesRegistry(routes)
	const folders = createFolderPlanner({ routes })
	const fail = (
		reason: FolderRenameReason,
		documentId?: string,
		pathname?: string,
	): FolderRenameResult => ({
		ok: false,
		reason,
		...(documentId ? { documentId } : {}),
		...(pathname ? { pathname } : {}),
	})
	return Object.freeze({
		plan(request: FolderRenameRequest): FolderRenameResult {
			const { pathname: oldPath, newName, inventory } = request
			if (
				!canonical(oldPath) ||
				oldPath === '/' ||
				typeof newName !== 'string' ||
				!newName ||
				pageSlug(newName) !== newName
			)
				return fail('invalid-folder')
			const newPath = oldPath.slice(0, oldPath.lastIndexOf('/') + 1) + newName
			if (!canonical(newPath)) return fail('invalid-folder')
			if (oldPath === newPath) return fail('unchanged-name')
			const saved = folders.validateRegistry(request.registry)
			if (!saved.ok || saved.value.guard.kind !== 'revision')
				return fail('invalid-registry')
			if (
				!saved.value.document.folders.some((item) => item.pathname === oldPath)
			)
				return fail('folder-not-found')
			// Collection routing belongs to a separate reviewed prefix operation. Even
			// empty collection locations cannot silently move with an ordinary folder.
			if (
				registry.collections.some((item) =>
					[item.index.pathname, item.routePrefix].some(
						(path) =>
							within(path, oldPath) ||
							within(path, newPath) ||
							within(oldPath, path) ||
							within(newPath, path),
					),
				)
			)
				return fail('collection-boundary')
			if (
				isReservedPath(
					newPath,
					registry.excludePaths,
					registry.reservedPathPrefixes,
				)
			)
				return fail('reserved-path', undefined, newPath)
			if (
				saved.value.document.folders.some((item) =>
					within(item.pathname, newPath),
				)
			)
				return fail('destination-folder-exists', undefined, newPath)
			if (
				!inventory ||
				inventory.perspective !== 'raw' ||
				inventory.complete !== true ||
				inventory.readAccess !== 'all-required-versions' ||
				!Array.isArray(inventory.documents) ||
				!Array.isArray(inventory.redirects)
			)
				return fail('incomplete-inventory')
			if (inventory.documents.length > FOLDER_LIMITS.inventoryDocuments)
				return fail('limit-exceeded')
			const seen = new Set<string>()
			const rows: Row[] = []
			for (const value of inventory.documents) {
				if (!record(value) || typeof value._type !== 'string')
					return fail('invalid-inventory')
				const type = registry.types.find(
					(item) => item.schemaType === value._type,
				)
				if (!type) continue
				const info = identity(value._id)
				if (
					!info ||
					typeof value._rev !== 'string' ||
					!value._rev ||
					seen.has(info.id) ||
					(value._originalId !== undefined && value._originalId !== info.id)
				)
					return fail('invalid-inventory')
				seen.add(info.id)
				const stored = field(value, type.pathField)
				const path =
					stored == null || stored === ''
						? null
						: type.pathMode === 'slug'
							? pageSlug(stored)
								? `${type.routePrefix}/${stored as string}`
								: undefined
							: stored
				if (path !== null && !canonical(path))
					return fail('invalid-inventory', info.id)
				rows.push({
					...info,
					revision: value._rev,
					type,
					pathname: path,
				})
			}
			const affectedBases = new Set(
				rows
					.filter(
						(row) => row.pathname !== null && within(row.pathname, oldPath),
					)
					.map((row) => row.base),
			)
			for (const base of affectedBases) {
				const versions = rows.filter((row) => row.base === base)
				const release = versions.find((row) => row.version === 'release')
				if (release) return fail('release-version', release.id)
				if (new Set(versions.map((row) => row.type.schemaType)).size !== 1)
					return fail('invalid-inventory', versions[0]!.id)
				const published = versions.find((row) => row.version === 'published'),
					draft = versions.find((row) => row.version === 'draft')
				if (published && draft && published.pathname !== draft.pathname)
					return fail('conflicting-draft-url', draft.id)
			}
			const pageChanges: FolderRenamePageChange[] = []
			for (const row of rows) {
				if (!row.pathname || !within(row.pathname, oldPath)) continue
				if (row.type.collection) return fail('collection-boundary', row.id)
				if (request.protectedDocumentIds.includes(row.id))
					return fail('protected-url', row.id)
				const destination = newPath + row.pathname.slice(oldPath.length)
				if (!canonical(destination))
					return fail('invalid-folder', row.id, destination)
				if (
					isReservedPath(
						row.pathname,
						registry.excludePaths,
						registry.reservedPathPrefixes,
					) ||
					isReservedPath(
						destination,
						registry.excludePaths,
						registry.reservedPathPrefixes,
					)
				)
					return fail('reserved-path', row.id, destination)
				if (!storedPagePathname(registry, row.type, destination))
					return fail('invalid-inventory', row.id)
				pageChanges.push({
					id: row.id,
					revision: row.revision,
					schemaType: row.type.schemaType,
					pathField: row.type.pathField,
					oldPathname: row.pathname,
					newPathname: destination,
					version: row.version as 'draft' | 'published',
				})
			}
			if (pageChanges.length > FOLDER_RENAME_LIMITS.pageVersions)
				return fail('limit-exceeded')
			const folderChanges = saved.value.document.folders
				.filter((item) => within(item.pathname, oldPath))
				.map((item) => ({
					key: item._key,
					oldPathname: item.pathname,
					newPathname: newPath + item.pathname.slice(oldPath.length),
				}))
			const proposedRegistry = {
				...saved.value.document,
				_rev: saved.value.guard.revision,
				folders: saved.value.document.folders.map((item) => ({
					...item,
					pathname:
						folderChanges.find((change) => change.key === item._key)
							?.newPathname ?? item.pathname,
				})),
			}
			if (!folders.validateRegistry(proposedRegistry).ok)
				return fail('invalid-registry')
			for (const folder of folderChanges)
				if (
					isReservedPath(
						folder.oldPathname,
						registry.excludePaths,
						registry.reservedPathPrefixes,
					) ||
					isReservedPath(
						folder.newPathname,
						registry.excludePaths,
						registry.reservedPathPrefixes,
					)
				)
					return fail('reserved-path', undefined, folder.newPathname)
			// Refuse merging with even an inferred destination folder. Draft-only pages
			// and release paths count here just as published pages do.
			const destinationOccupant = rows.find(
				(row) => row.pathname !== null && within(row.pathname, newPath),
			)
			if (destinationOccupant)
				return fail(
					'url-collision',
					destinationOccupant.id,
					destinationOccupant.pathname!,
				)
			const projectedUrls = rows.map((row) => ({
				id: row.id,
				schemaType: row.type.schemaType,
				pathname:
					pageChanges.find((change) => change.id === row.id)?.newPathname ??
					row.pathname,
			}))
			const projectedById = new Map(
				projectedUrls.map((row) => [row.id, row.pathname]),
			)
			const owners = new Map<string, string>()
			for (const row of rows) {
				const path = projectedById.get(row.id)!
				if (path === null) continue
				const owner = owners.get(path)
				if (owner && owner !== row.base)
					return fail('url-collision', row.id, path)
				owners.set(path, row.base)
			}
			const before = rows
				.filter((row) => row.version === 'published' && row.pathname !== null)
				.map((row) => row.pathname!)
			const after = rows
				.filter((row) => row.version === 'published')
				.flatMap((row) => {
					const path = projectedById.get(row.id)!
					return path === null ? [] : [path]
				})
			const redirect = planBulkRedirects({
				moves: pageChanges.filter((row) => row.version === 'published'),
				draftDestinations: pageChanges
					.filter((row) => row.version === 'draft')
					.map((row) => row.newPathname),
				createRedirects: request.createRedirects,
				inventory: {
					perspective: 'raw',
					complete: true,
					records: inventory.redirects,
				},
				occupiedPathsBefore: before,
				occupiedPathsAfter: after,
				// App-owned destinations need not be registered CMS pages. Like the
				// single-page review, validate graph safety without claiming they exist.
				destinationsBefore: 'unverified',
				destinationsAfter: 'unverified',
				reservedPaths: registry.excludePaths,
				reservedPathPrefixes: registry.reservedPathPrefixes,
			})
			if (!redirect.ok)
				return { ok: false, reason: 'redirect-conflict', redirect }
			const guards = [
				{ id: saved.value.document._id, revision: saved.value.guard.revision },
				...pageChanges.map(({ id, revision }) => ({ id, revision })),
				...redirect.value.updates.map(({ id, revision }) => ({ id, revision })),
			]
			for (const guard of guards) {
				if (request.protectedDocumentIds.includes(guard.id))
					return fail('protected-url', guard.id)
				if (!request.writableDocumentIds.includes(guard.id))
					return fail('write-access-unverified', guard.id)
			}
			// New redirect permission cannot be represented by a saved ID. The future
			// adapter must additionally check create permission for each proposed record.
			const reviewVersions = [
				...rows.map(({ id, revision }) => ({ id, revision })),
				...inventory.redirects.map((value) => ({
					id: (value as { _id: string })._id,
					revision: (value as { _rev: string })._rev,
				})),
				{ id: saved.value.document._id, revision: saved.value.guard.revision },
			]
			if (
				new Set(reviewVersions.map((row) => row.id)).size !==
				reviewVersions.length
			)
				return fail('invalid-inventory')
			const value = {
				oldPathname: oldPath,
				newPathname: newPath,
				folderChanges,
				pageChanges,
				redirects: redirect.value,
				guards,
				reviewVersions,
				projectedUrls,
			}
			const reviewBytes = new TextEncoder().encode(
				JSON.stringify(value),
			).byteLength
			if (reviewBytes > FOLDER_RENAME_LIMITS.reviewBytes)
				return fail('limit-exceeded')
			return { ok: true, value: { ...value, reviewBytes } }
		},
	})
}
