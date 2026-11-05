import { defineConfig } from 'sanity'
import { structureTool } from 'sanity/structure'
import { pagesTool } from '../../../src/studio/index.js'
import { proofRoutes } from './routes.js'
import { schemaTypes } from './schema.js'
import {
	withCollectionRoutingSettings,
	collectionRoutingSettingsItems,
} from '../../../src/studio/collections/settings.js'
import {
	proofCollectionSettingsRoutes,
	proofSlugPost,
} from './collection-settings.js'
import { withUrlPublication } from '../../../src/studio/url/publication-plugin.js'

const projectId = process.env.SANITY_STUDIO_PROJECT_ID
const dataset = process.env.SANITY_STUDIO_DATASET
if (!projectId || !dataset)
	throw new Error(
		'Set SANITY_STUDIO_PROJECT_ID and SANITY_STUDIO_DATASET for the test project.',
	)

export default defineConfig(
	withCollectionRoutingSettings(
		withUrlPublication(
			{
				name: 'pages-proof',
				title: 'SanityKit Pages — integration proof',
				projectId,
				dataset,
				schema: {
					types: [...schemaTypes, proofSlugPost],
					templates: (previous) => [
						...previous,
						{
							id: 'kitProofPageWithIntro',
							title: 'Page with intro',
							schemaType: 'kitProofPage',
							value: {
								body: 'This introduction comes from the selected page template.',
							},
						},
					],
				},
				plugins: [
					structureTool({
						title: 'Fixture content',
						structure: (S) =>
							S.list()
								.title('Fixture content')
								.items([
									...S.documentTypeListItems().filter(
										(item) => item.getId() !== 'sanityKitCollectionRoute',
									),
									S.divider(),
									...collectionRoutingSettingsItems(
										S,
										proofCollectionSettingsRoutes,
									),
								]),
					}),
					pagesTool({
						...proofRoutes,
						name: 'pages-proof',
						title: 'Pages proof',
						previewUrl:
							process.env.SANITY_STUDIO_PREVIEW_ORIGIN ??
							'http://localhost:3334',
						create: [
							{
								schemaType: 'kitProofPage',
								templateId: 'kitProofPage',
								title: 'Page',
							},
							{
								schemaType: 'kitProofPage',
								templateId: 'kitProofPageWithIntro',
								title: 'Page with intro',
							},
							{
								schemaType: 'kitProofLanding',
								templateId: 'kitProofLanding',
								title: 'Landing page',
							},
						],
					}),
				],
			},
			{ routes: proofRoutes },
		),
		{ routes: proofCollectionSettingsRoutes },
	),
)
