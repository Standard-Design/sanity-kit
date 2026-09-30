/**
 * Prepare Sanity image data and build URLs without requiring React.
 *
 * `prepare.ts` turns unknown CMS input into a usable source and original asset
 * dimensions. `createSanityImageTools` builds URLs. `/image/react` combines them
 * and limits responsive images to the pixels left after cropping.
 * These lower-level URL tools do not cap dimensions or fetch assets. The app
 * supplies configuration and owns alt text, layout, and custom proxy origins.
 *
 * @see docs/image.md for URL options and preparation results.
 * @see docs/image-react.md for responsive rendering and pixel limits.
 */
import {
	createImageUrlBuilder,
	type FitMode,
	type ImageUrlBuilder,
	type SanityImageSource,
} from '@sanity/image-url'

export {
	prepareSanityImage,
	type PreparedSanityImage,
	type SanityImagePreparationFailure,
	type SanityImagePreparationResult,
} from './prepare.js'

/** Shared by the low-level builder and configured React image component. */
export interface SanityImageConfig {
	/** Project owning the source assets; no API token is needed to construct URLs. */
	projectId: string
	/** Dataset owning the source assets. */
	dataset: string
	/** Override the default Sanity image CDN base URL. */
	baseUrl?: string
}

/** Common builder options; use `urlFor` for upstream transformations not listed here. */
export interface SanityImageUrlOptions {
	/** Requested encoded-image width in whole pixels, not the CSS layout width. */
	width?: number
	/** Requested encoded-image height in whole pixels, not the CSS layout height. */
	height?: number
	/**
	 * Positive ratio as a number or `width/height` string. Requires `width`
	 * and cannot be combined with an explicit `height`.
	 */
	aspectRatio?: number | string
	/** Sanity CDN fitting strategy. Defaults to `crop` for sized crops. */
	fit?: FitMode
	/** Integer from 0 through 100. */
	quality?: number
	/** Request automatic WebP/AVIF negotiation. Defaults to true. */
	autoFormat?: boolean
}

/** Two ways to build a URL; neither performs an HTTP request. */
export interface SanityImageTools {
	/** Start a native Sanity image URL builder chain. */
	urlFor: (source: SanityImageSource) => ImageUrlBuilder
	/** Build a URL with validated common sizing options. */
	buildUrl: (
		source: SanityImageSource,
		options?: SanityImageUrlOptions,
	) => string
}

/**
 * Create image URL helpers from explicit, browser-safe configuration.
 * Each call starts a separate Sanity builder chain. The React adapter creates
 * these tools once and uses them for src, srcSet, and preload URLs so every
 * rendition uses the same configured CDN or proxy base URL.
 *
 * `buildUrl` validates common options and defaults to automatic format selection;
 * `urlFor` exposes the native builder without these defaults or validation.
 * Neither caps requests against source dimensions; use `/image/react` for that.
 * @throws TypeError for invalid identifiers or common sizing/quality options.
 * @see docs/image.md#configure-the-url-builder
 */
export function createSanityImageTools(
	config: SanityImageConfig,
): SanityImageTools {
	assertNonEmpty(config.projectId, 'projectId')
	assertNonEmpty(config.dataset, 'dataset')

	const builder = createImageUrlBuilder(config)
	const urlFor = (source: SanityImageSource) => builder.image(source)

	return {
		urlFor,
		buildUrl(source, options = {}) {
			let image = urlFor(source)

			if (options.width !== undefined) {
				assertPixelDimension(options.width, 'width')
				image = image.width(options.width)
			}

			if (options.height !== undefined) {
				assertPixelDimension(options.height, 'height')
				image = image.height(options.height)
			}

			if (options.aspectRatio !== undefined) {
				if (options.height !== undefined) {
					throw new TypeError(
						'[sanity-kit] `aspectRatio` cannot be combined with `height`.',
					)
				}
				if (options.width === undefined) {
					throw new TypeError(
						'[sanity-kit] `aspectRatio` requires an explicit `width`.',
					)
				}

				const ratio = parseSanityImageAspectRatio(options.aspectRatio)
				image = image.height(Math.round(options.width / ratio))
			}

			if (options.quality !== undefined) {
				if (
					!Number.isInteger(options.quality) ||
					options.quality < 0 ||
					options.quality > 100
				) {
					throw new TypeError(
						'[sanity-kit] `quality` must be an integer from 0 through 100.',
					)
				}
				image = image.quality(options.quality)
			}

			// Width alone keeps the editor's crop ratio. Supplying height or a ratio
			// requests a new rectangle, so default to cropping it to fit.
			const hasSizedCrop =
				options.height !== undefined || options.aspectRatio !== undefined
			const fit = options.fit ?? (hasSizedCrop ? 'crop' : undefined)
			if (fit !== undefined) image = image.fit(fit)

			if (options.autoFormat !== false) image = image.auto('format')

			return image.url()
		},
	}
}

/**
 * Shared ratio parser used by buildUrl and the responsive React adapter.
 * Accepts a finite positive number or a two-part fraction such as `16/9`.
 * Checks the quotient too: finite operands can still overflow or underflow.
 * It does not select image dimensions or enforce source-size constraints.
 * @see docs/image.md#configure-the-url-builder for accepted ratio formats.
 */
export function parseSanityImageAspectRatio(value: number | string): number {
	if (typeof value === 'number') {
		assertPositiveFinite(value, 'aspectRatio')
		return value
	}

	const parts = typeof value === 'string' ? value.split('/') : []
	if (parts.length !== 2) {
		throw new TypeError(
			'[sanity-kit] `aspectRatio` must be a positive number or `width/height` string.',
		)
	}

	const width = Number(parts[0]?.trim())
	const height = Number(parts[1]?.trim())
	if (
		!Number.isFinite(width) ||
		width <= 0 ||
		!Number.isFinite(height) ||
		height <= 0
	) {
		throw new TypeError(
			'[sanity-kit] `aspectRatio` must be a positive number or `width/height` string.',
		)
	}

	const ratio = width / height
	assertPositiveFinite(ratio, 'aspectRatio')
	return ratio
}

/** Reject fractional/zero/non-finite explicit output dimensions at URL boundaries. */
function assertPixelDimension(value: number, name: string): void {
	if (!Number.isInteger(value) || value <= 0) {
		throw new TypeError(`[sanity-kit] \`${name}\` must be a positive integer.`)
	}
}

/** Shared numeric guard for numeric ratios and parsed fraction results. */
function assertPositiveFinite(value: number, name: string): void {
	if (!Number.isFinite(value) || value <= 0) {
		throw new TypeError(
			`[sanity-kit] \`${name}\` must be a positive finite number.`,
		)
	}
}

/** Validate browser-supplied identifiers without echoing their contents in errors. */
function assertNonEmpty(value: unknown, name: string): void {
	if (typeof value !== 'string') {
		throw new TypeError(`[sanity-kit] \`${name}\` must be a string.`)
	}
	if (value.trim().length === 0) {
		throw new TypeError(`[sanity-kit] \`${name}\` must not be empty.`)
	}
}
