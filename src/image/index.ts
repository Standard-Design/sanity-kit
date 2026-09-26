import {
	createImageUrlBuilder,
	type FitMode,
	type ImageUrlBuilder,
	type SanityImageSource,
} from '@sanity/image-url'

export interface SanityImageConfig {
	projectId: string
	dataset: string
	/** Override the default Sanity image CDN base URL. */
	baseUrl?: string
}

export interface SanityImageUrlOptions {
	/** Requested output width in whole CSS pixels. */
	width?: number
	/** Requested output height in whole CSS pixels. */
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

export interface SanityImageTools {
	/** Start a native Sanity image URL builder chain. */
	urlFor: (source: SanityImageSource) => ImageUrlBuilder
	/** Build a URL with validated common sizing options. */
	buildUrl: (
		source: SanityImageSource,
		options?: SanityImageUrlOptions,
	) => string
}

/** Create image URL helpers from explicit, browser-safe configuration. */
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

			const hasSizedCrop =
				options.height !== undefined || options.aspectRatio !== undefined
			const fit = options.fit ?? (hasSizedCrop ? 'crop' : undefined)
			if (fit !== undefined) image = image.fit(fit)

			if (options.autoFormat !== false) image = image.auto('format')

			return image.url()
		},
	}
}

/** Parse and validate a positive image aspect ratio. */
export function parseSanityImageAspectRatio(value: number | string): number {
	if (typeof value === 'number') {
		assertPositiveFinite(value, 'aspectRatio')
		return value
	}

	const parts = value.split('/')
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

	return width / height
}

function assertPixelDimension(value: number, name: string): void {
	if (!Number.isInteger(value) || value <= 0) {
		throw new TypeError(`[sanity-kit] \`${name}\` must be a positive integer.`)
	}
}

function assertPositiveFinite(value: number, name: string): void {
	if (!Number.isFinite(value) || value <= 0) {
		throw new TypeError(
			`[sanity-kit] \`${name}\` must be a positive finite number.`,
		)
	}
}

function assertNonEmpty(value: unknown, name: string): void {
	if (typeof value !== 'string') {
		throw new TypeError(`[sanity-kit] \`${name}\` must be a string.`)
	}
	if (value.trim().length === 0) {
		throw new TypeError(`[sanity-kit] \`${name}\` must not be empty.`)
	}
}
