/**
 * Studio-only entry point. Do not re-export this from the package root or any
 * frontend entry: importing it loads Sanity's native Studio runtime.
 */
export { pagesTool } from './pages/plugin.js'
export type {
	PagesToolOptions,
	PagesCreateOptions,
	PagesCollectionUiOptions,
} from './pages/runtime.js'
export type {
	PagesRouteConfig,
	PageTypeDefinition,
	PageCollectionDefinition,
	PageCollectionItemDefinition,
} from './pages/registry.js'

export {
	defineSanityUrlField,
	type SanityUrlFieldDefinition,
} from './url/field.js'
export {
	withUrlPublication,
	type UrlPublicationPluginOptions,
} from './url/publication-plugin.js'
export {
	withCollectionRoutingSettings,
	collectionRoutingSettingsItem,
	collectionRoutingSettingsItems,
	type CollectionRoutingSettingsOptions,
} from './collections/settings.js'
export { redirectManagementItem } from './redirects/schema.js'
