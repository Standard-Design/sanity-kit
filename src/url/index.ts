/**
 * Framework-independent URL resolution. No Studio, React, client creation, or
 * network reads: callers supply documents from their chosen perspective.
 * @see docs/url.md for configuration, results, and current limitations.
 */
export { createSanityUrlResolver } from './resolve.js'
export type {
	SanityResolvedUrl,
	SanityUrlResult,
	SanityUrlFailureReason,
	SanityUrlResolver,
} from './resolve.js'
export type {
	PagesRouteConfig,
	PageTypeDefinition,
	PageCollectionItemDefinition,
	PageCollectionDefinition,
} from './registry.js'

/** Resolve settings already loaded by the app; this entry never fetches them. */
export { createCollectionRouting } from './settings/resolve.js'
export type {
	CollectionRoutingConfig,
	SettingsCollectionDefinition,
	CollectionSettingValue,
	RoutingSettingsSnapshot,
	RoutingPerspective,
	ResolvedCollectionSetting,
	CollectionRoutingResult,
} from './settings/resolve.js'
