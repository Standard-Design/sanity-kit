/**
 * Small identity queries for the header, plus URL matching for navigator rows.
 * The previewed page and edited document are independent. Neither lookup depends
 * on the browser's loaded rows. See docs/pages.md: “Header identity”.
 */
import { defineQuery } from 'groq'
import type { PageQueryPlan } from './data-source.js'
import { registeredPathname, type PagesRegistry } from './registry.js'
import { pagePathFilter, pageProjection } from './resolvers.js'

export interface PageDocument {
	_id: string
	_type: string
	title: string | null
	pathname: string | null
}

export function createBrowserModel(registry: PagesRegistry) {
	const types = Object.freeze(registry.types.map((type) => type.schemaType))
	function previewQuery(preview?: string): PageQueryPlan | undefined {
		if (!preview) return undefined
		try {
			const path = new URL(preview, 'https://pages.invalid').pathname
			const plan = pagePathFilter(registry, path)
			if (!plan) return undefined
			// Two matches are enough to detect ambiguity; never pick the newest one.
			return {
				query: defineQuery(
					`*[${plan.filter}][0...2] { ${pageProjection(registry)} }`,
				),
				params: plan.params,
			}
		} catch {
			return undefined
		}
	}
	function documentQuery(
		id?: string,
		type?: string,
	): PageQueryPlan | undefined {
		if (!id || !type || !types.includes(type)) return undefined
		// Presentation may carry a draft/release version ID. The selected perspective
		// already chooses its effective version; query that document's canonical ID.
		const canonicalId = id
			.replace(/^drafts\./, '')
			.replace(/^versions\.[^.]+\./, '')
		return {
			query: defineQuery(
				`*[_id == $id && _type == $type][0...1] { ${pageProjection(registry)} }`,
			),
			params: { id: canonicalId, type },
		}
	}
	const documentPath = (document: PageDocument) =>
		registeredPathname(registry, document._type, document.pathname)
	function previewedDocument(documents: PageDocument[], preview?: string) {
		if (!preview) return undefined
		try {
			const pathname = new URL(preview, 'https://pages.invalid').pathname
			const matches = documents.filter(
				(document) => documentPath(document) === pathname,
			)
			return matches.length === 1 ? matches[0] : undefined
		} catch {
			return undefined
		}
	}
	return Object.freeze({
		types,
		previewQuery,
		documentQuery,
		documentPath,
		previewedDocument,
	})
}
