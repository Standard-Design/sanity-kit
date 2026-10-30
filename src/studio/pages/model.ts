/**
 * The transitional header identity helper reads a bounded list. Its URL decisions come
 * from the same registry as Presentation's resolvers; no fixture types are known
 * here. The tree and collection browser now use the full/paginated query resources.
 */
import { registeredPathname, type PagesRegistry } from './registry.js'
import { pageProjection } from './resolvers.js'

export interface PageDocument {
	_id: string
	_type: string
	title: string | null
	pathname: string | null
}

export function createBrowserModel(registry: PagesRegistry) {
	const types = Object.freeze(registry.types.map((type) => type.schemaType))
	const query = `*[_type in $types] | order(_updatedAt desc, _id asc)[0...50] {
    ${pageProjection(registry)}
  }`
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
	return Object.freeze({ types, query, documentPath, previewedDocument })
}
