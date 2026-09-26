import { getAssetDocumentId, parseImageAssetId } from '@sanity/asset-utils'
import { stegaClean } from '@sanity/client/stega'
import type {
	SanityImageCrop,
	SanityImageHotspot,
	SanityImageObject,
	SanityImageRect,
} from '@sanity/image-url'

/** Ready to spread into a configured SanityImage; dimensions are ORIGINAL pixels. */
export interface PreparedSanityImage {
	value: SanityImageObject & { crop: SanityImageCrop }
	intrinsicWidth: number
	intrinsicHeight: number
}

export type SanityImagePreparationFailure =
	| 'missing-asset'
	| 'invalid-asset'
	| 'invalid-dimensions'
	| 'invalid-crop'
	| 'empty-crop'

export type SanityImagePreparationResult =
	| { success: true; image: PreparedSanityImage }
	| { success: false; reason: SanityImagePreparationFailure }

/**
 * Prepare standard Sanity image sources, including incomplete draft data.
 * Resolves identity and original dimensions from the asset ID, not metadata.
 * Returns a new minimal source; never mutates input or chooses a serving origin.
 * Partial crops default missing edges to zero. Unusable hotspots are omitted.
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

/** Internal: mirror @sanity/image-url's editorial-crop pixel rounding. */
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

function isFraction(value: unknown): value is number {
	return (
		typeof value === 'number' &&
		Number.isFinite(value) &&
		value >= 0 &&
		value <= 1
	)
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
