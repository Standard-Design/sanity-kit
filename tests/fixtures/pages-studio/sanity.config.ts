import { defineConfig } from 'sanity'
import { structureTool } from 'sanity/structure'
import { pagesTool } from '../../../src/studio/index.js'
import { proofRoutes } from './routes.js'
import { schemaTypes } from './schema.js'
import { withUrlPublication } from '../../../src/studio/url/publication-plugin.js'

const projectId = process.env.SANITY_STUDIO_PROJECT_ID
const dataset = process.env.SANITY_STUDIO_DATASET
if (!projectId || !dataset)
	throw new Error(
		'Set SANITY_STUDIO_PROJECT_ID and SANITY_STUDIO_DATASET for the test project.',
	)

export default defineConfig(
	withUrlPublication(
		{
			name: 'pages-proof',
			title: 'SanityKit Pages — integration proof',
			projectId,
			dataset,
			schema: {
				types: schemaTypes,
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
				structureTool({ title: 'Fixture content' }),
				pagesTool({
					...proofRoutes,
					name: 'pages-proof',
					title: 'Pages proof',
					previewUrl:
						process.env.SANITY_STUDIO_PREVIEW_ORIGIN ?? 'http://localhost:3334',
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
)
