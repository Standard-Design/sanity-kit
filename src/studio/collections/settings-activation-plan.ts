/**
 * Review the URLs made available by a collection's first settings publication.
 * There is no old live prefix to redirect, and this plan never changes items.
 * It neither writes nor proves permissions or freshness. A future reader and
 * publisher must establish complete visibility and recheck this evidence.
 *
 * Collections with no settings in a perspective are explicitly inactive in this
 * review only. Loaded drafts still reserve preview URLs. This avoids a setup
 * deadlock between new collections without inventing defaults or weakening the
 * frontend resolver's requirement for a complete routing context.
 */
import {
	createCollectionRouting,
	type CollectionRoutingConfig,
} from '../../url/settings/resolve.js'
import { isReservedPath } from '../../url/reservations.js'
import { REDIRECT_MAX_RECORDS } from '../../redirect/snapshot.js'
import {
	planBulkRedirects,
	type BulkRedirectResult,
} from '../folders/rename-redirects.js'
import {
	COLLECTION_PREFIX_LIMITS,
	prefixVersionIdentity,
	type CollectionPrefixInventory,
} from './prefix-plan.js'
import {
	createCollectionSettingsPublicationClassifier,
	type CollectionSettingsPublicationClassificationResult,
} from './settings-publication-plan.js'
import { createCollectionPrefixReadRequirements } from './prefix-access.js'

export interface CollectionSettingsActivationChoice {
	readonly collection: string
	readonly draftRevision: string
}

export interface CollectionSettingsActivationPlan {
	readonly collection: string
	readonly documentId: string
	readonly draftRevision: string
	readonly prefix: string
	/** Published items acquire these URLs; their stored slugs do not change. */
	readonly liveUrls: readonly {
		readonly id: string
		readonly revision: string
		readonly schemaType: string
		readonly title: string
		readonly pathname: string
	}[]
	readonly draftUrls: readonly {
		readonly id: string
		readonly pathname: string | null
	}[]
	/** No previous live URLs exist, so activation creates or retargets no redirects. */
	readonly redirects: {
		readonly creates: readonly []
		readonly updates: readonly []
	}
	readonly reviewVersions: readonly {
		readonly id: string
		readonly revision: string
	}[]
	/** Rechecks must cover absence too, not just revisions of returned documents. */
	readonly absentSettingsIds: readonly string[]
	readonly inactiveCollectionsBefore: readonly string[]
	readonly reviewBytes: number
}

export type CollectionSettingsActivationResult =
	| { readonly ok: true; readonly value: CollectionSettingsActivationPlan }
	| {
			readonly ok: false
			readonly reason:
				| 'invalid-choice'
				| 'incomplete-inventory'
				| 'invalid-inventory'
				| 'limit-exceeded'
				| 'settings-invalid'
				| 'not-first-activation'
				| 'review-stale'
				| 'release-version'
				| 'routing-conflict'
				| 'reserved-prefix'
				| 'invalid-url'
				| 'url-collision'
				| 'redirect-conflict'
			readonly collection?: string
			readonly documentId?: string
			readonly conflictingDocumentId?: string
			readonly pathname?: string
			readonly detail?: string
			readonly classificationFailure?: Extract<
				CollectionSettingsPublicationClassificationResult,
				{ ok: false }
			>
			readonly redirect?: Extract<BulkRedirectResult, { ok: false }>
	  }

const record = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value)
function freeze<T>(value: T): T {
	if (value && typeof value === 'object') {
		for (const child of Object.values(value)) freeze(child)
		Object.freeze(value)
	}
	return value
}
function readField(document: Record<string, unknown>, path: string): unknown {
	let value: unknown = document
	for (const part of path.split('.'))
		value =
			record(value) && Object.hasOwn(value, part) ? value[part] : undefined
	return value
}

/**
 * Inventory must contain all registered page/item versions, every editable
 * settings identity and its draft/release versions, and all redirect versions.
 * `complete` and `readAccess` are explicit caller assertions, not permissions
 * inferred from visible rows. The exposed readRequirements describe that scope.
 */
export function createCollectionSettingsActivationPlanner(
	configuration: CollectionRoutingConfig,
) {
	const config = structuredClone(configuration)
	const routing = createCollectionRouting(config)
	const classifier = createCollectionSettingsPublicationClassifier(config)
	const settingsIds = new Set(routing.documentIds)
	const types = [
		...config.pages.map((page) => ({
			schemaType: page.schemaType,
			titleField: page.titleField ?? 'title',
			collection: undefined as string | undefined,
		})),
		...(config.collections ?? []).flatMap((collection) =>
			collection.items.map((item) => ({
				schemaType: item.schemaType,
				titleField: item.titleField ?? 'title',
				collection: collection.name,
			})),
		),
	]
	return Object.freeze({
		readRequirements: createCollectionPrefixReadRequirements(config),
		plan(
			choice: CollectionSettingsActivationChoice,
			inventory: CollectionPrefixInventory,
		): CollectionSettingsActivationResult {
			if (
				!record(choice) ||
				typeof choice.collection !== 'string' ||
				typeof choice.draftRevision !== 'string' ||
				!choice.draftRevision.trim()
			)
				return { ok: false, reason: 'invalid-choice' }
			const target = config.collections?.find(
				(entry) => entry.name === choice.collection,
			)
			if (!target) return { ok: false, reason: 'invalid-choice' }
			if (
				typeof target.routePrefix === 'string' ||
				target.routePrefix?.mode === 'locked'
			)
				return { ok: false, reason: 'not-first-activation' }
			if (
				!inventory ||
				inventory.perspective !== 'raw' ||
				inventory.complete !== true ||
				inventory.readAccess !== 'all-required-versions' ||
				!Array.isArray(inventory.settings) ||
				!Array.isArray(inventory.documents) ||
				!Array.isArray(inventory.redirects)
			)
				return { ok: false, reason: 'incomplete-inventory' }
			if (
				inventory.settings.length > COLLECTION_PREFIX_LIMITS.settingsVersions ||
				inventory.documents.length > COLLECTION_PREFIX_LIMITS.pageVersions ||
				inventory.redirects.length > REDIRECT_MAX_RECORDS
			)
				return { ok: false, reason: 'limit-exceeded' }
			try {
				if (
					new TextEncoder().encode(JSON.stringify(inventory)).byteLength >
					COLLECTION_PREFIX_LIMITS.inventoryBytes
				)
					return { ok: false, reason: 'limit-exceeded' }
			} catch {
				return { ok: false, reason: 'invalid-inventory' }
			}
			const revisions: { id: string; revision: string }[] = []
			const identities = new Set<string>()
			for (const row of [
				...(inventory.settings as readonly unknown[]),
				...(inventory.documents as readonly unknown[]),
				...(inventory.redirects as readonly unknown[]),
			]) {
				if (!record(row)) return { ok: false, reason: 'invalid-inventory' }
				const identity = prefixVersionIdentity(row._id)
				if (
					!identity ||
					identities.has(identity.id) ||
					typeof row._type !== 'string' ||
					typeof row._rev !== 'string' ||
					!row._rev.trim() ||
					(row._originalId !== undefined && row._originalId !== identity.id)
				)
					return { ok: false, reason: 'invalid-inventory' }
				identities.add(identity.id)
				revisions.push({ id: identity.id, revision: row._rev })
			}
			const settings = new Map<string, Record<string, unknown>>()
			for (const value of inventory.settings) {
				const row = value as Record<string, unknown>
				const identity = prefixVersionIdentity(row._id)!
				if (!settingsIds.has(identity.base))
					return { ok: false, reason: 'invalid-inventory' }
				// As in prefix-change reviews, release-specific routing is unsupported.
				// We cannot treat a planned settings prefix as harmless without resolving it.
				if (identity.version === 'release')
					return {
						ok: false,
						reason: 'release-version',
						documentId: identity.id,
					}
				settings.set(identity.id, row)
			}
			const targetId = target?.settingsDocumentId
			const classified = classifier.classify({
				collection: choice.collection,
				published: targetId ? (settings.get(targetId) ?? null) : null,
				draft: targetId ? (settings.get(`drafts.${targetId}`) ?? null) : null,
			})
			if (!classified.ok)
				return {
					ok: false,
					reason: 'settings-invalid',
					classificationFailure: classified,
				}
			if (
				classified.value.kind !== 'first-publication' ||
				!classified.value.activatesUrls
			)
				return { ok: false, reason: 'not-first-activation' }
			if (classified.value.draftRevision !== choice.draftRevision)
				return { ok: false, reason: 'review-stale' }
			const selected = classified.value
			if (
				isReservedPath(
					selected.prefix,
					config.excludePaths,
					config.reservedPathPrefixes,
				)
			)
				return {
					ok: false,
					reason: 'reserved-prefix',
					pathname: selected.prefix,
				}
			const contexts = []
			const inactiveCollectionsBefore: string[] = []
			for (const perspective of ['published', 'drafts', 'proposed'] as const) {
				const active = (config.collections ?? []).filter((collection) => {
					const id = collection.settingsDocumentId
					if (!id || !settingsIds.has(id)) return true
					const hasPublished = settings.has(id)
					if (perspective === 'published' && !hasPublished)
						inactiveCollectionsBefore.push(collection.name)
					return (
						hasPublished ||
						(perspective === 'drafts' && settings.has(`drafts.${id}`)) ||
						(perspective === 'proposed' && id === selected.documentId)
					)
				})
				const documents = [...settings.values()]
				if (perspective === 'proposed') {
					const draft = settings.get(`drafts.${selected.documentId}`)!
					documents.push({
						...draft,
						_id: selected.documentId,
						...(draft._originalId === undefined
							? {}
							: { _originalId: selected.documentId }),
					})
				}
				const result = createCollectionRouting({
					...config,
					collections: active,
				}).resolve(
					{
						status: 'available',
						perspective: 'raw',
						coverage: 'published-and-drafts',
						complete: true,
						documents,
					},
					perspective === 'drafts' ? 'drafts' : 'published',
				)
				if (!result.ok)
					return {
						ok: false,
						reason:
							result.reason === 'routing-conflict'
								? 'routing-conflict'
								: 'settings-invalid',
						detail: `${perspective}:${result.reason}`,
						...(result.collection ? { collection: result.collection } : {}),
					}
				contexts.push({
					value: result.value,
					active: new Set(active.map((entry) => entry.name)),
				})
			}
			const rows: {
				id: string
				base: string
				version: string
				affected: boolean
				paths: readonly (string | null)[]
				revision: string
				schemaType: string
				title: string
			}[] = []
			const identityTypes = new Map<string, string>()
			for (const value of inventory.documents) {
				const row = value as Record<string, unknown>
				const identity = prefixVersionIdentity(row._id)!
				const type = types.find((entry) => entry.schemaType === row._type)
				if (!type) return { ok: false, reason: 'invalid-inventory' }
				const previousType = identityTypes.get(identity.base)
				if (previousType && previousType !== type.schemaType)
					return {
						ok: false,
						reason: 'invalid-inventory',
						documentId: identity.id,
					}
				identityTypes.set(identity.base, type.schemaType)
				const affected = type.collection === selected.collection
				if (affected && identity.version === 'release')
					return {
						ok: false,
						reason: 'release-version',
						documentId: identity.id,
					}
				const paths: (string | null)[] = []
				for (const context of contexts) {
					if (type.collection && !context.active.has(type.collection)) {
						paths.push(null)
						continue
					}
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
					affected,
					paths,
					revision: row._rev as string,
					schemaType: type.schemaType,
					title: typeof title === 'string' ? title : 'Untitled',
				})
			}
			const affected = rows.filter((row) => row.affected)
			if (affected.length > COLLECTION_PREFIX_LIMITS.affectedVersions)
				return { ok: false, reason: 'limit-exceeded' }
			const owners = new Map<string, (typeof rows)[number]>()
			for (const row of rows)
				for (const pathname of row.paths) {
					if (pathname === null) continue
					const owner = owners.get(pathname)
					if (owner && owner.base !== row.base)
						return {
							ok: false,
							reason: 'url-collision',
							documentId: row.id,
							conflictingDocumentId: owner.id,
							pathname,
						}
					owners.set(pathname, row)
				}
			const livePaths = (index: number) =>
				rows
					.filter((row) => row.version === 'published')
					.flatMap((row) =>
						row.paths[index] === null ? [] : [row.paths[index]!],
					)
			const redirect = planBulkRedirects({
				moves: [],
				createRedirects: false,
				// Only this collection's new URLs affect pending redirect drafts.
				// An unrelated draft pointing at an existing page need not block setup.
				draftDestinations: [
					...new Set(
						affected.flatMap((row) =>
							row.paths
								.slice(1)
								.filter((path): path is string => path !== null),
						),
					),
				],
				inventory: {
					perspective: 'raw',
					complete: true,
					records: inventory.redirects,
				},
				occupiedPathsBefore: livePaths(0),
				occupiedPathsAfter: livePaths(2),
				destinationsBefore: 'unverified',
				destinationsAfter: 'unverified',
				...(config.excludePaths ? { reservedPaths: config.excludePaths } : {}),
				...(config.reservedPathPrefixes
					? { reservedPathPrefixes: config.reservedPathPrefixes }
					: {}),
			})
			if (!redirect.ok)
				return { ok: false, reason: 'redirect-conflict', redirect }
			const value = {
				collection: selected.collection,
				documentId: selected.documentId,
				draftRevision: selected.draftRevision,
				prefix: selected.prefix,
				liveUrls: affected
					.filter((row) => row.version === 'published' && row.paths[2] !== null)
					.map((row) => ({
						id: row.id,
						revision: row.revision,
						schemaType: row.schemaType,
						title: row.title,
						pathname: row.paths[2]!,
					})),
				draftUrls: affected
					.filter((row) => row.version === 'draft')
					.map((row) => ({ id: row.id, pathname: row.paths[1]! })),
				redirects: { creates: [] as const, updates: [] as const },
				reviewVersions: revisions.sort((a, b) => a.id.localeCompare(b.id)),
				absentSettingsIds: [...settingsIds]
					.flatMap((id) => [id, `drafts.${id}`])
					.filter((id) => !settings.has(id))
					.sort(),
				inactiveCollectionsBefore: inactiveCollectionsBefore.sort(),
			}
			const reviewBytes = new TextEncoder().encode(
				JSON.stringify(value),
			).byteLength
			if (reviewBytes > COLLECTION_PREFIX_LIMITS.reviewBytes)
				return { ok: false, reason: 'limit-exceeded' }
			return { ok: true, value: freeze({ ...value, reviewBytes }) }
		},
	})
}
