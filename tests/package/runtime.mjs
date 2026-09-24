import assert from 'node:assert/strict'
import {
	defineSanityConfig,
	defineSanityDataDecoder,
	requireValidSanityData,
	validateSanityData,
} from '@standard/sanity-kit'
import { createSanityLinkQueryFragments } from '@standard/sanity-kit/link'
import { createSitemapResponse } from '@standard/sanity-kit/sitemap'

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
	const { createSanityImageTools } = await import('@standard/sanity-kit/image')
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
	const kit = createSanityKit({
		...config,
		studioUrl: 'https://studio.test',
		readToken: 'test-token',
		sessionSecret: 'test-session-secret-at-least-32-characters',
	})
	const request = new Request('https://example.com/sitemap.xml')
	assert.equal((await kit.preview.getContext(request)).preview, false)
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
