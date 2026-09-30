import { defineQuery } from 'groq'
import {
	sanityLinkQueryFragment,
	sanityPortableTextLinkQueryFragment,
} from '@standard/sanity-kit/link'

export const TYPEGEN_PAGE_QUERY = defineQuery(`
  *[_type == "page"]{
    links[]{${sanityLinkQueryFragment}},
    body[]{markDefs[]{${sanityPortableTextLinkQueryFragment}}}
  }
`)
