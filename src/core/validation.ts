import { stegaClean } from '@sanity/client/stega'

export type SanityValidationPathSegment = string | number

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

export interface SanityDataDecoder<TValue> {
	decode: (
		input: unknown,
	) => SanityDecodeResult<TValue> | Promise<SanityDecodeResult<TValue>>
}

export interface SanityDataValidation<TData, TValue> {
	/** Original query result, including Stega metadata when previewing. */
	data: TData
	/** Validation of a separate, Stega-clean shadow value. */
	result: SanityDecodeResult<TValue>
}

export interface ValidateSanityDataOptions<TData> {
	/**
	 * Override the default recursive `stegaClean` operation. Primarily useful
	 * for custom encodings and isolated tests.
	 */
	clean?: (data: TData) => unknown
}

/** Identity helper that preserves a decoder's inferred output type. */
export function defineSanityDataDecoder<TValue>(
	decoder: SanityDataDecoder<TValue>,
): SanityDataDecoder<TValue> {
	return decoder
}

/**
 * Validate a clean shadow of a Sanity query result without mutating or
 * replacing the render value. This keeps Stega metadata intact for Visual
 * Editing while giving decoders ordinary strings and objects.
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

/** Error used by strict published-data boundaries. */
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
 * Return a decoder's parsed value or throw a structured validation error.
 * Preview integrations should normally return diagnostics instead.
 */
export function requireValidSanityData<TData, TValue>(
	validation: SanityDataValidation<TData, TValue>,
): TValue {
	if (!validation.result.success) {
		throw new SanityDataValidationError(validation.result.diagnostics)
	}

	return validation.result.value
}
