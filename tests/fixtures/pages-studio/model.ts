/**
 * Small, deliberately fixture-specific data contract for the A1 integration proof.
 * This is not the public Pages registry or the eventual collection query layer.
 */
export const proofTypes = ['kitProofPage', 'kitProofPost', 'kitProofLanding']

export interface ProofDocument {
	_id: string
	_type: string
	title: string | null
	pathname: string | null
}

export const proofQuery = /* groq */ `
  *[_type in $types] | order(_updatedAt desc, _id asc)[0...50] {
    _id, _type, title,
    "pathname": select(_type == "kitProofLanding" => route, pathname.current)
  }
`

/** Never send an external, malformed, or normalized-to-another-page URL to the iframe. */
export function previewPath(value: unknown): string | undefined {
	if (
		typeof value !== 'string' ||
		!value.startsWith('/') ||
		value.startsWith('//')
	)
		return undefined
	if (
		/[\\\s?#]/u.test(value) ||
		[...value].some((character) => character.charCodeAt(0) < 32)
	)
		return undefined
	try {
		const parsed = new URL(value, 'https://fixture.invalid')
		if (
			parsed.pathname !== value ||
			parsed.origin !== 'https://fixture.invalid'
		)
			return undefined
		decodeURIComponent(value)
		return value
	} catch {
		return undefined
	}
}

/** Selection follows the iframe URL, not the currently edited (possibly shared) document. */
export function previewedDocument(
	documents: ProofDocument[],
	preview?: string,
) {
	if (!preview) return undefined
	try {
		const pathname = new URL(preview, 'https://fixture.invalid').pathname
		return documents.find(
			(document) => previewPath(document.pathname) === pathname,
		)
	} catch {
		return undefined
	}
}
