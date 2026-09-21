import { defineQuery } from 'groq'
import type {
	SanityDataDecoder,
	SanityValidationDiagnostic,
} from '../core/index.js'

export interface SanityRouteData {
	_id: string
	_type: string
	pathname: string
}

export const sanityRouteDataQueryFragment = /* groq */ `
	"pathname": pathname.current,
	_type,
	_id
`

export const sanityRouteDataQuery = defineQuery(/* groq */ `
	*[pathname.current == $pathname][0] {
		${sanityRouteDataQueryFragment}
	}
`)

/** Schema-library-neutral decoder for the route lookup query result. */
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

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
