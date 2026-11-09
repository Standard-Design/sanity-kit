import { defineConfig } from 'sanity'
import { structureTool } from 'sanity/structure'
import { pagesTool } from '../../../src/studio/index.js'
import { proofRoutes } from './routes.js'
import { proofLiveCollectionRouting } from './collection-routes.js'
import { schemaTypes } from './schema.js'
import {
	withCollectionRoutingSettings,
	collectionRoutingSettingsItems,
} from '../../../src/studio/collections/settings.js'
import {
	proofCollectionSettingsRoutes,
	proofSlugPost,
	proofCollectionArticle,
} from './collection-settings.js'
import { redirectManagementItem } from '../../../src/studio/redirects/schema.js'
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
					types: [...schemaTypes, proofSlugPost, proofCollectionArticle],
					templates: (previous) => [
						...previous,
						{
							id: 'kitProofArticleWithIntro',
							title: 'Article with intro',
							schemaType: 'kitProofCollectionArticle',
							value: {
								body: 'This introduction comes from the article template.',
							},
						},
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
										(item) =>
											item.getId() !== 'sanityKitCollectionRoute' &&
											item.getId() !== 'sanityKitRedirect',
									),
									S.divider(),
									redirectManagementItem(S),
									...collectionRoutingSettingsItems(
										S,
										proofCollectionSettingsRoutes,
									),
								]),
					}),
					pagesTool({
						...proofRoutes,
						collectionRouting: proofLiveCollectionRouting,
						name: 'pages-proof',
						collectionUi: {
							journal: {
								itemTitle: 'post',
								create: {
									schemaType: 'kitProofPost',
									templateId: 'kitProofPost',
									title: 'Post',
								},
							},
							articles: {
								itemTitle: 'article',
								create: [
									{
										schemaType: 'kitProofCollectionArticle',
										templateId: 'kitProofCollectionArticle',
										title: 'Article',
									},
									{
										schemaType: 'kitProofCollectionArticle',
										templateId: 'kitProofArticleWithIntro',
										title: 'Article with intro',
									},
								],
							},
						},
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
			{
				routes: proofRoutes,
				collectionRouting: proofLiveCollectionRouting,
				redirectManagement: 'publish',
			},
		),
		{ routes: proofCollectionSettingsRoutes },
	),
)
