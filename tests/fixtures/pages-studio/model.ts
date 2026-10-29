/**
 * Small, deliberately fixture-specific data contract for the A1 integration proof.
 * This is not the public Pages registry or the eventual collection query layer.
 */
import { defineQuery } from 'groq'
import {
	pagePathname,
	registeredPathname,
} from '../../../src/studio/pages/registry.js'
import { pageProjection } from '../../../src/studio/pages/resolvers.js'
import { proofRegistry } from './routes.js'

export const proofTypes = proofRegistry.types.map((type) => type.schemaType)

export interface ProofDocument {
	_id: string
	_type: string
	title: string | null
	pathname: string | null
}

// Dynamic registry projection is runtime configuration, not a TypeGen static query.
export const proofQuery = defineQuery(/* groq */ `
  *[_type in $types] | order(_updatedAt desc, _id asc)[0...50] {
    ${pageProjection(proofRegistry)}
  }
`)

/** Never send an external, malformed, or normalized-to-another-page URL to the iframe. */
export const previewPath = pagePathname

/** Keep list entries with missing/excluded URLs, but do not navigate to those URLs. */
export function proofDocumentPath(document: ProofDocument): string | undefined {
	return registeredPathname(proofRegistry, document._type, document.pathname)
}

/** Selection follows the iframe URL, not the currently edited (possibly shared) document. */
export function previewedDocument(
	documents: ProofDocument[],
	preview?: string,
) {
	if (!preview) return undefined
	try {
		const pathname = new URL(preview, 'https://fixture.invalid').pathname
		const matches = documents.filter(
			(document) => proofDocumentPath(document) === pathname,
		)
		return matches.length === 1 ? matches[0] : undefined
	} catch {
		return undefined
	}
}
