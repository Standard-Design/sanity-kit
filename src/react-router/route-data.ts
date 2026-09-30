/**
 * Find just enough document data to choose a page loader: `_id`, `_type`, and
 * `pathname`, projected from stored `pathname.current`. The server loader uses
 * this small lookup before it knows which full-page query and decoder to run.
 * No application-specific page schema is needed at this stage.
 *
 * @see docs/react-router.md#route-lookup-data
 * @see docs/loaders.md#what-happens-on-a-request
 */
import { defineQuery } from 'groq'
import type {
	SanityDataDecoder,
	SanityValidationDiagnostic,
} from '../core/index.js'

/** Routing fields only; the page query supplies content and the registry checks the type. */
export interface SanityRouteData {
	_id: string
	_type: string
	pathname: string
}

/** Reusable destination projection; canonical `/link` fragments mirror this shape. */
export const sanityRouteDataQueryFragment = /* groq */ `
	"pathname": pathname.current,
	_type,
	_id
`

/**
 * First-stage lookup used by server/loaders.ts with normalized loader pathname.
 * Perspective is supplied by the selected client options, not hardcoded here.
 * `[0]` assumes application/Studio rules prevent duplicate route pathnames; this
 * query itself does not detect collisions or filter to registered document types.
 * @see docs/react-router.md#route-lookup-data for the pathname uniqueness requirement.
 */
export const sanityRouteDataQuery = defineQuery(/* groq */ `
	*[pathname.current == $pathname][0] {
		${sanityRouteDataQueryFragment}
	}
`)

/**
 * Schema-library-neutral decoder for routing fields only. The loader supplies a
 * clean shadow via validateSanityData and turns null/undefined failures into 404s.
 * Other malformed results become 500s. Successful output is a frozen minimal
 * copy, discarding unrelated fields. Path validation here only requires a leading
 * slash; canonical URL/link validation and uniqueness are separate concerns.
 * @see docs/loaders.md#public-error-codes for how failures become HTTP errors.
 */
export const sanityRouteDataDecoder: SanityDataDecoder<SanityRouteData> = {
	decode(input) {
		if (!isRecord(input)) {
			return {
				success: false,
				diagnostics: [
					invalidRouteData(
						[],
						'Expected a route document, but the query returned no object.',
					),
				],
			}
		}

		const diagnostics: SanityValidationDiagnostic[] = []
		const id = readNonEmptyString(input, '_id', diagnostics)
		const type = readNonEmptyString(input, '_type', diagnostics)
		const pathname = readNonEmptyString(input, 'pathname', diagnostics)

		if (pathname !== undefined && !pathname.startsWith('/')) {
			diagnostics.push(
				invalidRouteData(
					['pathname'],
					'Expected `pathname` to begin with `/`.',
				),
			)
		}

		if (
			diagnostics.length > 0 ||
			id === undefined ||
			type === undefined ||
			pathname === undefined
		) {
			return { success: false, diagnostics }
		}

		return {
			success: true,
			value: Object.freeze({ _id: id, _type: type, pathname }),
			diagnostics: [],
		}
	},
}

/** Reject missing results/arrays before collecting field-level issues. */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Accumulate issues rather than throwing, so one result can report multiple fields. */
function readNonEmptyString(
	record: Record<string, unknown>,
	key: keyof SanityRouteData,
	diagnostics: SanityValidationDiagnostic[],
): string | undefined {
	const value = record[key]
	if (typeof value === 'string' && value.trim().length > 0) return value

	diagnostics.push(
		invalidRouteData([key], `Expected \`${key}\` to be a non-empty string.`),
	)
	return undefined
}

/** Consistent decoder attribution consumed by the loader's server-only failure hook. */
function invalidRouteData(
	path: SanityValidationDiagnostic['path'],
	message: string,
): SanityValidationDiagnostic {
	return {
		code: 'ROUTE_DATA_INVALID',
		message,
		path,
		source: 'sanity-route-data',
	}
}
