/**
 * Read-only occupancy checks for the forthcoming URL field. Preparation answers
 * “is this URL allowed?”; this layer asks “who already stores this exact URL?”.
 * It neither reserves the URL nor authorizes a write. See docs/url.md.
 */
import { defineQuery } from 'groq'
import { getPublishedId } from 'sanity'
import {
	createUrlAuthoring,
	type UrlCandidate,
	type UrlPreparationReason,
} from '../../url/authoring.js'
import {
	createPagesRegistry,
	pageSlug,
	type PagesRouteConfig,
} from '../../url/registry.js'
import type { PagesClient } from '../pages/data-source.js'
import { fieldExpression } from '../pages/resolvers.js'

/** Bound response size, not the number of documents searched. */
const CONFLICT_LIMIT = 20

export interface UrlConflictRequest {
	readonly schemaType: string
	readonly storedValue: unknown
	/** Omit only for a new document without an assigned identity. */
	readonly documentId?: string
}

export interface UrlConflict {
	readonly documentId: string
	readonly schemaType: string
	readonly revision: string
	readonly version: 'published' | 'draft' | 'release'
}

export type UrlConflictResult =
	| {
			readonly status: 'checked'
			readonly candidate: UrlCandidate
			readonly conflicts: readonly UrlConflict[]
			readonly hasMore: boolean
	  }
	| {
			readonly status: 'invalid'
			readonly reason: UrlPreparationReason | 'invalid-document-id'
	  }
	| {
			readonly status: 'unavailable'
			readonly reason: 'request-failed' | 'invalid-response' | 'aborted'
	  }

function validId(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		/^[A-Za-z0-9_.-]{1,128}$/u.test(value) &&
		!value.startsWith('-') &&
		!value.includes('..') &&
		!value.split('.').slice(1).includes('versions') &&
		(!value.startsWith('versions.') ||
			(value.split('.').length >= 3 && !value.endsWith('.')))
	)
}

/**
 * Keep this separate from the navigator's effective-perspective data source:
 * deduping a published document into its draft could hide a live URL conflict.
 * The supplied Studio client must be authorized to see all relevant versions.
 * raw does not bypass permissions, and a successful query cannot prove visibility.
 */
export function createUrlConflictChecker(
	config: PagesRouteConfig,
	client: Pick<PagesClient, 'withConfig'>,
) {
	const registry = createPagesRegistry(config)
	const authoring = createUrlAuthoring(config)
	const source = client.withConfig({
		apiVersion: '2026-10-01',
		useCdn: false,
		perspective: 'raw',
		stega: false,
	})

	return async (
		request: UrlConflictRequest,
		signal?: AbortSignal,
	): Promise<UrlConflictResult> => {
		if (signal?.aborted) return { status: 'unavailable', reason: 'aborted' }
		const prepared = authoring.prepareStored(
			request.schemaType,
			request.storedValue,
		)
		if (!prepared.ok) return { status: 'invalid', reason: prepared.reason }
		const { documentId } = request
		let publishedId: string | null = null
		if (documentId !== undefined) {
			if (!validId(documentId))
				return { status: 'invalid', reason: 'invalid-document-id' }
			publishedId = getPublishedId(documentId)
			if (
				!validId(publishedId) ||
				publishedId.startsWith('drafts.') ||
				publishedId.split('.').includes('versions')
			)
				return { status: 'invalid', reason: 'invalid-document-id' }
		}

		const pathname = prepared.value.url.pathname
		const params: Record<string, unknown> = { publishedId, pathname }
		// Do not reuse the navigator's ownership-filtered lookup. Even a document
		// stored under the wrong index page type can occupy the proposed URL. Compare
		// every full-path type, plus each collection whose slug could produce it.
		// Equality on stored fields avoids concatenating every item's URL in GROQ.
		const clauses = registry.types.flatMap((type, index) => {
			let value = pathname
			if (type.pathMode === 'slug') {
				const prefix = `${type.routePrefix}/`
				if (!pathname.startsWith(prefix)) return []
				value = pathname.slice(prefix.length)
				if (!pageSlug(value)) return []
			}
			params[`type${index}`] = type.schemaType
			params[`value${index}`] = value
			return `(_type == $type${index} && ${fieldExpression(type.pathField)} == $value${index})`
		})
		// Follow native slug uniqueness: all versions of this identity are self,
		// not competing pages. Release-related write restrictions belong elsewhere.
		// Active redirect sources occupy URLs too. Their published record remains
		// authoritative while a draft changes or disables the rule. Self-exclusion
		// applies only to pages: a redirect must never be mistaken for this page.
		const query = defineQuery(`*[
			((${clauses.join(' || ')}) && ($publishedId == null || !sanity::versionOf($publishedId)))
			|| (_type == "sanityKitRedirect" && enabled == true && source == $pathname
				&& !(_id in path("drafts.**")) && !(_id in path("versions.**")))
		] | order(_id asc)[0...${CONFLICT_LIMIT + 1}] {
			_id, _type, _rev, _type == "sanityKitRedirect" => {source, enabled}
		}`)

		let rows: unknown
		try {
			rows = await source.fetch<unknown>(query, params, {
				perspective: 'raw',
				useCdn: false,
				stega: false,
				filterResponse: true,
				tag: 'sanity-kit.url-conflicts',
				...(signal ? { signal } : {}),
			})
		} catch {
			return {
				status: 'unavailable',
				reason: signal?.aborted ? 'aborted' : 'request-failed',
			}
		}
		// An adapter might finish after cancellation; never expose that stale result.
		if (signal?.aborted) return { status: 'unavailable', reason: 'aborted' }
		if (!Array.isArray(rows) || rows.length > CONFLICT_LIMIT + 1)
			return { status: 'unavailable', reason: 'invalid-response' }
		const conflicts: UrlConflict[] = []
		const seen = new Set<string>()
		for (const row of rows as unknown[]) {
			if (!row || typeof row !== 'object' || Array.isArray(row))
				return { status: 'unavailable', reason: 'invalid-response' }
			const {
				_id,
				_type,
				_rev,
				source: redirectSource,
				enabled,
			} = row as Record<string, unknown>
			const redirect = _type === 'sanityKitRedirect'
			if (
				!validId(_id) ||
				typeof _type !== 'string' ||
				(!redirect &&
					!registry.types.some((type) => type.schemaType === _type)) ||
				typeof _rev !== 'string' ||
				!_rev ||
				seen.has(_id) ||
				(!redirect &&
					publishedId !== null &&
					getPublishedId(_id) === publishedId) ||
				(redirect &&
					(_id.startsWith('drafts.') ||
						_id.startsWith('versions.') ||
						enabled !== true ||
						redirectSource !== pathname))
			)
				return { status: 'unavailable', reason: 'invalid-response' }
			seen.add(_id)
			conflicts.push({
				documentId: _id,
				schemaType: _type,
				revision: _rev,
				version: _id.startsWith('versions.')
					? 'release'
					: _id.startsWith('drafts.')
						? 'draft'
						: 'published',
			})
		}
		return {
			status: 'checked',
			candidate: prepared.value,
			conflicts: conflicts.slice(0, CONFLICT_LIMIT),
			hasMore: conflicts.length > CONFLICT_LIMIT,
		}
	}
}
