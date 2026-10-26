import { defineConfig } from 'sanity'
import { defineDocuments, defineLocations } from 'sanity/presentation'
import { structureTool } from 'sanity/structure'
import { pagesProofTool } from './presentation-adapter.js'
import { previewPath, proofTypes } from './model.js'
import { schemaTypes } from './schema.js'

const projectId = process.env.SANITY_STUDIO_PROJECT_ID
const dataset = process.env.SANITY_STUDIO_DATASET
if (!projectId || !dataset)
	throw new Error(
		'Set SANITY_STUDIO_PROJECT_ID and SANITY_STUDIO_DATASET for the test project.',
	)

export default defineConfig({
	name: 'pages-proof',
	title: 'SanityKit Pages — integration proof',
	projectId,
	dataset,
	schema: { types: schemaTypes },
	plugins: [
		structureTool({ title: 'Fixture content' }),
		pagesProofTool({
			name: 'pages-proof',
			title: 'Pages proof',
			previewUrl:
				process.env.SANITY_STUDIO_PREVIEW_ORIGIN ?? 'http://localhost:3334',
			resolve: {
				mainDocuments: defineDocuments([
					{
						route: '/*',
						filter: `(_type in ["kitProofPage", "kitProofPost"] && pathname.current == $path) || (_type == "kitProofLanding" && route == $path)`,
						params: ({ path }) => ({ path }),
					},
				]),
				locations: Object.fromEntries(
					proofTypes.map((type) => [
						type,
						defineLocations({
							select: {
								title: 'title',
								pathname:
									type === 'kitProofLanding' ? 'route' : 'pathname.current',
							},
							resolve: (document) => {
								const href = previewPath(document?.pathname)
								return href
									? {
											locations: [
												{ title: String(document?.title ?? 'Untitled'), href },
											],
										}
									: {
											locations: [],
											message: 'Add a valid URL to preview this document.',
											tone: 'caution',
										}
							},
						}),
					]),
				),
			},
		}),
	],
})
