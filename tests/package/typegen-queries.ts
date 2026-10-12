import { defineQuery } from 'groq'
import {
	sanityLinkQueryFragment,
	sanityPortableTextLinkQueryFragment,
} from '@standard-design/sanity-kit/link'

export const TYPEGEN_PAGE_QUERY = defineQuery(`
  *[_type == "page"]{
    links[]{${sanityLinkQueryFragment}},
    body[]{markDefs[]{${sanityPortableTextLinkQueryFragment}}}
  }
`)
