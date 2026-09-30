/**
 * Check the public settings used by browser code and server factories.
 * `createSanityKit` selects these fields before calling this validator; image
 * helpers use their smaller, independent project/dataset configuration.
 * These checks do not contact Sanity or verify access to a project or dataset.
 *
 * @see docs/core.md#public-configuration for setup and secret-handling rules.
 */

/** Public connection identifiers; never put a read token or session secret here. */
export interface SanityPublicConfig {
	/** Sanity Content Lake project identifier. */
	projectId: string
	/** Dataset to query. */
	dataset: string
	/** Explicit date-based Sanity API version in YYYY-MM-DD format. */
	apiVersion: string
	/** Absolute Studio URL used by Presentation and Stega overlays. */
	studioUrl?: string
}

const apiVersionPattern = /^\d{4}-\d{2}-\d{2}$/u

/**
 * Check public configuration and return a shallow-frozen copy.
 *
 * Supply only public fields when this value will reach the browser. Server
 * factories accept tokens and signing secrets separately.
 *
 * Literal types and extra fields are preserved; this is not a secret filter.
 * A token passed as an extra property will still be in the result. Nested extra
 * objects are not frozen. Values are checked, not trimmed or rewritten.
 *
 * @throws TypeError for missing/blank strings, invalid dates, or relative Studio URLs.
 * @see docs/core.md#public-configuration
 */
export function defineSanityConfig<const TConfig extends SanityPublicConfig>(
	config: TConfig,
): Readonly<TConfig> {
	assertNonEmpty(config.projectId, 'projectId')
	assertNonEmpty(config.dataset, 'dataset')
	assertNonEmpty(config.apiVersion, 'apiVersion')

	if (!apiVersionPattern.test(config.apiVersion)) {
		throw new TypeError(
			'[sanity-kit] `apiVersion` must use the YYYY-MM-DD format.',
		)
	}

	// JavaScript can turn an impossible day into a date in the next month.
	// Compare the parsed date with the input so that cannot change the API version.
	const parsedApiVersion = new Date(`${config.apiVersion}T00:00:00.000Z`)
	if (
		Number.isNaN(parsedApiVersion.getTime()) ||
		parsedApiVersion.toISOString().slice(0, 10) !== config.apiVersion
	) {
		throw new TypeError(
			'[sanity-kit] `apiVersion` must be a valid calendar date.',
		)
	}

	if (config.studioUrl !== undefined) {
		assertNonEmpty(config.studioUrl, 'studioUrl')
		try {
			new URL(config.studioUrl)
		} catch {
			throw new TypeError('[sanity-kit] `studioUrl` must be an absolute URL.')
		}
	}

	return Object.freeze({ ...config })
}

/** Check the value's type before using string methods; errors name fields, not values. */
function assertNonEmpty(value: unknown, name: string): void {
	if (typeof value !== 'string') {
		throw new TypeError(`[sanity-kit] \`${name}\` must be a string.`)
	}
	if (value.trim().length === 0) {
		throw new TypeError(`[sanity-kit] \`${name}\` must not be empty.`)
	}
}
