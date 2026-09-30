/**
 * Validation shared by server loaders and applications, with no schema library required.
 *
 * Keep two values separate: the original query result and the decoder's output.
 * Preview strings can contain Stega, invisible metadata used by Visual Editing.
 * Validate a separate clean copy (the guides call it a "clean shadow") while
 * keeping those original strings available to render. A decoder can also apply
 * defaults or transforms, so its output may differ from the original data.
 * This module does not cache results or decide how to respond to invalid data.
 *
 * @see docs/core.md#validate-without-stripping-editing-metadata
 * @see docs/loaders.md#published-and-draft-decoders for the server policy.
 */
import { stegaClean } from '@sanity/client/stega'

/** Serializable object keys and array indexes used by every decoder adapter. */
export type SanityValidationPathSegment = string | number

/** Structured issues for app logging/editor UI; messages are not automatically redacted. */
export interface SanityValidationDiagnostic {
	/** Stable machine-readable issue category. */
	code: string
	/** Human-readable issue description. */
	message: string
	/** Path from the query result root to the invalid value. */
	path: readonly SanityValidationPathSegment[]
	/** Adapter or decoder that produced the diagnostic. */
	source?: string
}

/** Check `success` before reading `value`; a failure provides issues, not valid data. */
export type SanityDecodeResult<TValue> =
	| {
			success: true
			value: TValue
			diagnostics: readonly []
	  }
	| {
			success: false
			diagnostics: readonly SanityValidationDiagnostic[]
	  }

/**
 * Check unknown data and return a typed value or validation issues.
 * Implement this yourself or use `/validation/zod`. Return diagnostics for
 * expected content problems; unexpected thrown errors are left to the caller.
 * Do not mutate input or perform side effects: a loader may decode the same raw
 * result twice, and strict preview checks are separate from draft rendering.
 * @see docs/core.md#the-decoder-contract
 */
export interface SanityDataDecoder<TValue> {
	decode: (
		input: unknown,
	) => SanityDecodeResult<TValue> | Promise<SanityDecodeResult<TValue>>
}

/** Original data alongside its validation result; parsed output lives only in `result`. */
export interface SanityDataValidation<TData, TValue> {
	/** Original query result, including Stega metadata when previewing. */
	data: TData
	/** Validation of a separate, Stega-clean shadow value. */
	result: SanityDecodeResult<TValue>
}

/** Choose how to prepare the decoder's input without replacing the original data. */
export interface ValidateSanityDataOptions<TData> {
	/**
	 * Override the default recursive `stegaClean` operation. Primarily useful
	 * for custom encodings and isolated tests.
	 */
	clean?: (data: TData) => unknown
}

/** Return the supplied decoder while preserving its inferred output type; adds no checks. */
export function defineSanityDataDecoder<TValue>(
	decoder: SanityDataDecoder<TValue>,
): SanityDataDecoder<TValue> {
	return decoder
}

/**
 * Validate a clean shadow of a Sanity query result without mutating or
 * replacing the render value. This keeps Stega metadata intact for Visual
 * Editing while giving decoders ordinary strings and objects.
 *
 * Route loaders call this with the strict published decoder even in preview;
 * their separate preview decoder receives raw data directly. Sitemap loaders
 * use the decoded result through `requireValidSanityData`. This function does
 * not catch decoder exceptions or enforce a success/failure policy.
 * @see docs/core.md#validate-without-stripping-editing-metadata
 */
export async function validateSanityData<TData, TValue>(
	data: TData,
	decoder: SanityDataDecoder<TValue>,
	options: ValidateSanityDataOptions<TData> = {},
): Promise<SanityDataValidation<TData, TValue>> {
	const cleanData = options.clean ? options.clean(data) : stegaClean(data)
	const result = await decoder.decode(cleanData)

	return { data, result }
}

/**
 * Thrown when `requireValidSanityData` receives failed validation, including in
 * the sitemap loader. Page loaders use their own generic HTTP errors instead.
 * Diagnostics are for server logs or authorized editor UI, not automatic public JSON.
 */
export class SanityDataValidationError extends Error {
	readonly code = 'SANITY_DATA_INVALID'

	constructor(
		readonly diagnostics: readonly SanityValidationDiagnostic[],
		message = 'Sanity data failed validation.',
	) {
		super(message)
		this.name = 'SanityDataValidationError'
	}
}

/**
 * Return a decoder's parsed value or throw `SanityDataValidationError`.
 * In preview, callers may instead inspect diagnostics and render tolerant data.
 * Returns decoder transforms/defaults, not `validation.data`. Used by sitemap
 * fetching and available to apps building non-router data boundaries.
 * @see docs/core.md#how-other-subsystems-use-core
 */
export function requireValidSanityData<TData, TValue>(
	validation: SanityDataValidation<TData, TValue>,
): TValue {
	if (!validation.result.success) {
		throw new SanityDataValidationError(validation.result.diagnostics)
	}

	return validation.result.value
}
