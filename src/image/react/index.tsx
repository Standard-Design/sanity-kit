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
	type SanityImageConfig,
	type SanityImageUrlOptions,
} from '../index.js'

export const defaultSanityImageWidths = [
	320, 480, 640, 768, 960, 1200, 1600, 1920, 2400,
] as const

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

type NativeImageProps = Omit<
	ImgHTMLAttributes<HTMLImageElement>,
	'alt' | 'height' | 'src' | 'srcSet' | 'width'
>

export interface SanityImageProps extends NativeImageProps {
	/** Sanity image value passed intact to the URL builder. */
	value: SanityImageSource
	/** Required accessible alternative text. Use an empty string when decorative. */
	alt: string
	/** Original source width from Sanity asset metadata. */
	intrinsicWidth: number
	/** Original source height from Sanity asset metadata. */
	intrinsicHeight: number
	/** Optional output crop ratio. */
	aspectRatio?: number | string
	/** Optional background color shown while the image loads. */
	placeholderColor?: string | null
}

/**
 * Create a CSS-free responsive image component around explicit Sanity image
 * configuration. Construct it at module scope so the component identity stays
 * stable between renders.
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

			const candidateWidths = createResponsiveSanityImageWidths(
				configuredWidths,
				intrinsicWidth,
			)
			const largestWidth = candidateWidths.at(-1)
			if (largestWidth === undefined) {
				throw new TypeError(
					'[sanity-kit] Responsive image widths must not be empty.',
				)
			}

			const ratio =
				aspectRatio === undefined
					? intrinsicWidth / intrinsicHeight
					: parseSanityImageAspectRatio(aspectRatio)
			const outputHeight = Math.round(largestWidth / ratio)
			const buildUrl = (width: number) =>
				images.buildUrl(value, createUrlOptions(config, width, aspectRatio))
			const src = buildUrl(largestWidth)
			const srcSet = candidateWidths
				.map((width) => `${buildUrl(width)} ${width}w`)
				.join(', ')

			if (fetchPriority === 'high') {
				preload(src, {
					as: 'image',
					fetchPriority: 'high',
					imageSizes: sizes,
					imageSrcSet: srcSet,
				})
			}

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

/** Return sorted, unique candidate widths capped at the source and configured maximum. */
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

function createUrlOptions(
	config: CreateSanityImageComponentConfig,
	width: number,
	aspectRatio: number | string | undefined,
): SanityImageUrlOptions {
	return {
		width,
		...(aspectRatio === undefined ? {} : { aspectRatio }),
		...(config.autoFormat === undefined
			? {}
			: { autoFormat: config.autoFormat }),
		...(config.fit === undefined ? {} : { fit: config.fit }),
		...(config.quality === undefined ? {} : { quality: config.quality }),
	}
}

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

function assertPositiveInteger(value: number, name: string): void {
	if (!Number.isInteger(value) || value <= 0) {
		throw new TypeError(`[sanity-kit] \`${name}\` must be a positive integer.`)
	}
}
