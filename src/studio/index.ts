/**
 * Studio-only entry point. Do not re-export this from the package root or any
 * frontend entry: importing it loads Sanity's native Studio runtime.
 */
export { pagesTool } from './pages/plugin.js'
export type { PagesToolOptions, PagesCreateOptions } from './pages/runtime.js'
export type {
	PagesRouteConfig,
	PageTypeDefinition,
	PageCollectionDefinition,
} from './pages/registry.js'
