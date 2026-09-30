/**
 * Responsive React images built on `/image`, for server and browser rendering.
 *
 * Prepare the source, calculate the pixels left after the editor's crop, and
 * choose width candidates that fit those pixels. The official Sanity builder
 * turns each candidate into a URL; this component renders a native img and,
 * when requested, preloads it. The app still chooses alt text, sizes, and layout.
 * No CSS system, framework image service, or hosting-specific API is required.
 *
 * @see docs/image-react.md for the shared-component pattern and sizing rules.
 * @see docs/image.md for source preparation and the lower-level URL builder.
 */
import type {
	ForwardRefExoticComponent,
	ImgHTMLAttributes,
	RefAttributes,
} from 'react'
import { stegaClean } from '@sanity/client/stega'
import type { FitMode, SanityImageSource } from '@sanity/image-url'
import { forwardRef } from 'react'
import { preload } from 'react-dom'
import {
	createSanityImageTools,
	parseSanityImageAspectRatio,
	prepareSanityImage,
	type SanityImageConfig,
	type SanityImageUrlOptions,
} from '../index.js'
import { getSanityImageCropRect } from '../prepare.js'

/** Default width-descriptor candidates; each image is further capped by usable pixels. */
export const defaultSanityImageWidths = [
	320, 480, 640, 768, 960, 1200, 1600, 1920, 2400,
] as const

/** Shared source and output settings; create the configured component once in an app module. */
export interface CreateSanityImageComponentConfig extends SanityImageConfig {
	/** Candidate widths used for generated `srcSet` values. */
	widths?: readonly number[]
	/** Default image quality for this component. */
	quality?: number
	/** Default Sanity CDN fit mode. */
	fit?: FitMode
	/** Request automatic WebP/AVIF negotiation. Defaults to true. */
	autoFormat?: boolean
}

/** The component sets URLs and dimensions; callers choose native events, sizes, and loading. */
type NativeImageProps = Omit<
	ImgHTMLAttributes<HTMLImageElement>,
	'alt' | 'height' | 'src' | 'srcSet' | 'width'
>

/**
 * Per-image input. `PreparedSanityImage` supplies value and intrinsic dimensions;
 * the application must still supply alt text and an accurate layout `sizes` hint.
 * Native `fetchPriority="high"` triggers a matching React DOM preload.
 */
export interface SanityImageProps extends NativeImageProps {
	/** Sanity image source. Editorial crop/hotspot are preserved during preparation. */
	value: SanityImageSource
	/** Required accessible alternative text. Use an empty string when decorative. */
	alt: string
	/** Original source width; must match the asset ID, not the retained crop. */
	intrinsicWidth: number
	/** Original source height; must match the asset ID, not the retained crop. */
	intrinsicHeight: number
	/** Optional output crop ratio. */
	aspectRatio?: number | string
	/** Optional background color shown while the image loads. */
	placeholderColor?: string | null
}

/**
 * Create one responsive image component to import throughout the application.
 * Call this in a shared module, not during rendering: React must see the same
 * component identity on each render. Only minimal inline styles are supplied.
 *
 * The component rejects unusable sources rather than choosing a silent fallback;
 * call `prepareSanityImage` in app rendering/decoding when drafts may be incomplete.
 * Preparation runs again here to protect callers that did not prepare the source.
 * Intrinsic dimensions must describe the original asset. Accepting already-cropped
 * dimensions would count the crop twice and request unnecessarily small images.
 * @throws TypeError for invalid source geometry, ratios, or width configuration.
 * @see docs/image-react.md#prepare-and-render-an-image
 * @see docs/image-react.md#how-responsive-sizing-works
 */
export function createSanityImageComponent(
	config: CreateSanityImageComponentConfig,
): ForwardRefExoticComponent<
	SanityImageProps & RefAttributes<HTMLImageElement>
> {
	const images = createSanityImageTools({
		projectId: config.projectId,
		dataset: config.dataset,
		...(config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl }),
	})
	const configuredWidths = normalizeConfiguredWidths(
		config.widths ?? defaultSanityImageWidths,
	)

	const SanityImage = forwardRef<HTMLImageElement, SanityImageProps>(
		function SanityImage(
			{
				alt,
				aspectRatio,
				decoding = 'async',
				fetchPriority,
				intrinsicHeight,
				intrinsicWidth,
				loading,
				placeholderColor,
				sizes = '100vw',
				style,
				value,
				...imageProps
			},
			ref,
		) {
			assertPositiveInteger(intrinsicWidth, 'intrinsicWidth')
			assertPositiveInteger(intrinsicHeight, 'intrinsicHeight')
			const prepared = prepareSanityImage(value)
			if (!prepared.success) {
				throw new TypeError(
					`[sanity-kit] Unusable image source: ${prepared.reason}. Use prepareSanityImage for incomplete drafts.`,
				)
			}
			if (
				intrinsicWidth !== prepared.image.intrinsicWidth ||
				intrinsicHeight !== prepared.image.intrinsicHeight
			) {
				throw new TypeError(
					'[sanity-kit] `intrinsicWidth` and `intrinsicHeight` must match the original asset dimensions, before cropping.',
				)
			}
			const source = prepared.image.value
			const retained = getSanityImageCropRect(
				intrinsicWidth,
				intrinsicHeight,
				source.crop,
			)
			const ratio =
				aspectRatio === undefined
					? retained.width / retained.height
					: parseSanityImageAspectRatio(aspectRatio)
			// Both axes must fit the pixels left after cropping. For a new ratio,
			// height can be the limiting factor even when plenty of width remains.
			// Sanity's builder still decides where to position the hotspot crop.
			const maximumWidth =
				aspectRatio === undefined
					? retained.width
					: Math.min(retained.width, Math.floor(retained.height * ratio))
			if (maximumWidth < 1) {
				throw new TypeError(
					'[sanity-kit] `aspectRatio` cannot produce a one-pixel-wide image without upscaling.',
				)
			}

			const candidateWidths = createResponsiveSanityImageWidths(
				configuredWidths,
				maximumWidth,
			)
			const largestWidth = candidateWidths.at(-1)
			if (largestWidth === undefined) {
				throw new TypeError(
					'[sanity-kit] Responsive image widths must not be empty.',
				)
			}

			// Reserve layout space at the largest rendition's ratio. For the natural
			// crop ratio, request width only and let Sanity round the crop. A custom
			// ratio needs both dimensions so the builder can fit around the hotspot.
			const heightFor = (width: number) =>
				Math.max(1, Math.round(width / ratio))
			const outputHeight = heightFor(largestWidth)
			const buildUrl = (width: number) =>
				images.buildUrl(
					source,
					createUrlOptions(
						config,
						width,
						aspectRatio === undefined ? undefined : heightFor(width),
					),
				)
			const src = buildUrl(largestWidth)
			const srcSet = candidateWidths
				.map((width) => `${buildUrl(width)} ${width}w`)
				.join(', ')

			// Reuse the exact srcSet/sizes pair: a separate preload rendition could
			// download one resource before the browser selects a different candidate.
			if (fetchPriority === 'high') {
				preload(src, {
					as: 'image',
					fetchPriority: 'high',
					imageSizes: sizes,
					imageSrcSet: srcSet,
				})
			}

			// Set generated URLs/dimensions after caller props so they cannot be replaced.
			// Clean alt metadata because it is not visible click-to-edit text. Caller
			// styles may override the small set of responsive layout defaults.
			return (
				<img
					{...imageProps}
					ref={ref}
					alt={stegaClean(alt)}
					decoding={decoding}
					fetchPriority={fetchPriority}
					height={outputHeight}
					loading={loading ?? (fetchPriority === 'high' ? 'eager' : 'lazy')}
					sizes={sizes}
					src={src}
					srcSet={srcSet}
					style={{
						backgroundColor: placeholderColor ?? undefined,
						height: 'auto',
						maxWidth: '100%',
						...style,
					}}
					width={largestWidth}
				/>
			)
		},
	)

	SanityImage.displayName = 'SanityImage'
	return SanityImage
}

/**
 * Sort and deduplicate widths, then limit them to the available pixels.
 * Always append the effective cap, even if no configured breakpoint equals it;
 * this guarantees a usable rendition for images smaller than the first candidate.
 * The React caller passes a crop/ratio-aware budget as `intrinsicWidth` here,
 * not necessarily the asset's original width. Input arrays are not mutated.
 * @see docs/image-react.md#how-responsive-sizing-works
 */
export function createResponsiveSanityImageWidths(
	widths: readonly number[],
	intrinsicWidth: number,
): number[] {
	assertPositiveInteger(intrinsicWidth, 'intrinsicWidth')
	const normalized = normalizeConfiguredWidths(widths)
	const maximum = normalized.at(-1)
	if (maximum === undefined) {
		throw new TypeError(
			'[sanity-kit] Responsive image widths must not be empty.',
		)
	}

	const cap = Math.min(intrinsicWidth, maximum)
	return [...new Set([...normalized.filter((width) => width < cap), cap])]
}

/** Forward only defined defaults so the low-level builder retains its own defaults. */
function createUrlOptions(
	config: CreateSanityImageComponentConfig,
	width: number,
	height: number | undefined,
): SanityImageUrlOptions {
	return {
		width,
		...(height === undefined ? {} : { height }),
		...(config.autoFormat === undefined
			? {}
			: { autoFormat: config.autoFormat }),
		...(config.fit === undefined ? {} : { fit: config.fit }),
		...(config.quality === undefined ? {} : { quality: config.quality }),
	}
}

/** Copy, validate, deduplicate, and numerically sort caller-owned breakpoints. */
function normalizeConfiguredWidths(widths: readonly number[]): number[] {
	if (widths.length === 0) {
		throw new TypeError(
			'[sanity-kit] Responsive image widths must not be empty.',
		)
	}

	for (const width of widths) {
		assertPositiveInteger(width, 'responsive image width')
	}

	return [...new Set(widths)].sort((left, right) => left - right)
}

/** Dimension guard shared by component props and candidate-width generation. */
function assertPositiveInteger(value: number, name: string): void {
	if (!Number.isInteger(value) || value <= 0) {
		throw new TypeError(`[sanity-kit] \`${name}\` must be a positive integer.`)
	}
}
