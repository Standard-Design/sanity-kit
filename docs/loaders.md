# Loader validation, preview, and caching

Import from `@standard/sanity-kit/react-router/server` in server-only application
modules. `createSanityLoaders` connects the [browser route registry](react-router.md)
to the [server kit](server.md): it looks up a pathname, chooses a page query,
validates the result, and handles preview/cache separation.

This guide describes alpha.3, including strict published validation before cache
writes and typed preview decoding. Consumers upgrading from alpha.2 should read
the [migration requirements](#alpha-compatibility-changes).

Applications own schemas, queries, cache storage and key prefixes, diagnostic
logging/redaction, and any wrapper object returned around the page. No hosting
provider or storage implementation is built in. See [core](core.md) for the
decoder and Stega terminology used here.

## Create matching server loaders

```ts
// app/sanity/loaders.server.ts
import {
	createSanityLoaders,
	defineSanityLoader,
} from '@standard/sanity-kit/react-router/server'
import { createZodDecoder } from '@standard/sanity-kit/validation/zod'
import { sanity } from '../sanity.server'
import { sanityRoutes } from './routes'
import { articleQuery, articleSchema, draftArticleSchema } from './article'

const articleLoader = defineSanityLoader({
	type: 'article',
	query: articleQuery,
	decoder: createZodDecoder(articleSchema),
	previewDecoder: createZodDecoder(draftArticleSchema),
})

export const sanityLoaders = createSanityLoaders({
	routes: sanityRoutes,
	kit: sanity,
	loaders: [articleLoader],
})
```

The local modules above are application-owned. This example assumes the registry
contains only `article`; add a loader for every other registered type. Zod is
optional—any `SanityDataDecoder` works. Export `sanityLoaders.loader` as a
top-level loader binding in the application route module, or wrap it as shown
under [diagnostics](#request-scoped-diagnostics).

The factory rejects duplicate, missing, or unexpected loaders immediately. It
compares `routes.types`, not `linkableTypes`; non-linkable pages still need loaders,
while extra linkable types served elsewhere do not. Empty type names and query
strings are configuration errors.

## What happens on a request

1. Read signed preview context once and use React Router's normalized `args.url`.
2. Look up minimal route data for that pathname: `_id`, `_type`, and `pathname`.
3. Choose the registered page query by `_type` and supply `$id` and `$pathname`.
4. Fetch or read cached raw data, then validate it using the published/preview
   rules below. Fetches receive the request's abort signal.
5. Run optional `mutate` after decoding and return the resulting document.

Both raw and decoded page data must retain the registered `_type`. Mutation
output is checked for that identity too. The kit does not rerun the full schema
after mutation; your mutation must honor its declared output type.

### Query parameters and per-request mutation

Optional `params(context)` adds query parameters and may be asynchronous. The
kit writes its own `id` and `pathname` last, so custom parameters cannot replace
the identity selected by the first lookup. `params` runs when the page query is
actually fetched, not for a cache hit.

The callback context includes the original router `context`, route `params`,
`pattern`, normalized `url`, `request`, validated `routeData`, selected `client`,
`preview`, and `perspective`. Keep this context server-side.

Optional `mutate(data, context)` may be asynchronous and runs once on every
successful request, including cache hits. Use it for request-specific shaping,
not for populating a shared cache. It accepts and returns the union established
by the published and preview decoders and must keep `_type` unchanged.

## Published and draft decoders

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

Published failures always throw: `validation.published` accepts only `'throw'`
and can normally be omitted. Preview defaults to `'passthrough'` for the strict
published-schema check, not for route identity or a failed preview decoder.

## Cache raw data, not decoder output

The cache adapter handles storage only:

```ts
import type { SanityLoaderCache } from '@standard/sanity-kit/react-router/server'

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

The adapter context contains `key`, `request`, `scope` (`route-data` or `route`),
and the document `type` for page reads. Default keys are
`SANITY_ROUTE_DATA:<pathname>` and `SANITY_ROUTE:<pathname><search>`. These names
distinguish stages, not projects or deployments; add your namespace in the
adapter for both scopes. The example adapter above omits this application-specific
prefix for brevity and should not be used unchanged with shared storage.

A loader's optional synchronous `cacheKey(context)` replaces the page key, or
returns `null` to skip page caching. Account for every parameter that changes the
result. Without a cache adapter, published requests still validate but do not
store data. TTL, invalidation, serialization, and storage failures belong to the
application.

## Request-scoped diagnostics

Use a fresh closure per request to collect only the strict diagnostics intended
for preview. Do not keep diagnostic state in a module-level array.

```ts
import type { SanityValidationDiagnostic } from '@standard/sanity-kit/core'

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

This wrapper object is an application envelope: pass `page` to the route
registry component and render diagnostics only in authenticated preview UI.
Diagnostic messages can contain schema-authored sensitive details; sanitize them before rendering if
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

### Public error codes

| Code                          | Status | Meaning                                                  |
| ----------------------------- | ------ | -------------------------------------------------------- |
| `SANITY_ROUTE_NOT_FOUND`      | 404    | Initial route lookup returned null or undefined          |
| `SANITY_ROUTE_DATA_INVALID`   | 500    | Initial route lookup returned malformed routing data     |
| `SANITY_ROUTE_NOT_REGISTERED` | 404    | The looked-up document type has no registered loader     |
| `SANITY_ROUTE_INVALID`        | 500    | Strict published validation failed where it is required  |
| `SANITY_PREVIEW_INVALID`      | 500    | The configured draft decoder failed                      |
| `SANITY_ROUTE_TYPE_MISMATCH`  | 500    | Raw, decoded, or mutated page data has the wrong `_type` |

These are thrown `Response` objects, not successful document results. An invalid
cache hit is not treated as a miss; it fails validation. The kit does not
automatically delete it or refetch around the problem.

## Link queries and TypeGen

See [link query fragments and TypeGen](link.md#query-fragments-and-typegen) for
static projections, custom runtime fragments, and monorepo dependency setup.
Type generation does not replace runtime decoding.

## Alpha compatibility changes

- Replace `kit.preview.getContext(request)` with `kit.getContext(request)` and
  `SanityPreviewContext` with `SanityRequestContext`. The returned fields and
  session behavior are unchanged. Update custom kit mocks too; the old names
  are not retained as aliases. Preview enable/disable handlers stay in place.
- Published `passthrough` is no longer supported; remove it and fix invalid
  published documents instead of caching/rendering them as validated data.
- Handle draft types in mutations/components, or provide a preview decoder.
- Failure-hook route information is optional until lookup succeeds.
- Read detailed validation information from the server hook, not public errors.
- Invalidate/version any existing transformed-result caches before adoption.

No peer dependencies, canonical stored link fields, or hosting-specific APIs
are added or changed in alpha.3.

## Source and related guides

Implementation: `src/react-router/server/loaders.ts`; tests:
`tests/react-router/loaders.test.ts` and packed-consumer fixtures under
`tests/package`. See [routing](react-router.md), [server sessions](server.md),
[Zod schemas](validation-zod.md), or the [documentation index](README.md).
