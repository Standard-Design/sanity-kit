import { renderToStaticMarkup } from 'react-dom/server'
import { z } from 'zod'
import { createSanityImageTools } from '@standard/sanity-kit/image'
import { createSanityImageComponent } from '@standard/sanity-kit/image/react'
import {
	createSanityRoutes,
	createSanityLinks,
	defineSanityRoute,
} from '@standard/sanity-kit/react-router'
import {
	createSanityKit,
	createSanityLoaders,
	defineSanityLoader,
	createSanitySitemapLoader,
} from '@standard/sanity-kit/react-router/server'
import { createZodDecoder } from '@standard/sanity-kit/validation/zod'

const publicConfig = {
	projectId: 'project',
	dataset: 'production',
	apiVersion: '2026-09-19',
}
const kit = createSanityKit({
	...publicConfig,
	studioUrl: 'https://studio.test',
	readToken: 'server-only-test-token',
	sessionSecret: 'server-only-session-secret-at-least-32-characters',
})
const images = createSanityImageTools(publicConfig)
const Image = createSanityImageComponent(publicConfig)
const schema = z.object({ _type: z.literal('page'), title: z.string() })
const routes = createSanityRoutes({
	routes: [
		defineSanityRoute({
			type: 'page',
			component: ({ data }: { data: z.infer<typeof schema> }) => (
				<h1>{data.title}</h1>
			),
		}),
	],
})
const links = createSanityLinks({ routes })
const loaders = createSanityLoaders({
	kit,
	routes,
	loaders: [
		defineSanityLoader({
			type: 'page',
			query: '*[_id == $id][0]',
			decoder: createZodDecoder(schema),
		}),
	],
})
const sitemap = createSanitySitemapLoader({
	client: kit.publishedClient,
	siteUrl: 'https://example.com',
	query: '*[_type == "page"]',
	decoder: createZodDecoder(z.array(schema)),
	toEntries: (pages) => pages.map(() => ({ loc: '/' })),
})
const html: string = renderToStaticMarkup(
	<routes.default loaderData={{ _type: 'page', title: 'Hello' }} />,
)
export { kit, images, Image, routes, links, loaders, sitemap, html }
