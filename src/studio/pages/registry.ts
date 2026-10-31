/**
 * Studio's private import bridge to the shared URL registration. Keeping one
 * implementation prevents frontend links and Presentation ownership checks from
 * drifting apart. This file does not load the Studio runtime.
 * @see docs/url.md
 */
export {
	assertFieldPath,
	createPagesRegistry,
	pagePathname,
	pageSlug,
	registeredPathname,
	storedPagePathname,
	validatePagesSchema,
} from '../../url/registry.js'
export type {
	PageTypeDefinition,
	PageCollectionItemDefinition,
	PageCollectionDefinition,
	PagesRouteConfig,
	RegisteredPageType,
	PagesRegistry,
} from '../../url/registry.js'
