import { defineConfig } from 'sanity'
import { structureTool } from 'sanity/structure'
import { pagesProofTool } from './presentation-adapter.js'
import { createPageResolvers } from '../../../src/studio/pages/resolvers.js'
import { proofRegistry } from './routes.js'
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
			resolve: createPageResolvers(proofRegistry),
		}),
	],
})
