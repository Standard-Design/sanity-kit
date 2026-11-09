/**
 * Isolated draft-settings proof. Existing Journal fixtures store full paths;
 * keep them intact while demonstrating the settings-backed, slug-only contract.
 * Articles share their settings with Pages and the preview website. The legacy
 * Journal settings example stays separate from the full-path Journal fixtures.
 */
import { defineField, defineType } from 'sanity'
import type { CollectionRoutingConfig } from '../../../src/url/settings/resolve.js'
import { proofRoutes } from './routes.js'
import { proofLiveCollectionRouting } from './collection-routes.js'
import { defineSanityUrlField } from '../../../src/studio/url/field.js'
import { DocumentIcon } from '@sanity/icons/Document'

export const proofCollectionSettingsRoutes: CollectionRoutingConfig = {
	pages: proofRoutes.pages,
	collections: [
		{
			name: 'journal',
			title: 'Journal (settings proof)',
			displayName: { mode: 'locked', value: 'Journal (settings proof)' },
			settingsDocumentId: 'kitProofJournalRouting',
			routePrefix: {
				mode: 'default',
				value: '/journal',
			},
			index: { schemaType: 'kitProofPage', pathname: '/journal' },
			items: [{ schemaType: 'kitProofSlugPost', slugField: 'slug.current' }],
		},
		proofLiveCollectionRouting.collections!.find(
			(collection) => collection.name === 'articles',
		)!,
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

/** Fresh schema/identity for collection actions; existing Journal data stays intact. */
export const proofCollectionArticle = defineType({
	name: 'kitProofCollectionArticle',
	title: 'Proof collection article',
	type: 'document',
	icon: DocumentIcon,
	fields: [
		defineField({ name: 'title', type: 'string' }),
		defineSanityUrlField({
			name: 'slug',
			title: 'URL',
			routes: proofRoutes,
			collectionRouting: proofLiveCollectionRouting,
			options: { source: 'title' },
		}),
		defineField({ name: 'body', type: 'text' }),
	],
	preview: { select: { title: 'title', subtitle: 'slug.current' } },
})
