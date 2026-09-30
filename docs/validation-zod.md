# Zod validation adapter

Import `createZodDecoder` from `@standard/sanity-kit/validation/zod`. This
browser-safe optional entrypoint connects Zod to the kit's library-independent
[decoder contract](core.md#the-decoder-contract). It requires the Zod peer;
consumers using another decoder do not need to install Zod.

## Turn a schema into a decoder

```ts
import { z } from 'zod'
import { createZodDecoder } from '@standard/sanity-kit/validation/zod'
import {
	requireValidSanityData,
	validateSanityData,
} from '@standard/sanity-kit/core'

const articleSchema = z.object({
	_type: z.literal('article'),
	title: z.string().min(1),
})
const articleDecoder = createZodDecoder(articleSchema)

const article = requireValidSanityData(
	await validateSanityData(queryResult, articleDecoder),
)
```

`queryResult` is your fetched content. The adapter calls `schema.safeParseAsync`,
so asynchronous refinements and transforms work. The returned decoder's value
type is **Zod's output type**, not necessarily its input type. Defaults, field
removal, and transforms are exactly those chosen by your schema.

Expected schema failures become core diagnostics: the Zod issue code and message,
a path of strings/numbers, and `source: 'zod'`. Symbol path segments become
strings so the diagnostic path is serializable. Unexpected exceptions from
custom refinements/transforms still propagate.

## Cleaning and preview are caller choices

`createZodDecoder` does not remove Stega, fetch data, cache results, throw HTTP
responses, or choose a preview policy. Calling `decoder.decode(value)` directly
parses exactly that value. Calling it through `validateSanityData`, as above,
parses a separate Stega-clean shadow instead.

[Page loaders](loaders.md) use the clean-shadow path for the strict `decoder`,
including during preview diagnostics. Their optional `previewDecoder` receives
the original query result and should tolerate incomplete draft fields without
destroying encoded strings:

```ts
const draftArticleSchema = z.object({
	_type: z.literal('article'),
	title: z.string().nullish(),
})

const draftArticleDecoder = createZodDecoder(draftArticleSchema)
type PublishedArticle = z.output<typeof articleSchema>
type DraftArticle = z.output<typeof draftArticleSchema>
type ArticlePageData = PublishedArticle | DraftArticle
```

Use that union in components and mutations. A draft component can show a fallback
for missing titles without claiming all published requirements are met. Keep the
`_type` discriminator valid in both schemas; loaders verify it before dispatch
and after mutation.

Do not globally clean, trim, or normalize preview strings intended for visible
rendering. If a schema transform replaces those strings, overlays can lose their
source metadata. Clean separate values used for navigation or metadata instead.

## Transforms and caches

The kit's loader caches store raw query data, not transformed schema output.
On every cache read the decoder runs again. On a miss it may run before storage
and again after the adapter returns, so refinements and transforms should be
deterministic and free of side effects. Do not use parsing as a place to send
analytics, mutate shared state, or perform an operation that must run only once.

Expected invalid content should produce validation issues rather than arbitrary
throws. Diagnostic messages can contain content-specific details; do not expose
them to public visitors without an application policy.

## Source and related guides

Implementation: `src/validation/zod/index.ts`; tests under `tests/validation`.
See [core validation](core.md), [loaders](loaders.md), [sitemaps](sitemaps.md),
or the [documentation index](README.md).
