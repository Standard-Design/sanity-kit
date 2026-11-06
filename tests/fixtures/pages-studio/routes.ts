/** App-owned fixture registration. The eventual pagesTool accepts this metadata. */
import {
	createPagesRegistry,
	type PagesRouteConfig,
} from '../../../src/studio/pages/registry.js'

export const proofRoutes = {
	pages: [
		{ schemaType: 'kitProofPage', pathnameField: 'pathname.current' },
		{ schemaType: 'kitProofLanding', pathnameField: 'route' },
	],
	collections: [
		{
			name: 'journal',
			title: 'Journal',
			itemsTitle: 'Posts',
			index: { schemaType: 'kitProofPage', pathname: '/journal' },
			routePrefix: '/journal',
			items: [
				{ schemaType: 'kitProofPost', pathnameField: 'pathname.current' },
			],
		},
		{
			name: 'articles',
			title: 'Articles',
			itemsTitle: 'Articles',
			index: { schemaType: 'kitProofPage', pathname: '/articles' },
			routePrefix: '/articles',
			items: [
				{ schemaType: 'kitProofCollectionArticle', slugField: 'slug.current' },
			],
		},
	],
	// This fixture owns its homepage. An app-owned homepage would use ['/'].
	excludePaths: [],
} satisfies PagesRouteConfig
export const proofRegistry = createPagesRegistry(proofRoutes)
