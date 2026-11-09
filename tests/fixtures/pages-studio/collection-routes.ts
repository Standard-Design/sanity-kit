/**
 * The live routing proof keeps legacy Journal URLs intact. Articles use their
 * settings document; publishing an item never publishes that collection prefix.
 * Shared by the Studio and the local website, with no schema or React imports.
 */
import type { CollectionRoutingConfig } from '../../../src/url/settings/resolve.js'
import { proofRoutes } from './routes.js'

export const proofLiveCollectionRouting: CollectionRoutingConfig = {
	...proofRoutes,
	collections: proofRoutes.collections.map((collection) =>
		collection.name === 'articles'
			? {
					...collection,
					settingsDocumentId: 'kitProofArticleRouting',
					displayName: { mode: 'default', value: 'Articles' },
					routePrefix: { mode: 'default', value: '/articles' },
				}
			: collection,
	),
}
