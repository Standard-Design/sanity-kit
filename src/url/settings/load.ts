/**
 * Read the exact settings identities required by a collection routing context.
 * This boundary fetches; resolve.ts remains pure and decides what the records
 * mean. Nothing here writes settings, caches results, or activates a route.
 */
import { defineQuery } from 'groq'
import {
	createCollectionRouting,
	type CollectionRoutingConfig,
	type CollectionRoutingResult,
	type RoutingPerspective,
} from './resolve.js'

export const MAX_SETTINGS_PAYLOAD_BYTES = 1024 * 1024

/** Narrow structural boundary works with both application and Studio SDK clients. */
export interface CollectionSettingsClient {
	withConfig(config: {
		apiVersion: string
		useCdn: false
		perspective: 'raw'
		stega: false
	}): {
		fetch(
			query: string,
			params: { ids: string[] },
			options: {
				filterResponse: true
				perspective: 'raw'
				useCdn: false
				stega: false
				cache: 'no-store'
				signal?: AbortSignal
			},
		): Promise<unknown>
	}
}

export interface CollectionSettingsLoadRequest {
	readonly perspective: RoutingPerspective
	/** The caller knows its client can see every configured draft counterpart. */
	readonly draftVisibility?: 'all-required-drafts'
	readonly signal?: AbortSignal
}

export type CollectionSettingsLoadResult =
	| CollectionRoutingResult
	| {
			readonly ok: false
			readonly reason:
				'request-failed' | 'invalid-response' | 'access-unconfirmed' | 'aborted'
	  }

// At most 100 bindings produce 200 requested identities. The extra row makes
// an oversized response detectable instead of quietly accepting a partial read.
const QUERY = defineQuery(/* groq */ `*[_id in $ids][0...201]{
	_id, _rev, _type, collection,
	prefix{_type, current},
	defined(_originalId) => {_originalId}
}`)

function validResponse(
	value: unknown,
	ids: readonly string[],
): value is unknown[] {
	if (!Array.isArray(value) || value.length > ids.length) return false
	const expected = new Set(ids)
	const seen = new Set<string>()
	for (const row of value as unknown[]) {
		if (
			!row ||
			typeof row !== 'object' ||
			Array.isArray(row) ||
			!Object.hasOwn(row, '_id')
		)
			return false
		const id = (row as Record<string, unknown>)._id
		if (typeof id !== 'string' || !expected.has(id) || seen.has(id))
			return false
		seen.add(id)
	}
	try {
		return (
			new TextEncoder().encode(JSON.stringify(value)).byteLength <=
			MAX_SETTINGS_PAYLOAD_BYTES
		)
	} catch {
		return false
	}
}

/** Both URL contexts resolved from the same raw settings read. */
export type CollectionSettingsPairResult =
	| {
			readonly ok: true
			readonly published: Extract<
				CollectionRoutingResult,
				{ ok: true }
			>['value']
			readonly drafts: Extract<CollectionRoutingResult, { ok: true }>['value']
	  }
	| Extract<CollectionSettingsLoadResult, { ok: false }>

/**
 * Configuration is snapshotted once. The supplied client selects the project and
 * dataset, which holds one website's routing settings in this first version.
 * A successful raw query cannot establish whether credentials could see drafts.
 */
export function createCollectionRoutingLoader(
	config: CollectionRoutingConfig,
	client: CollectionSettingsClient,
) {
	const routing = createCollectionRouting(config)
	async function read(request: CollectionSettingsLoadRequest) {
		const { perspective, signal, draftVisibility } = request
		if (signal?.aborted) return { ok: false, reason: 'aborted' } as const
		if (perspective !== 'published' && perspective !== 'drafts')
			return { ok: false, reason: 'unsupported-perspective' } as const
		if (!routing.documentIds.length) return { ok: true, documents: [] } as const
		if (perspective === 'drafts' && draftVisibility !== 'all-required-drafts')
			return { ok: false, reason: 'access-unconfirmed' } as const
		const ids = [...routing.documentIds]
		if (perspective === 'drafts')
			ids.push(...routing.documentIds.map((id) => `drafts.${id}`))
		let documents: unknown
		try {
			const source = client.withConfig({
				apiVersion: '2026-10-01',
				useCdn: false,
				perspective: 'raw',
				stega: false,
			})
			documents = await source.fetch(
				QUERY,
				{ ids: [...ids] },
				{
					filterResponse: true,
					perspective: 'raw',
					useCdn: false,
					stega: false,
					cache: 'no-store',
					...(signal === undefined ? {} : { signal }),
				},
			)
		} catch {
			return {
				ok: false,
				reason: signal?.aborted ? 'aborted' : 'request-failed',
			} as const
		}
		// Some injected transports ignore AbortSignal. Never return their late data.
		if (signal?.aborted) return { ok: false, reason: 'aborted' } as const
		if (!validResponse(documents, ids))
			return { ok: false, reason: 'invalid-response' } as const
		return { ok: true, documents } as const
	}
	const snapshot = (
		documents: readonly unknown[],
		perspective: RoutingPerspective,
	) => ({
		status: 'available',
		perspective: 'raw',
		complete: true,
		coverage: perspective === 'drafts' ? 'published-and-drafts' : 'published',
		documents,
	})
	return Object.freeze({
		documentIds: routing.documentIds,
		async load(
			request: CollectionSettingsLoadRequest,
		): Promise<CollectionSettingsLoadResult> {
			const result = await read(request)
			if (!result.ok) return result
			return routing.resolve(
				snapshot(result.documents, request.perspective),
				request.perspective,
			)
		},
		/**
		 * Authoring needs the live and proposed URL spaces from one raw read. Two
		 * separate fetches could combine settings from different moments in time.
		 * Both must resolve: a missing live prefix is not a default or an empty site.
		 */
		async loadBoth(
			request: Omit<CollectionSettingsLoadRequest, 'perspective'> = {},
		): Promise<CollectionSettingsPairResult> {
			const result = await read({ ...request, perspective: 'drafts' })
			if (!result.ok) return result
			const raw = snapshot(result.documents, 'drafts')
			const published = routing.resolve(raw, 'published')
			if (!published.ok) return published
			const drafts = routing.resolve(raw, 'drafts')
			if (!drafts.ok) return drafts
			return { ok: true, published: published.value, drafts: drafts.value }
		},
	})
}
