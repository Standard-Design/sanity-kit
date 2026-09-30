/**
 * Check image content before rendering, including unfinished draft images.
 *
 * Publicly re-exported from `/image`; `/image/react` calls it before rendering.
 * Applications can call it earlier to omit unusable drafts or render a fallback.
 * Expected content problems return a failure reason instead of throwing. A
 * success contains the asset, usable crop/hotspot, and original dimensions—not
 * alt text, captions, or placeholder UI. The app chooses how to handle failure.
 *
 * @see docs/image.md#prepare-unknown-or-incomplete-image-data
 * @see docs/image-react.md#prepare-and-render-an-image
 */
import { getAssetDocumentId, parseImageAssetId } from '@sanity/asset-utils'
import { stegaClean } from '@sanity/client/stega'
import type {
	SanityImageCrop,
	SanityImageHotspot,
	SanityImageObject,
	SanityImageRect,
} from '@sanity/image-url'

/** Ready to spread into SanityImage; dimensions describe the asset before cropping. */
export interface PreparedSanityImage {
	value: SanityImageObject & { crop: SanityImageCrop }
	intrinsicWidth: number
	intrinsicHeight: number
}

/**
 * Failure reasons an app can use to choose a placeholder or an editor message.
 * Missing includes an upload without an asset; invalid-asset covers unsupported
 * identities; invalid-dimensions covers an unusable size encoded in that ID;
 * invalid-crop is malformed fractional data; empty-crop retains no usable pixels.
 * @see docs/image.md#failure-results
 */
export type SanityImagePreparationFailure =
	| 'missing-asset'
	| 'invalid-asset'
	| 'invalid-dimensions'
	| 'invalid-crop'
	| 'empty-crop'

/** Check `success` before passing `image` to the configured React component. */
export type SanityImagePreparationResult =
	| { success: true; image: PreparedSanityImage }
	| { success: false; reason: SanityImagePreparationFailure }

/**
 * Prepare standard Sanity image sources, including incomplete draft data.
 * Resolves identity and original dimensions from the asset ID, not metadata.
 * Returns a new minimal source; never mutates input or chooses a serving origin.
 * Partial crops default missing edges to zero. Unusable hotspots are omitted.
 *
 * Accepts an asset ID/URL/path, reference/asset object, or image object containing
 * an asset. Explicit IDs take precedence over URL metadata. The upstream parser
 * requires real Sanity-style IDs, including the full hash; synthetic shortened
 * IDs in fixtures are not a supported format.
 * These checks do not fetch the asset or validate component width/ratio settings.
 * @see docs/image.md#asset-identity-and-origin
 * @see docs/image.md#crop-and-hotspot-handling
 *
 * @example
 * const result = prepareSanityImage(document.heroImage)
 * if (!result.success) return null // Application-selected fallback.
 * // Pass result.image.value/intrinsicWidth/intrinsicHeight to SanityImage.
 */
export function prepareSanityImage(
	source: unknown,
): SanityImagePreparationResult {
	const object = isRecord(source) ? source : undefined
	const asset = object && 'asset' in object ? object.asset : source
	if (asset == null || (object?._upload && !object.asset)) {
		return { success: false, reason: 'missing-asset' }
	}

	// Resolve just the identity: prefer an explicit reference/ID over a URL, and
	// never let a malformed explicit ID silently fall back to a document URL.
	const identity = isRecord(asset)
		? (asset._ref ?? asset._id ?? asset.url ?? asset.path)
		: asset
	if (typeof identity !== 'string') {
		return { success: false, reason: 'invalid-asset' }
	}
	let id: string
	try {
		id = getAssetDocumentId(stegaClean(identity))
	} catch {
		return { success: false, reason: 'invalid-asset' }
	}
	if (!id.startsWith('image-'))
		return { success: false, reason: 'invalid-asset' }
	let width: number
	let height: number
	try {
		;({ width, height } = parseImageAssetId(id))
	} catch {
		return { success: false, reason: 'invalid-dimensions' }
	}
	if (![width, height].every((n) => Number.isSafeInteger(n) && n > 0)) {
		return { success: false, reason: 'invalid-dimensions' }
	}

	const rawCrop = object?.crop
	if (rawCrop != null && !isRecord(rawCrop)) {
		return { success: false, reason: 'invalid-crop' }
	}
	const edges = ['left', 'top', 'right', 'bottom'] as const
	const crop: SanityImageCrop = { left: 0, top: 0, right: 0, bottom: 0 }
	for (const edge of edges) {
		const fraction = rawCrop?.[edge] ?? 0
		if (!isFraction(fraction)) return { success: false, reason: 'invalid-crop' }
		crop[edge] = fraction
	}
	if (crop.left + crop.right >= 1 || crop.top + crop.bottom >= 1) {
		return { success: false, reason: 'empty-crop' }
	}
	// Valid fractions can still remove every pixel of a tiny image after rounding.
	// Reject that now so the React component never gets an empty crop rectangle.
	const rect = getSanityImageCropRect(width, height, crop)
	if (rect.width < 1 || rect.height < 1) {
		return { success: false, reason: 'empty-crop' }
	}
	const hotspot = normalizeHotspot(object?.hotspot)
	return {
		success: true,
		image: {
			value: { asset: { _ref: id }, crop, ...(hotspot ? { hotspot } : {}) },
			intrinsicWidth: width,
			intrinsicHeight: height,
		},
	}
}

/**
 * Calculate the pixels left after the editor's crop. Preparation uses this to
 * reject empty crops; the React component uses the same calculation to choose
 * widths and a natural aspect ratio. Rounding left/top before the remaining
 * dimensions matches Sanity's URL builder and prevents the two callers drifting.
 * This internal export does not position hotspots or select an output fit mode,
 * and is not exposed by the public `/image` entrypoint.
 * @see docs/image-react.md#how-responsive-sizing-works for the formula.
 */
export function getSanityImageCropRect(
	width: number,
	height: number,
	crop: SanityImageCrop,
): SanityImageRect {
	const left = Math.round(crop.left * width)
	const top = Math.round(crop.top * height)
	return {
		left,
		top,
		width: Math.round(width - crop.right * width - left),
		height: Math.round(height - crop.bottom * height - top),
	}
}

/**
 * Keep a complete, valid hotspot. An unfinished hotspot should not hide an
 * otherwise usable draft image: omitting it lets Sanity use its centered default.
 * Invalid crops are different because they can leave no pixels to render.
 */
function normalizeHotspot(value: unknown): SanityImageHotspot | undefined {
	if (!isRecord(value)) return undefined
	const { x, y, width, height } = value
	if (
		!isFraction(x) ||
		!isFraction(y) ||
		!isFraction(width) ||
		!isFraction(height) ||
		width === 0 ||
		height === 0
	)
		return undefined
	return { x, y, width, height }
}

/** Inclusive normalized-coordinate guard; hotspot dimensions separately reject zero. */
function isFraction(value: unknown): value is number {
	return (
		typeof value === 'number' &&
		Number.isFinite(value) &&
		value >= 0 &&
		value <= 1
	)
}

/** Distinguish image/reference records from null, arrays, and primitive sources. */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
