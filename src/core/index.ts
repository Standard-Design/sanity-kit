/**
 * Shared foundation, also re-exported by the package root.
 *
 * `config.ts` checks public settings. `validation.ts` defines the decoder
 * contract shared by page loaders, sitemap loaders, and the optional Zod adapter.
 * Keep these exports independent of React, React Router, Zod, image builders,
 * and clients carrying secrets. Callers supply settings; nothing reads the
 * application's environment variables.
 *
 * @see docs/core.md for the public API and its role in other subsystems.
 */
export { defineSanityConfig, type SanityPublicConfig } from './config.js'
export {
	defineSanityDataDecoder,
	requireValidSanityData,
	SanityDataValidationError,
	validateSanityData,
	type SanityDataDecoder,
	type SanityDataValidation,
	type SanityDecodeResult,
	type SanityValidationDiagnostic,
	type SanityValidationPathSegment,
	type ValidateSanityDataOptions,
} from './validation.js'
