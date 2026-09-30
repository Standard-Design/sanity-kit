# Loader validation, preview, and caching

`createSanityLoaders` owns route lookup, protected query parameters, validation,
and preview/cache orchestration. Applications own schemas, cache storage and
namespaces, logging/redaction, and the response envelope.

## Published and draft decoders

```ts
const articleLoader = defineSanityLoader({
	type: 'article',
	query: articleQuery,
	decoder: createZodDecoder(articleSchema),
	previewDecoder: createZodDecoder(draftArticleSchema),
})
```

The published decoder always receives a separate Stega-clean shadow. Published
requests return its parsed value. Preview requests first run that same strict
check for diagnostics, then run `previewDecoder` against the **original** query
result. The draft decoder can tolerate missing fields and supply defaults, but
must retain encoded strings that will be rendered. Do not trim, normalize, or
globally clean render strings in the draft schema. Clean individual values used
for comparisons, URLs, or metadata separately.

The result and `mutate` input are `Published | Preview`, including missing/null
fields allowed by the draft schema. `mutate` runs after decoding on every request
and its result is not cached. Route components must accept the same union.

Without a preview decoder, preview retains the original object—even if strict
validation succeeds—so only its checked `_type` (`SanityRoutable`) is guaranteed.
It is not honestly typed as the published schema's transformed output. Supply a
preview decoder for useful draft types. A preview decoder failure always throws;
it never passes invalid data off as its output type. `validation.preview: 'throw'`
optionally makes strict published-schema failures fatal in preview too.

## Raw cache contract

The cache adapter handles storage only:

```ts
const cache: SanityLoaderCache = async ({ key }, load) => {
	const hit = await storage.get(key)
	if (hit !== undefined) return hit
	const raw = await load() // Fetch + strict validation; rejects on invalid data.
	await storage.set(key, raw)
	return raw
}
```

Both route lookup and page data validate before `load()` resolves. Every
adapter-returned value is validated again, including JSON-roundtripped hits and
read-through misses. Only raw values are stored: transforms are applied to raw
input, never recursively to previous decoder output. Decoders should be pure;
they can run twice on a miss. Mutation runs once after the cache boundary.

Do not swallow a `load()` rejection, store a fallback, or transform values in the
adapter. Corrupt hits fail closed; eviction/retry is storage/application policy.
Preview never invokes the cache adapter or page `cacheKey` callback. Custom
`params` bypass page caching unless a corresponding `cacheKey` is provided.
React Router's normalized `args.url`, not the data-request URL suffix in
`request.url`, supplies lookup paths, default keys, and callback `context.url`.

Namespace **both** lookup and page cache keys by project, dataset, API version,
and application query/schema version in your adapter. Include custom variants
in the page key. Bump that version when migrating from app caches that stored
transformed values; the kit cannot distinguish those from genuine raw results.

## Request-scoped diagnostics

Use a fresh closure per request to collect only the strict diagnostics intended
for preview. Do not keep diagnostic state in a module-level array.

```ts
export async function loader(args: Route.LoaderArgs) {
	const diagnostics: SanityValidationDiagnostic[] = []
	const loaders = createSanityLoaders({
		routes: sanityRoutes,
		kit: sanity,
		loaders: [articleLoader],
		cache,
		validation: {
			onFailure(failure) {
				// Application logger must redact/select fields. Never log the full
				// failure: it contains raw data and a Request, potentially with secrets.
				logValidation({
					stage: failure.stage,
					source: failure.source,
					preview: failure.preview,
					type: failure.type,
					issueCount: failure.diagnostics.length,
				})
				if (failure.preview && failure.stage === 'published') {
					diagnostics.push(...failure.diagnostics)
				}
			},
		},
	})
	const page = await loaders.loader(args)
	return { page, diagnostics }
}
```

This is an application envelope: pass `page` to the route registry component and
render diagnostics only in authenticated preview UI. Diagnostic messages can
contain schema-authored sensitive details; sanitize them before rendering if
needed. No diagnostics are added to the envelope on successful published reads.

`onFailure` runs for failed decoder results at stages `route-data`, `published`,
and `preview`. At lookup failure, `routeData` and `type` are absent. `source` is
`fetch` before a write or `cache` for adapter-returned data; the latter does not
promise a cache hit. Async hooks are awaited. Thrown decoder exceptions, fetch
errors, and identity/mutation errors propagate rather than being converted into
decoder diagnostics; use an application error boundary/wrapper for these.

Kit-generated HTTP errors expose only a stable `code` and generic `message`,
with `Cache-Control: no-store`. They never serialize diagnostic arrays, raw
documents, route paths, or tokens. Applications may map these codes/statuses to
their own public errors, and should avoid serializing caught arbitrary errors.
The app also owns response headers: mark preview envelopes private/no-store.

## Static query fragments

Use `sanityLinkQueryFragment` or `sanityPortableTextLinkQueryFragment` from
`@standard/sanity-kit/link` inside a named `defineQuery`. These literal exports
project the canonical stored fields and standard route destination. The
`/link` export includes a default resolution target so TypeGen's CommonJS-style
static resolver can locate its ESM source; this is not a separate CommonJS build.
In a monorepo, declare the kit as a normal direct **dev dependency of the
Studio/codegen workspace**, using the same artifact version as the frontend's
runtime dependency. Point Studio's TypeGen scan at the frontend query files.
Do not rely on incidental hoisting of a frontend-only dependency, or add aliases
into `node_modules`/`.pnpm`. The packed-consumer suite checks Sanity codegen 8.1.0
from `apps/studio` against queries in `apps/web/app/data`, using a normal pnpm
workspace install and no custom resolver. Other codegen versions/layouts should
run their own generation check; query extraction does not replace schema-based
type generation or runtime decoding.
The custom
`createSanityLinkQueryFragments` factory remains a runtime utility; do not assume
its function call/destructuring can be evaluated by TypeGen. For custom
TypeGen projections, use application-owned literal fragments and regenerate
types. See [Sanity's TypeGen documentation](https://www.sanity.io/docs/apis-and-sdks/sanity-typegen).

## Alpha compatibility changes

- Published `passthrough` is no longer supported; remove it and fix invalid
  published documents instead of caching/rendering them as validated data.
- Handle draft types in mutations/components, or provide a preview decoder.
- Failure-hook route information is optional until lookup succeeds.
- Read detailed validation information from the server hook, not public errors.
- Invalidate/version any existing transformed-result caches before adoption.

No peer dependencies, canonical stored link fields, or hosting-specific APIs
are added or changed by this slice.
