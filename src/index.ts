/**
 * Start here for public configuration and validation without a framework.
 * The package root exports the same API as `/core`.
 *
 * Import other features from their own entrypoints: `/image`, `/image/react`,
 * `/link`, `/sitemap`, `/react-router`, `/react-router/visual-editing`,
 * `/react-router/server`, and `/validation/zod`. Do not re-export their runtime
 * implementations here: that would make basic consumers load dependencies they
 * did not choose, or expose server code to the browser. Packed-consumer tests
 * protect this separation.
 *
 * Guide paths in source comments are relative to the repository/package root.
 * @see docs/README.md for the subsystem map and shared terminology.
 * @see docs/core.md for configuration and decoder examples.
 */
export { defineSanityConfig, type SanityPublicConfig } from './core/index.js'
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
} from './core/index.js'
