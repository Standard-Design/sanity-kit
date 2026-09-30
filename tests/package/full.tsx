import { renderToStaticMarkup } from 'react-dom/server'
import { z } from 'zod'
import {
	createSanityImageTools,
	prepareSanityImage,
	type SanityImagePreparationFailure,
} from '@standard/sanity-kit/image'
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
	type SanityRequestContext,
} from '@standard/sanity-kit/react-router/server'
import { createZodDecoder } from '@standard/sanity-kit/validation/zod'
import {
	sanityLinkQueryFragment,
	sanityPortableTextLinkQueryFragment,
} from '@standard/sanity-kit/link'

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

// Check the public declaration and the same destructuring used in the guide.
export async function readRequestContext(request: Request) {
	const context: SanityRequestContext = await kit.getContext(request)
	const { preview, options, client } = context
	const enabled: boolean = preview
	// @ts-expect-error Request context is no longer a preview-only operation.
	void kit.preview.getContext
	return { preview: enabled, options, client }
}
const images = createSanityImageTools(publicConfig)
const Image = createSanityImageComponent(publicConfig)
const prepared = prepareSanityImage({
	asset: { _ref: `image-${'a'.repeat(40)}-800x600-jpg` },
	crop: { left: 0.25, right: 0.25 },
})
const imageHtml = prepared.success
	? renderToStaticMarkup(<Image {...prepared.image} alt="Example" />)
	: ''
const imageFailure: SanityImagePreparationFailure | undefined = prepared.success
	? undefined
	: prepared.reason
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
			previewDecoder: createZodDecoder(schema.partial({ title: true })),
			mutate(data) {
				const title: string | undefined = data.title
				// @ts-expect-error Draft titles need not satisfy the published schema.
				const requiredTitle: string = data.title
				void requiredTitle
				return { ...data, title: title ?? 'Untitled' }
			},
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
export {
	kit,
	images,
	Image,
	routes,
	links,
	loaders,
	sitemap,
	html,
	imageHtml,
	imageFailure,
	sanityLinkQueryFragment,
	sanityPortableTextLinkQueryFragment,
}
