# Shared URL resolution

Import from `@standard-design/sanity-kit/url`.

This entry point is available in local builds on the Pages development branch,
not in the published `0.1.0-alpha.5` package. Its API is part of the current
implementation review.

## What this does

A page can store `/about/team`, while a post stores only `first-post`. The helper
reads the appropriate field and returns the same three URL parts for either:
`{pathname, prefix, slug}`. It derives these parts; it does not save them.

The frontend and [Pages tool](pages.md) share one registration and its ownership
checks. There are no Studio, React, or React Router runtime imports. The helper
does not fetch documents, load settings, mutate content, or choose an app route.
This first version supports fixed collection prefixes. Editor-controlled settings
and the custom URL field are later work.

## Register once, reuse in the app and Studio

Keep this configuration in a shared module with no Studio imports:

```ts
import {
	createSanityUrlResolver,
	type PagesRouteConfig,
} from '@standard-design/sanity-kit/url'

export const pageRoutes = {
	pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
	collections: [
		{
			name: 'journal',
			title: 'Journal',
			itemsTitle: 'Posts',
			routePrefix: '/journal',
			overview: { schemaType: 'page', pathname: '/insights' },
			items: [{ schemaType: 'post', slugField: 'slug.current' }],
		},
	],
} satisfies PagesRouteConfig

export const resolveUrl = createSanityUrlResolver(pageRoutes)
```

Pass `...pageRoutes` to `pagesTool()` in Studio, alongside its ordinary
Presentation options. The frontend imports `resolveUrl` from the shared module,
not the Studio configuration. Create the resolver once, not during each render.
It validates and copies configuration; later mutations to the original object
do not change its behavior.

The current registration still requires at least one ordinary page type and a
document-backed overview for each collection. That overview can have a different
path from the item prefix, as `/insights` does above. This does not yet introduce
overview-free registration or settings-backed prefixes.

## Resolve a query result

Include `_type` and the configured URL field in your query result. Preserve its
nested shape: `slug.current` expects `slug: {current: ...}`, not a top-level
`slug` string.

```ts
const result = resolveUrl({
	_type: 'post',
	slug: { current: 'first-post' },
})

if (result.ok) {
	const { pathname, prefix, slug } = result.value
	// '/journal/first-post', '/journal', 'first-post'
} else {
	// Choose whether to omit the link, show a warning, or return an error.
	console.warn(result.reason)
}
```

| Stored value and registration           | Pathname              | Prefix     | Slug         |
| --------------------------------------- | --------------------- | ---------- | ------------ |
| Page pathname `/`                       | `/`                   | `/`        | `''`         |
| Page pathname `/about`                  | `/about`              | `/`        | `about`      |
| Page pathname `/about/team`             | `/about/team`         | `/about`   | `team`       |
| Post slug `first-post` under `/journal` | `/journal/first-post` | `/journal` | `first-post` |

Existing full-path collection items can use `pathnameField` instead of
`slugField`. Nested full paths remain supported. The returned `prefix` is the
parent of the final segment, not necessarily the collection boundary: for
`/journal/archive/story`, it is `/journal/archive`.

Segments remain percent-encoded if stored that way. Stega is removed from the URL
comparison value without changing the input document or other render strings.
The resolver does not lowercase, decode, slugify, or repair URLs.

## Failures are data; configuration errors throw

The factory throws for invalid registration: for example, duplicate types, unsafe
field paths, or overlapping collection prefixes. Fix these in app configuration.

Calling the resolver with ordinary missing or invalid query data gives
`{ok: false, reason}`. Failed results have no `value`:

| Reason              | Meaning                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------- |
| `missing-document`  | The document is `null` or `undefined`.                                                       |
| `invalid-document`  | It is not an object with its own nonempty string `_type`.                                    |
| `unregistered-type` | Its type is not registered.                                                                  |
| `missing-value`     | The field is absent, `null`, or empty after Stega cleanup.                                   |
| `invalid-value`     | The value is not a valid pathname or single-segment slug.                                    |
| `disallowed-path`   | The URL is excluded, outside its collection prefix, or claimed by a different overview type. |
| `noncanonical-path` | An otherwise allowed full path has repeated or trailing slashes.                             |

The resolver never changes `/about//team/` into `/about/team`. That could produce
a link different from the app's exact lookup. The future input will handle
authoring cleanup. Existing Studio navigation still makes legacy noncanonical
paths reachable for editing; this new helper refuses to construct URL parts from
them. Root `/` is valid and is the only success with an empty slug.

Settings are not loaded in this version, so there is no “routing settings
unavailable” result yet. That distinct failure belongs with settings-backed
resolution, not missing document data.

## How this relates to other kit features

- **Pages:** shares configuration validation, storage mapping, excluded paths,
  and overview/collection ownership checks. Studio checks its compiled schema
  separately; the frontend resolver needs no schema.
- **Links:** use the pathname when preparing app-owned internal link data.
  Existing link helpers and query fragments are not automatically rewired.
- **Sitemaps:** entry-mapping code can use the pathname after fetching published
  documents. The resolver does not choose a perspective or canonical origin.
- **React Router:** `createSanityRoutes()` chooses components by document type;
  `createSanityUrlResolver()` derives URLs from stored data. App route matching
  remains separate; explicit routes and catch-alls are both possible.

Two documents can both resolve to the same pathname. This helper does not prove
uniqueness or that the website serves the URL. Dataset collision checks, reverse
lookup, and reserved app routes are separate responsibilities. `excludePaths`
handles exact exclusions, not route patterns.

## Implementation and tests

- `src/url/registry.ts` owns shared configuration and URL ownership checks.
- `src/url/resolve.ts` reads stored values and returns URL parts or a failure.
- `src/studio/pages/registry.ts` bridges to that same implementation. Registry
  internals are not public package exports.
- `tests/url/resolve.test.ts` covers storage modes, root, nested prefixes,
  malformed data, mutation isolation, Studio parity, and browser dependencies.
- Package fixtures exercise the `/url` export without installing Studio.

The [Pages design decisions](pages-design-proposals.md) describe the broader
field/settings/folder direction. This helper does not implement those workflows.
