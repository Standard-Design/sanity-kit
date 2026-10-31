/**
 * Read the evidence used by private folder plans. This is deliberately separate
 * from the navigator, which reads an effective perspective and can hide versions.
 * No read adopts folders, changes documents, or authorizes a later write. The
 * separate write.ts service uses these reads for explicit create/sync actions.
 * See docs/folders.md for scope, access assertions, and snapshot limitations.
 */
import { defineQuery } from 'groq'
import {
	createPagesRegistry,
	type PagesRouteConfig,
} from '../../url/registry.js'
import { fieldExpression } from '../pages/resolvers.js'
import {
	createFolderPlanner,
	FOLDER_LIMITS,
	type FolderInventory,
	type FolderRegistryData,
} from './planner.js'

/**
 * Structural boundary for Studio and application clients. The installed SDK
 * forwards cache to native fetch even when its Next-specific overload hides it.
 * The transport test verifies this option reaches fetch without an unsafe cast.
 */
export interface FolderReadClient {
	withConfig(config: {
		apiVersion: string
		perspective: 'raw'
		useCdn: false
		stega: false
	}): {
		fetch(
			query: string,
			params: Record<string, unknown>,
			options: {
				perspective: 'raw'
				useCdn: false
				stega: false
				filterResponse: true
				cache: 'no-store'
				tag: string
				signal?: AbortSignal
			},
		): Promise<unknown>
	}
}

export interface FolderSnapshot {
	/** Projected fields, not a replacement document or a writable copy. */
	readonly registry: (FolderRegistryData & { readonly _rev: string }) | null
	readonly inventory: FolderInventory
}

export type FolderLoadResult =
	| { readonly status: 'loaded'; readonly snapshot: FolderSnapshot }
	| {
			readonly status: 'unavailable'
			readonly reason:
				| 'unknown-read-access'
				| 'aborted'
				| 'request-failed'
				| 'invalid-response'
				| 'invalid-registry'
				| 'limit-exceeded'
	  }

const record = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value)
const unavailable = (
	reason: Extract<FolderLoadResult, { status: 'unavailable' }>['reason'],
): FolderLoadResult => ({ status: 'unavailable', reason })

/** Reject malformed version identities instead of treating them as ordinary pages. */
function validId(value: unknown): value is string {
	if (
		typeof value !== 'string' ||
		!/^[A-Za-z0-9_.-]{1,128}$/u.test(value) ||
		value.startsWith('-') ||
		value.endsWith('.') ||
		value.includes('..')
	)
		return false
	const parts = value.split('.')
	if (parts[0] === 'drafts') parts.shift()
	else if (parts[0] === 'versions') {
		if (parts.length < 3) return false
		parts.splice(0, 2)
	}
	return (
		parts.length > 0 && !parts.includes('drafts') && !parts.includes('versions')
	)
}

/**
 * The supplied client's dataset and registered types define the content scope.
 * One website uses that project/dataset. Callers must own its registered-type
 * scope and explicitly attest access to the registry and every document version.
 */
export function createFolderLoader(
	options: { readonly routes: PagesRouteConfig },
	client: FolderReadClient,
) {
	const planner = createFolderPlanner(options)
	const routes = createPagesRegistry(options.routes)
	for (const type of routes.types)
		if (type.pathField.startsWith('_'))
			throw new Error('Folder URL fields must not target document metadata.')
	const source = client.withConfig({
		apiVersion: '2026-10-01',
		perspective: 'raw',
		useCdn: false,
		stega: false,
	})
	const params: Record<string, unknown> = {
		registryId: planner.id,
		types: routes.types.map((type) => type.schemaType),
	}
	const values = routes.types.map((type, index) => {
		params[`type${index}`] = type.schemaType
		return `_type == $type${index} => ${fieldExpression(type.pathField)}`
	})
	// Only the configured URL value is selected, without ownership or validity
	// filters. Otherwise a malformed or misplaced page could disappear from checks.
	// The extra row is an overflow sentinel, never permission to return a subset.
	const query = defineQuery(`{
		"registry": *[_id == $registryId][0] {
			_id, _type, _rev, _originalId, schemaVersion,
			"folders": select(count(folders) > ${FOLDER_LIMITS.folders} => folders[0...${FOLDER_LIMITS.folders + 1}], folders)
		},
		"documents": *[_type in $types] | order(_id asc)[0...${FOLDER_LIMITS.inventoryDocuments + 1}] {
			_id, _type, _rev, _originalId,
			"value": select(${values.join(', ')})
		}
	}`)

	return async (
		request: { readonly readAccess: 'all-registered-versions' | 'unknown' },
		signal?: AbortSignal,
	): Promise<FolderLoadResult> => {
		if (signal?.aborted) return unavailable('aborted')
		if (request?.readAccess !== 'all-registered-versions')
			return unavailable('unknown-read-access')
		let response: unknown
		try {
			response = await source.fetch(query, params, {
				perspective: 'raw',
				useCdn: false,
				stega: false,
				filterResponse: true,
				cache: 'no-store',
				tag: 'sanity-kit.folders-load',
				...(signal ? { signal } : {}),
			})
		} catch {
			return unavailable(signal?.aborted ? 'aborted' : 'request-failed')
		}
		// Some adapters complete despite cancellation. Never return their late data.
		if (signal?.aborted) return unavailable('aborted')
		if (
			!record(response) ||
			!Object.hasOwn(response, 'registry') ||
			!Array.isArray(response.documents)
		)
			return unavailable('invalid-response')
		if (response.documents.length > FOLDER_LIMITS.inventoryDocuments)
			return unavailable('limit-exceeded')
		const current = response.registry
		if (
			record(current) &&
			current._originalId != null &&
			current._originalId !== current._id
		)
			return unavailable('invalid-response')
		const checked = planner.validateRegistry(current)
		if (!checked.ok)
			return unavailable(
				checked.reason === 'limit-exceeded'
					? 'limit-exceeded'
					: 'invalid-registry',
			)

		const seen = new Set<string>()
		const documents: Record<string, unknown>[] = []
		for (const row of response.documents as unknown[]) {
			if (!record(row)) return unavailable('invalid-response')
			const type = routes.types.find((type) => type.schemaType === row._type)
			if (
				!type ||
				!validId(row._id) ||
				typeof row._rev !== 'string' ||
				!row._rev ||
				!Object.hasOwn(row, 'value') ||
				row.value === undefined ||
				seen.has(row._id) ||
				(row._originalId != null && row._originalId !== row._id)
			)
				return unavailable('invalid-response')
			seen.add(row._id)
			const document: Record<string, unknown> = {
				_id: row._id,
				_type: row._type,
				_rev: row._rev,
				...(row._originalId == null ? {} : { _originalId: row._originalId }),
			}
			// Rebuild the mapped field shape for the existing planner. No URL cleanup
			// or version deduplication: each stored value must reach its later gates.
			let container = document
			const parts = type.pathField.split('.')
			for (const part of parts.slice(0, -1)) {
				const child: Record<string, unknown> = {}
				container[part] = child
				container = child
			}
			try {
				container[parts.at(-1)!] = structuredClone(row.value)
			} catch {
				return unavailable('invalid-response')
			}
			documents.push(document)
		}
		return {
			status: 'loaded',
			snapshot: {
				registry:
					checked.value.guard.kind === 'absent'
						? null
						: {
								...checked.value.document,
								_rev: checked.value.guard.revision,
							},
				inventory: {
					perspective: 'raw',
					complete: true,
					readAccess: 'all-registered-versions',
					documents,
				},
			},
		}
	}
}
