/**
 * Review a collection-prefix change without publishing anything. Items retain
 * their own slugs; the proposed settings prefix changes their resolved URLs.
 * Existing aliases follow live pages even when new redirects are declined.
 *
 * Read coverage is an explicit caller assertion, not proof of permissions. The
 * read-only service in prefix-review.ts supplies fresh, bounded evidence. Neither
 * module grants write permission or enables the settings Publish action.
 * @see docs/collection-prefix-publication.md
 */
import { isReservedPath } from '../../url/reservations.js'
import { createPagesRegistry } from '../../url/registry.js'
import {
	createCollectionRouting,
	type CollectionRoutingConfig,
} from '../../url/settings/resolve.js'
import {
	planBulkRedirects,
	type BulkRedirectPlan,
	type BulkRedirectResult,
} from '../folders/rename-redirects.js'

export const COLLECTION_PREFIX_LIMITS = Object.freeze({
	pageVersions: 10000,
	settingsVersions: 1000,
	affectedVersions: 100,
	inventoryBytes: 2_000_000,
	reviewBytes: 512000,
})
export interface CollectionPrefixChoice {
	readonly collection: string
	readonly publishedRevision: string
	readonly draftRevision: string
	readonly createRedirects: boolean
}
export interface CollectionPrefixInventory {
	readonly perspective: 'raw'
	readonly complete: boolean
	readonly readAccess: 'all-required-versions' | 'unknown'
	readonly settings: readonly unknown[]
	readonly documents: readonly unknown[]
	readonly redirects: readonly unknown[]
}
export interface CollectionPrefixPlan {
	readonly settings: {
		readonly collection: string
		readonly documentId: string
		readonly publishedRevision: string
		readonly draftRevision: string
		readonly oldPrefix: string
		readonly newPrefix: string
	}
	/** Only published items produce live URL moves and optional new redirects. */
	readonly liveChanges: readonly {
		readonly id: string
		readonly revision: string
		readonly schemaType: string
		readonly title: string
		readonly oldPathname: string
		readonly newPathname: string
	}[]
	/** Draft URLs are checked, but those documents are never published here. */
	readonly draftUrls: readonly {
		readonly id: string
		readonly pathname: string | null
	}[]
	readonly redirects: BulkRedirectPlan
	/** Every observed version, including unchanged dependencies, must be rechecked. */
	readonly reviewVersions: readonly {
		readonly id: string
		readonly revision: string
	}[]
	/** Review bytes are not a prediction of a future transaction/receipt size. */
	readonly reviewBytes: number
}
export type CollectionPrefixReason =
	| 'unknown-collection'
	| 'locked-prefix'
	| 'invalid-choice'
	| 'incomplete-inventory'
	| 'invalid-inventory'
	| 'limit-exceeded'
	| 'first-publication-unsupported'
	| 'missing-draft'
	| 'review-stale'
	| 'settings-unavailable'
	| 'routing-conflict'
	| 'unchanged-prefix'
	| 'reserved-prefix'
	| 'release-version'
	| 'invalid-url'
	| 'url-collision'
	| 'redirect-conflict'
export type CollectionPrefixPlanResult =
	| { readonly ok: true; readonly value: CollectionPrefixPlan }
	| {
			readonly ok: false
			readonly reason: CollectionPrefixReason
			readonly documentId?: string
			readonly conflictingDocumentId?: string
			readonly pathname?: string
			readonly detail?: string
			readonly redirect?: Extract<BulkRedirectResult, { ok: false }>
	  }
const record = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value)

/** Keep raw identities; never collapse a draft or release over its live version. */
export function prefixVersionIdentity(id: unknown) {
	if (
		typeof id !== 'string' ||
		!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/u.test(id) ||
		id.includes('..') ||
		id.endsWith('.')
	)
		return
	const parts = id.split('.')
	const version =
		parts[0] === 'drafts'
			? 'draft'
			: parts[0] === 'versions'
				? 'release'
				: 'published'
	const base =
		version === 'draft'
			? parts.slice(1)
			: version === 'release'
				? parts.slice(2)
				: parts
	if (
		!base.length ||
		base.some((part) => part === 'drafts' || part === 'versions') ||
		base[0]!.startsWith('-')
	)
		return
	return { id, base: base.join('.'), version }
}
function readField(document: Record<string, unknown>, path: string): unknown {
	return path
		.split('.')
		.reduce<unknown>(
			(value, part) =>
				record(value) && Object.hasOwn(value, part) ? value[part] : undefined,
			document,
		)
}
function freeze<T>(value: T): T {
	if (value && typeof value === 'object') {
		for (const child of Object.values(value)) freeze(child)
		Object.freeze(value)
	}
	return value
}

export function createCollectionPrefixPlanner(
	configuration: CollectionRoutingConfig,
) {
	const config = structuredClone(configuration)
	const routing = createCollectionRouting(config)
	const settingsIds = new Set(routing.documentIds)
	const fail = (
		reason: CollectionPrefixReason,
		detail?: string,
	): CollectionPrefixPlanResult => ({
		ok: false,
		reason,
		...(detail ? { detail } : {}),
	})
	return Object.freeze({
		plan(
			choice: CollectionPrefixChoice,
			inventory: CollectionPrefixInventory,
		): CollectionPrefixPlanResult {
			if (
				!record(choice) ||
				typeof choice.collection !== 'string' ||
				typeof choice.publishedRevision !== 'string' ||
				typeof choice.draftRevision !== 'string'
			)
				return fail('invalid-choice')
			const collection = config.collections?.find(
				(item) => item.name === choice.collection,
			)
			if (!collection) return fail('unknown-collection')
			if (
				typeof collection.routePrefix === 'string' ||
				collection.routePrefix?.mode === 'locked' ||
				!collection.settingsDocumentId
			)
				return fail('locked-prefix')
			if (
				!choice.publishedRevision?.trim() ||
				!choice.draftRevision?.trim() ||
				typeof choice.createRedirects !== 'boolean'
			)
				return fail('invalid-choice')
			if (
				!inventory ||
				inventory.perspective !== 'raw' ||
				inventory.complete !== true ||
				inventory.readAccess !== 'all-required-versions' ||
				!Array.isArray(inventory.settings) ||
				!Array.isArray(inventory.documents) ||
				!Array.isArray(inventory.redirects)
			)
				return fail('incomplete-inventory')
			if (
				inventory.documents.length > COLLECTION_PREFIX_LIMITS.pageVersions ||
				inventory.settings.length > COLLECTION_PREFIX_LIMITS.settingsVersions
			)
				return fail('limit-exceeded')
			try {
				if (
					new TextEncoder().encode(JSON.stringify(inventory)).byteLength >
					COLLECTION_PREFIX_LIMITS.inventoryBytes
				)
					return fail('limit-exceeded')
			} catch {
				return fail('invalid-inventory')
			}
			const seen = new Set<string>()
			const revisions: { id: string; revision: string }[] = []
			for (const row of [
				...(inventory.settings as readonly unknown[]),
				...(inventory.documents as readonly unknown[]),
				...(inventory.redirects as readonly unknown[]),
			]) {
				if (!record(row)) return fail('invalid-inventory')
				const identity = prefixVersionIdentity(row._id)
				if (
					!identity ||
					seen.has(identity.id) ||
					typeof row._type !== 'string' ||
					typeof row._rev !== 'string' ||
					!row._rev.trim() ||
					(row._originalId !== undefined && row._originalId !== identity.id)
				)
					return fail('invalid-inventory')
				seen.add(identity.id)
				revisions.push({ id: identity.id, revision: row._rev })
			}
			for (const value of inventory.settings) {
				const row = value as Record<string, unknown>
				const identity = prefixVersionIdentity(row._id)!
				if (!settingsIds.has(identity.base)) return fail('invalid-inventory')
				// Release-specific routing has no supported resolver yet. Do not guess
				// that a planned settings version is harmless because its slug is equal.
				if (identity.version === 'release')
					return {
						ok: false,
						reason: 'release-version',
						documentId: identity.id,
					}
			}
			const id = collection.settingsDocumentId
			const published = inventory.settings.find(
				(value) => (value as Record<string, unknown>)._id === id,
			) as Record<string, unknown> | undefined
			const draft = inventory.settings.find(
				(value) => (value as Record<string, unknown>)._id === `drafts.${id}`,
			) as Record<string, unknown> | undefined
			if (!published) return fail('first-publication-unsupported')
			if (!draft) return fail('missing-draft')
			if (
				published._rev !== choice.publishedRevision ||
				draft._rev !== choice.draftRevision
			)
				return fail('review-stale')
			const envelope = (documents: readonly unknown[]) => ({
				status: 'available',
				perspective: 'raw',
				coverage: 'published-and-drafts',
				complete: true,
				documents,
			})
			const current = routing.resolve(envelope(inventory.settings), 'published')
			const preview = routing.resolve(envelope(inventory.settings), 'drafts')
			// Promote only this settings draft in a temporary read model. All other
			// settings, item slugs and independent page paths remain untouched.
			const projectedSettings = inventory.settings.map((value: unknown) =>
				value === published
					? {
							...draft,
							_id: id,
							...(draft._originalId === undefined ? {} : { _originalId: id }),
						}
					: value,
			)
			const proposed = routing.resolve(envelope(projectedSettings), 'published')
			for (const result of [current, preview, proposed])
				if (!result.ok)
					return fail(
						result.reason === 'routing-conflict'
							? 'routing-conflict'
							: 'settings-unavailable',
						result.reason,
					)
			if (!current.ok || !preview.ok || !proposed.ok)
				return fail('settings-unavailable')
			const oldPrefix = current.value.routes.collections!.find(
				(item) => item.name === collection.name,
			)!.routePrefix
			const newPrefix = proposed.value.routes.collections!.find(
				(item) => item.name === collection.name,
			)!.routePrefix
			if (oldPrefix === newPrefix) return fail('unchanged-prefix')
			if (
				isReservedPath(
					newPrefix,
					config.excludePaths,
					config.reservedPathPrefixes,
				)
			)
				return { ok: false, reason: 'reserved-prefix', pathname: newPrefix }
			const registry = createPagesRegistry(current.value.routes)
			const rows: {
				id: string
				base: string
				version: string
				revision: string
				schemaType: string
				title: string
				target: boolean
				paths: readonly (string | null)[]
			}[] = []
			for (const value of inventory.documents) {
				const row = value as Record<string, unknown>,
					identity = prefixVersionIdentity(row._id)!
				const type = registry.types.find(
					(item) => item.schemaType === row._type,
				)
				if (!type) return fail('invalid-inventory')
				const target = type.collection === collection.name
				if (target && identity.version === 'release')
					return {
						ok: false,
						reason: 'release-version',
						documentId: identity.id,
					}
				const paths: (string | null)[] = []
				for (const context of [current, preview, proposed]) {
					const result = context.value.resolveUrl(row)
					if (!result.ok && result.reason !== 'missing-value')
						return {
							ok: false,
							reason: 'invalid-url',
							documentId: identity.id,
							detail: result.reason,
						}
					paths.push(result.ok ? result.value.pathname : null)
				}
				const title = readField(row, type.titleField)
				rows.push({
					...identity,
					revision: row._rev as string,
					schemaType: type.schemaType,
					title: typeof title === 'string' ? title : 'Untitled',
					target,
					paths,
				})
			}
			const identityTypes = new Map<string, string>()
			for (const row of rows) {
				const previous = identityTypes.get(row.base)
				if (previous && previous !== row.schemaType)
					return { ok: false, reason: 'invalid-inventory', documentId: row.id }
				identityTypes.set(row.base, row.schemaType)
			}
			const affected = rows.filter((row) => row.target)
			if (affected.length > COLLECTION_PREFIX_LIMITS.affectedVersions)
				return fail('limit-exceeded')
			// Reserve every version in each current/projected routing context. Two
			// pending prefix changes cannot assume that the other publishes first.
			const owners = new Map<string, (typeof rows)[number]>()
			for (const row of rows)
				for (const path of row.paths) {
					if (path === null) continue
					const owner = owners.get(path)
					if (owner && owner.base !== row.base)
						return {
							ok: false,
							reason: 'url-collision',
							documentId: row.id,
							conflictingDocumentId: owner.id,
							pathname: path,
						}
					owners.set(path, row)
				}
			const liveChanges = affected
				.filter((row) => row.version === 'published' && row.paths[0] !== null)
				.map((row) => ({
					id: row.id,
					revision: row.revision,
					schemaType: row.schemaType,
					title: row.title,
					oldPathname: row.paths[0]!,
					newPathname: row.paths[2]!,
				}))
			const redirect = planBulkRedirects({
				moves: liveChanges,
				draftDestinations: [
					...new Set(
						rows.flatMap((row) =>
							row.paths
								.slice(1)
								.filter((path): path is string => path !== null),
						),
					),
				],
				createRedirects: choice.createRedirects,
				inventory: {
					perspective: 'raw',
					complete: true,
					records: inventory.redirects,
				},
				occupiedPathsBefore: rows
					.filter((row) => row.version === 'published')
					.flatMap((row) => (row.paths[0] === null ? [] : [row.paths[0]!])),
				occupiedPathsAfter: rows
					.filter((row) => row.version === 'published')
					.flatMap((row) => (row.paths[2] === null ? [] : [row.paths[2]!])),
				destinationsBefore: 'unverified',
				destinationsAfter: 'unverified',
				reservedPaths: registry.excludePaths,
				reservedPathPrefixes: registry.reservedPathPrefixes,
			})
			if (!redirect.ok)
				return { ok: false, reason: 'redirect-conflict', redirect }
			const value = {
				settings: {
					collection: collection.name,
					documentId: id,
					publishedRevision: choice.publishedRevision,
					draftRevision: choice.draftRevision,
					oldPrefix,
					newPrefix,
				},
				liveChanges,
				draftUrls: affected
					.filter((row) => row.version === 'draft')
					.map((row) => ({ id: row.id, pathname: row.paths[1]! })),
				redirects: redirect.value,
				reviewVersions: revisions.sort((a, b) => a.id.localeCompare(b.id)),
			}
			const reviewBytes = new TextEncoder().encode(
				JSON.stringify(value),
			).byteLength
			if (reviewBytes > COLLECTION_PREFIX_LIMITS.reviewBytes)
				return fail('limit-exceeded')
			return { ok: true, value: freeze({ ...value, reviewBytes }) }
		},
	})
}
