import { defineCliConfig } from 'sanity/cli'

export default defineCliConfig({
	api: {
		...(process.env.SANITY_STUDIO_PROJECT_ID
			? { projectId: process.env.SANITY_STUDIO_PROJECT_ID }
			: {}),
		...(process.env.SANITY_STUDIO_DATASET
			? { dataset: process.env.SANITY_STUDIO_DATASET }
			: {}),
	},
	server: { port: 3000 },
})
