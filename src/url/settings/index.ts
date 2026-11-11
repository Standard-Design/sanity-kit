/**
 * Read collection routing settings with the application’s client. This separate
 * entry loads GROQ; pure URL resolution remains available from /url without it.
 * The caller owns credentials, preview authorization, and any caching.
 * @see docs/collection-routing-api.md for both perspectives and failure handling.
 */
export { createCollectionRoutingLoader } from './load.js'
export type {
	CollectionSettingsClient,
	CollectionSettingsLoadRequest,
	CollectionSettingsLoadResult,
	CollectionSettingsPairResult,
} from './load.js'
