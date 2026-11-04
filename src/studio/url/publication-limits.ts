/** Measured bounds for publication notices; never permission to split a write. */
export interface UrlPublicationLimit {
	readonly kind:
		| 'redirect-records'
		| 'redirect-updates'
		| 'redirect-bytes'
		| 'publication-bytes'
	readonly actual: number
	readonly maximum: number
	readonly measurement: 'exact' | 'at-least' | 'estimated'
	readonly phase: 'current' | 'proposed'
}

const fields = new Set([
	'_id',
	'_type',
	'_rev',
	'_createdAt',
	'_updatedAt',
	'source',
	'destination',
	'status',
	'enabled',
	'origin',
])
const encoder = new TextEncoder()

/**
 * Measure the raw projected envelope without serializing arbitrary nested data.
 * Stop once the limit is crossed. The returned lower bound is the bytes already
 * counted, not a pretend exact total. A huge string uses its code-unit length as
 * a safe UTF-8 JSON lower bound without allocating another huge string.
 */
export function measureRedirectInventory(
	rows: readonly Record<string, unknown>[],
	maximum: number,
):
	| { readonly actual: number; readonly measurement: 'exact' | 'at-least' }
	| undefined {
	let bytes = encoder.encode(
		JSON.stringify({ perspective: 'published', complete: true, records: [] }),
	).length
	for (const [index, row] of rows.entries()) {
		const keys = Object.keys(row)
		if (keys.length > fields.size || keys.some((key) => !fields.has(key)))
			return undefined
		bytes += (index ? 1 : 0) + 2
		for (const [position, key] of keys.entries()) {
			const value = row[key]
			if (
				value !== null &&
				typeof value !== 'string' &&
				typeof value !== 'number' &&
				typeof value !== 'boolean'
			)
				return undefined
			if (typeof value === 'number' && !Number.isFinite(value)) return undefined
			bytes +=
				(position ? 1 : 0) + encoder.encode(JSON.stringify(key)).length + 1
			if (typeof value === 'string' && value.length > maximum)
				return { actual: bytes + value.length + 2, measurement: 'at-least' }
			bytes += encoder.encode(JSON.stringify(value)).length
			if (bytes > maximum) return { actual: bytes, measurement: 'at-least' }
		}
	}
	return { actual: bytes, measurement: 'exact' }
}
