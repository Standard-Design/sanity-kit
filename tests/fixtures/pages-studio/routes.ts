/** App-owned fixture registration. The eventual pagesTool accepts this metadata. */
import { createPagesRegistry } from '../../../src/studio/pages/registry.js'

export const proofRegistry = createPagesRegistry({
	pages: [
		{ schemaType: 'kitProofPage', pathnameField: 'pathname.current' },
		{ schemaType: 'kitProofLanding', pathnameField: 'route' },
	],
	collections: [
		{
			name: 'journal',
			title: 'Journal',
			overview: { schemaType: 'kitProofPage', pathname: '/journal' },
			routePrefix: '/journal',
			items: [
				{ schemaType: 'kitProofPost', pathnameField: 'pathname.current' },
			],
		},
	],
	// This fixture owns its homepage. An app-owned homepage would use ['/'].
	excludePaths: [],
})
