/**
 * Isolated draft-settings proof. Existing Journal fixtures store full paths;
 * keep them intact while demonstrating the settings-backed, slug-only contract.
 * These routes do not drive Pages or the preview server yet.
 */
import { defineField, defineType } from 'sanity'
import type { CollectionRoutingConfig } from '../../../src/url/settings/resolve.js'
import { proofRoutes } from './routes.js'

export const proofCollectionSettingsRoutes: CollectionRoutingConfig = {
	pages: proofRoutes.pages,
	collections: [
		{
			name: 'journal',
			title: 'Journal (settings proof)',
			routePrefix: { documentId: 'kitProofJournalRouting' },
			overview: { schemaType: 'kitProofPage', pathname: '/journal' },
			items: [{ schemaType: 'kitProofSlugPost', slugField: 'slug.current' }],
		},
	],
}

export const proofSlugPost = defineType({
	name: 'kitProofSlugPost',
	title: 'Proof slug post',
	type: 'document',
	fields: [
		defineField({ name: 'title', type: 'string' }),
		defineField({ name: 'slug', type: 'slug', options: { source: 'title' } }),
	],
})
