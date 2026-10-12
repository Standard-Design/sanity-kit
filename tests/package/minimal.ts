import { defineSanityConfig } from '@standard-design/sanity-kit'
import {
	defineSanityDataDecoder,
	requireValidSanityData,
	validateSanityData,
} from '@standard-design/sanity-kit/core'
import { createSanityLinkQueryFragments } from '@standard-design/sanity-kit/link'
import { createSitemapResponse } from '@standard-design/sanity-kit/sitemap'

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
