import { defineSanityConfig } from '@standard-design/sanity-kit'
import {
	defineSanityDataDecoder,
	requireValidSanityData,
	validateSanityData,
} from '@standard-design/sanity-kit/core'
import { createSanityLinkQueryFragments } from '@standard-design/sanity-kit/link'
import { createSitemapResponse } from '@standard-design/sanity-kit/sitemap'
import {
	createSanityUrlResolver,
	type SanityUrlResult,
} from '@standard-design/sanity-kit/url'

const resolveUrl = createSanityUrlResolver({
	pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
})
const resolvedUrl: SanityUrlResult = resolveUrl({
	_type: 'page',
	pathname: { current: '/' },
})
if (resolvedUrl.ok) {
	const pathname: string = resolvedUrl.value.pathname
	void pathname
} else {
	// @ts-expect-error failed resolution never fabricates a URL
	void resolvedUrl.value
}

const config = defineSanityConfig({
	projectId: 'project',
	dataset: 'production',
	apiVersion: '2026-09-19',
})
const decoder = defineSanityDataDecoder({
	decode: () => ({ success: true, value: 42, diagnostics: [] }),
})
const value: number = requireValidSanityData(
	await validateSanityData({}, decoder),
)
const fragments = createSanityLinkQueryFragments({
	internalDestinationQueryFragment: '"pathname": pathname.current, _type',
})
const response: Response = createSitemapResponse([{ loc: '/' }], {
	siteUrl: 'https://example.com',
})
export { config, value, fragments, response }
