/**
 * Turn a Zod schema into the same decoder contract used by the rest of the kit.
 * This separate entrypoint lets other consumers use their own validator without
 * installing Zod. The caller still decides how to handle failure and preview.
 *
 * @see docs/validation-zod.md for schema examples and draft handling.
 * @see docs/core.md#the-decoder-contract for the library-independent result shape.
 */
import type { output, ZodType } from 'zod'
import type {
	SanityDataDecoder,
	SanityValidationPathSegment,
} from '../../core/index.js'

/**
 * Wrap a schema, including async checks and transforms, as a kit decoder.
 * The inferred value is Zod's output type: defaults and transforms can make it
 * different from the input type.
 *
 * Use with `validateSanityData` for a clean validation shadow, or as a loader's
 * `previewDecoder` to parse original Stega strings. This adapter itself never
 * cleans input. Draft schemas must preserve text intended for Visual Editing.
 * Expected schema failures become diagnostics; unexpected thrown errors escape.
 * Keep schemas free of side effects: loaders can decode the same input twice.
 * @see docs/validation-zod.md#cleaning-and-preview-are-caller-choices
 */
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

/** Make Zod's possible symbol keys serializable in the shared diagnostic format. */
function normalizePathSegment(
	segment: PropertyKey,
): SanityValidationPathSegment {
	return typeof segment === 'symbol' ? segment.toString() : segment
}
