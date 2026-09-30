import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import {
	defineSanityConfig,
	defineSanityDataDecoder,
	requireValidSanityData,
	validateSanityData,
} from '@standard/sanity-kit'
import {
	createSanityLinkQueryFragments,
	sanityLinkQueryFragment,
	sanityPortableTextLinkQueryFragment,
} from '@standard/sanity-kit/link'
import { createSitemapResponse } from '@standard/sanity-kit/sitemap'

// TypeGen uses CommonJS-style module resolution to read ESM source statically.
assert.ok(createRequire(import.meta.url).resolve('@standard/sanity-kit/link'))
assert.match(sanityLinkQueryFragment, /internalDestination->/u)
assert.match(sanityPortableTextLinkQueryFragment, /pathname\.current/u)

assert.equal(
	defineSanityConfig({
		projectId: 'project',
		dataset: 'production',
		apiVersion: '2026-09-19',
	}).projectId,
	'project',
)
const decoder = defineSanityDataDecoder({
	decode: () => ({ success: true, value: 42, diagnostics: [] }),
})
assert.equal(requireValidSanityData(await validateSanityData({}, decoder)), 42)
assert.ok(
	createSanityLinkQueryFragments({
		internalDestinationQueryFragment: '_id, _type',
	}).linkQueryFragment,
)
assert.match(
	await createSitemapResponse([{ loc: '/' }], {
		siteUrl: 'https://example.com',
	}).text(),
	/https:\/\/example.com\//,
)
await assert.rejects(
	import('@standard/sanity-kit/dist/react-router/server/index.js'),
	{ code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' },
)

if (process.argv.includes('--full')) {
	const { createElement } = await import('react')
	const { renderToStaticMarkup } = await import('react-dom/server')
	const { z } = await import('zod')
	const { createZodDecoder } =
		await import('@standard/sanity-kit/validation/zod')
	const { createSanityImageTools, prepareSanityImage } =
		await import('@standard/sanity-kit/image')
	const { createSanityImageComponent } =
		await import('@standard/sanity-kit/image/react')
	const router = await import('@standard/sanity-kit/react-router')
	const { createSanityKit, createSanitySitemapLoader } =
		await import('@standard/sanity-kit/react-router/server')
	const { SanityVisualEditing } =
		await import('@standard/sanity-kit/react-router/visual-editing')
	assert.equal(
		renderToStaticMarkup(
			createElement(SanityVisualEditing, { enabled: false }),
		),
		'',
	)
	assert.equal('createSanityKit' in router, false)
	assert.equal('SanityVisualEditing' in router, false)
	assert.equal(typeof createSanityImageComponent, 'function')
	const config = {
		projectId: 'project',
		dataset: 'production',
		apiVersion: '2026-09-19',
	}
	assert.match(
		createSanityImageTools(config).buildUrl('image-abc123-800x600-jpg', {
			width: 400,
		}),
		/w=400/,
	)
	assert.deepEqual(prepareSanityImage({ asset: null }), {
		success: false,
		reason: 'missing-asset',
	})
	const prepared = prepareSanityImage({
		asset: {
			_id: `image-${'a'.repeat(40)}-800x600-jpg`,
			url: 'https://untrusted.example/file',
		},
		crop: { left: 0.25, right: 0.25 },
		hotspot: { x: 0.5 },
	})
	assert.equal(prepared.success, true)
	assert.equal(prepared.image.intrinsicWidth, 800)
	const Image = createSanityImageComponent({
		...config,
		baseUrl: 'https://assets.example.com/sanity',
		widths: [320, 640, 1200],
	})
	const html = renderToStaticMarkup(
		createElement(Image, { ...prepared.image, alt: 'Example' }),
	)
	assert.match(html, /width="400"/)
	assert.match(html, /height="600"/)
	assert.match(html, /rect=200,0,400,600/)
	assert.doesNotMatch(html, /640w|1200w|untrusted.example|cdn.sanity.io/)
	const src = / src="([^"]+)"/.exec(html)[1].replaceAll('&amp;', '&')
	const candidates = / srcSet="([^"]+)"/
		.exec(html)[1]
		.replaceAll('&amp;', '&')
		.split(', ')
	for (const url of [src, ...candidates.map((entry) => entry.split(' ')[0])]) {
		assert.equal(new URL(url).origin, 'https://assets.example.com')
		assert.ok(
			new URL(url).pathname.startsWith('/sanity/images/project/production/'),
		)
	}
	const kit = createSanityKit({
		...config,
		studioUrl: 'https://studio.test',
		readToken: 'test-token',
		sessionSecret: 'test-session-secret-at-least-32-characters',
	})
	const request = new Request('https://example.com/sitemap.xml')
	const { preview, options, client } = await kit.getContext(request)
	assert.equal(preview, false)
	assert.equal(client, kit.publishedClient)
	assert.deepEqual(options, { perspective: 'published', stega: false })
	assert.deepEqual(Object.keys(kit.preview).sort(), ['disable', 'enable'])
	kit.publishedClient.fetch = async () => [{ path: '/' }]
	const loader = createSanitySitemapLoader({
		client: kit.publishedClient,
		siteUrl: 'https://example.com',
		query: '*[]',
		decoder: createZodDecoder(z.array(z.object({ path: z.string() }))),
		toEntries: (data) => data.map(({ path }) => ({ loc: path })),
	})
	assert.equal(
		(
			await loader({
				request,
				url: new URL(request.url),
				pattern: '/sitemap.xml',
				params: {},
				context: {},
			})
		).status,
		200,
	)
}
console.log('Installed-package runtime checks passed.')
