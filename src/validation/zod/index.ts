import type { output, ZodType } from 'zod'
import type {
	SanityDataDecoder,
	SanityValidationPathSegment,
} from '../../core/index.js'

/** Adapt a Zod schema to SanityKit's optional decoder contract. */
export function createZodDecoder<TSchema extends ZodType>(
	schema: TSchema,
): SanityDataDecoder<output<TSchema>> {
	return {
		async decode(input) {
			const result = await schema.safeParseAsync(input)

			if (result.success) {
				return {
					success: true,
					value: result.data,
					diagnostics: [],
				}
			}

			return {
				success: false,
				diagnostics: result.error.issues.map((issue) => ({
					code: issue.code,
					message: issue.message,
					path: issue.path.map(normalizePathSegment),
					source: 'zod',
				})),
			}
		},
	}
}

function normalizePathSegment(
	segment: PropertyKey,
): SanityValidationPathSegment {
	return typeof segment === 'symbol' ? segment.toString() : segment
}
