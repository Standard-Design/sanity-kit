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
 * Define and validate configuration that is safe to expose to the browser.
 *
 * Secrets deliberately do not belong in this contract. Server entrypoints
 * accept their own secret configuration so importing `core` can never pull a
 * token into a browser graph.
 */
export function defineSanityConfig<const TConfig extends SanityPublicConfig>(
	config: TConfig,
): Readonly<TConfig> {
	assertNonEmpty(config.projectId, 'projectId')
	assertNonEmpty(config.dataset, 'dataset')

	if (!apiVersionPattern.test(config.apiVersion)) {
		throw new TypeError(
			'[sanity-kit] `apiVersion` must use the YYYY-MM-DD format.',
		)
	}

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

function assertNonEmpty(value: string, name: string): void {
	if (value.trim().length === 0) {
		throw new TypeError(`[sanity-kit] \`${name}\` must not be empty.`)
	}
}
