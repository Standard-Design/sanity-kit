/**
 * Query plans for the navigator data layer. These functions perform no IO:
 * callers supply Studio's authenticated client, effective perspective, and abort
 * signal. data-session.ts runs these for the tree and collection browsers; the
 * header identity lookups use model.ts in the same session.
 */
import { defineQuery } from 'groq'
import type { PageDocument } from './model.js'
import { fieldExpression, pageProjection } from './resolvers.js'
import type { PagesRegistry } from './registry.js'

export interface NavigationDocument extends PageDocument {
	_updatedAt: string
	/** Content Lake's source identity; not enough to determine publication status. */
	_originalId?: string | null
}

export interface CollectionCursor {
	updatedAt: string
	id: string
}

export const PAGE_BATCH_SIZE = 100
export const COLLECTION_BATCH_SIZE = 50
export const COLLECTION_PREVIEW_SIZE = 5

/** Query values are always parameters; only validated schema field paths become syntax. */
export function createNavigationQueries(registry: PagesRegistry) {
	const projection = `${pageProjection(registry)}, _updatedAt, _originalId`
	const types = registry.types
		.filter((type) => !type.collection)
		.map((type) => type.schemaType)
	const collectionTypes = (name: string) => {
		if (!registry.collections.some((collection) => collection.name === name))
			throw new Error(`Unknown Pages collection: ${name}`)
		return registry.types.filter((type) => type.collection === name)
	}
	return {
		/**
		 * Read all ordinary pages in small ID-ordered batches before building a tree.
		 * No pathname filter: incomplete and excluded pages must stay discoverable.
		 */
		pages(after = '') {
			return {
				query: defineQuery(
					`*[_type in $types && _id > $after] | order(_id asc)[0...${PAGE_BATCH_SIZE}] {${projection}}`,
				),
				params: { types, after },
			}
		},
		/** Fetch five recent items plus a total, never the whole collection for its preview. */
		recent(name: string) {
			return {
				query: defineQuery(`{
					"total": count(*[_type in $types]),
					"documents": *[_type in $types] | order(_updatedAt desc, _id asc)[0...${COLLECTION_PREVIEW_SIZE}] {${projection}}
				}`),
				params: { types: collectionTypes(name).map((type) => type.schemaType) },
			}
		},
		/**
		 * Search is a literal, case-insensitive title/path substring within item types.
		 * It runs in the query, not over five recent rows. It is not relevance-ranked
		 * Studio search; very large datasets may need an indexed search strategy later.
		 * One extra result tells the caller whether another batch exists.
		 */
		collection(name: string, search = '', after?: CollectionCursor) {
			const definitions = collectionTypes(name)
			const matches = definitions
				.map(
					(type) => `(_type == ${JSON.stringify(type.schemaType)} && (
				count(string::split(lower(coalesce(${fieldExpression(type.titleField)}, "")), $search)) > 1 ||
				count(string::split(lower(coalesce(${fieldExpression(type.pathnameField)}, "")), $search)) > 1
			))`,
				)
				.join(' || ')
			return {
				query: defineQuery(`*[_type in $types
					&& ($search == "" || ${matches})
					&& (!$hasCursor || _updatedAt < $updatedAt || (_updatedAt == $updatedAt && _id > $id))
				] | order(_updatedAt desc, _id asc)[0...${COLLECTION_BATCH_SIZE + 1}] {${projection}}`),
				params: {
					types: definitions.map((type) => type.schemaType),
					search: search.trim().toLowerCase(),
					hasCursor: after !== undefined,
					updatedAt: after?.updatedAt ?? '',
					id: after?.id ?? '',
				},
			}
		},
	}
}

/** Remove the look-ahead row; its timestamp/ID must not become the next cursor. */
export function collectionBatch(documents: readonly NavigationDocument[]) {
	const items = documents.slice(0, COLLECTION_BATCH_SIZE)
	const last = items.at(-1)
	return {
		documents: items,
		next:
			documents.length > COLLECTION_BATCH_SIZE && last
				? { updatedAt: last._updatedAt, id: last._id }
				: undefined,
	}
}
