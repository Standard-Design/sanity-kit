# Shared URL resolution

Import from `@standard-design/sanity-kit/url`.

This entry point is available in local builds on the Pages development branch,
not in the published `0.1.0-alpha.5` package. The fixed-prefix resolver API was
approved on October 31, 2026, along with the separate internal authoring
preparation layer. The conflict-checking and native validation adapter described
below are also approved. All remain unreleased.

## What this does

A page can store `/about/team`, while a post stores only `first-post`. The helper
reads the appropriate field and returns the same three URL parts for either:
`{pathname, prefix, slug}`. It derives these parts; it does not save them.

The frontend and [Pages tool](pages.md) share one registration and its ownership
checks. There are no Studio, React, or React Router runtime imports. The helper
does not fetch documents, load settings, mutate content, or choose an app route.
This public resolver accepts fixed collection prefixes. A private
[collection-settings layer](collection-routing.md), now under review, resolves
loaded settings into that same configuration. Settings loading, editor controls,
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
uniqueness or that the website serves the URL. The private conflict checker below
performs a separate dataset read; resolution itself remains pure. Reverse lookup
and reserved app routes are also separate responsibilities. `excludePaths` handles
exact exclusions, not route patterns.

## Implementation and tests

- `src/url/registry.ts` owns shared configuration and URL ownership checks.
- `src/url/resolve.ts` reads stored values and returns URL parts or a failure.
- `src/studio/pages/registry.ts` bridges to that same implementation. Registry
  internals are not public package exports.
- `tests/url/resolve.test.ts` covers storage modes, root, nested prefixes,
  malformed data, mutation isolation, Studio parity, and browser dependencies.
- Package fixtures exercise the `/url` export without installing Studio.

## Authoring preparation (internal)

Reading a URL and editing a URL are different jobs. The public resolver never
changes stored data. The new private authoring layer can prepare a candidate for
an explicit editor action, without applying that candidate to a document.

This is the engine for the forthcoming URL field, not the field itself. Nothing
is connected to Studio inputs yet. These helpers are not public exports, and
consumers should not import their compiled paths.

### What a candidate contains

The preparation result includes the resolved `{pathname, prefix, slug}`, the
registered string-field path, and the string that would be stored there:

- A page at `/about/team` produces `pathname.current` and `/about/team` when
  that is the app's configured field mapping.
- A slug-only post at `/journal/story` produces `slug.current` and `story`.
- An existing full-path collection item still stores its complete pathname.

The three resolved URL parts are never written as three separate fields.
Preparation respects excluded paths, overview ownership, and collection
boundaries. It refuses mappings into reserved document metadata such as `_id`.
Configured collection prefixes must already be canonical; authoring setup rejects
noncanonical prefixes rather than silently changing application configuration.

### Folder and slug editing

For ordinary pages, preparation combines the selected folder with one final
segment. For slug-only items, that folder must equal the registered collection
prefix. Legacy full-path items may retain nested folders beneath their collection
prefix, but cannot move outside it.

An empty final segment is accepted only for the homepage at `/`. To create an
index page at `/about`, the later folder action can prepare the complete value
`/about`; its canonical parts are prefix `/` and slug `about`. Clearing the final
segment of an ordinary child page does not silently turn it into an index page.

### Separator cleanup

Whole-path preparation turns `/about//team/` into `/about/team`. It also cleans
the selected folder before joining it to a final segment. It does not clean a
collection slug into a different slug: `story/` and `two/segments` are invalid.

Only literal internal repeated slashes and trailing slashes are repaired. The
layer rejects leading `//` (which can mean another host), dot segments, encoded
separators, query strings, hashes, whitespace, and invalid escapes. It does not
invent a leading slash, decode a path, or trim malformed path text. Root `/`
stays `/`.

This cleanup does not run when viewing documents and does not migrate existing
content. The future field must display the candidate and check conflicts before
applying it.

### Generate follows Sanity defaults

Approved October 31: use Sanity's native generation behavior rather than a
separate kit-specific Unicode or length policy. The implementation uses the same
`speakingurl` dependency and options as Sanity 6.17.0: `symbols: true` and
`truncate: maxLength`, with a default of 200.
It is a direct kit dependency, not an undeclared reliance on Studio's transitive
dependencies. The public URL resolver does not import or bundle it.

Examples: `Hello World` becomes `hello-world`, `Café` becomes `cafe`, and
`Research & Development` becomes `research-and-development`. Transliteration,
punctuation, underscores, and word-boundary truncation all follow that library;
the kit does not add its own normalization or percent-encoding step. Some scripts
produce no slug with the default generator, so an application can supply a custom
generator when needed.

Long generated values are shortened using native truncation, not rejected for
exceeding a separate encoded-length limit. This is not a simple character slice:
the result may be shorter than `maxLength`. The limit affects default generation,
not existing manual values. No numeric collision suffixes are added.

A custom generator receives the Stega-clean source text unchanged, including
outer whitespace. It may return a string or a promise. As in Sanity, a custom
generator bypasses `maxLength` and is not passed through the default generator
again. Synchronous throws and rejected promises give a generation failure.
See [Sanity's slug options](https://www.sanity.io/docs/studio/slug-type).

Generation and URL validation remain separate. The kit removes Stega for URL
comparison and requires a nonempty, safe single segment from either generator.
For example, a custom result of `nested/slug` or an encoded slash is rejected even
though a native custom slugifier can return arbitrary strings. A custom generator
can return a safe percent-encoded Unicode segment when desired.

This private helper always returns a promise. It does not yet implement the
native field's complete `source`/`slugify` API: the later Studio adapter must bind
schema/context arguments, select the title field or callback, and ignore stale
async completions after newer edits, document switches, or read-only changes.
It must also confirm replacement of an existing slug and honor conditional
read-only settings. Ordinary title edits must not trigger automatic URL changes.

### What must happen before saving

A valid candidate is not permission to write. The field must still enforce
read-only state and permissions, check full-path occupancy across registered
types, and preserve the agreed folder metadata. Published URL changes also need
the reviewed redirect/publication workflow. Authoring preparation performs none of
those checks or writes. The next layer below adds conflict reads, not a uniqueness
guarantee or permission to save.

The private implementation is `src/url/authoring.ts`; its tests are in
`tests/url/authoring.test.ts`. The public resolver and existing Studio navigation
are unchanged. The public `/url` entry does not import the authoring module.

The [Pages design decisions](pages-design-proposals.md) describe the broader
field/settings/folder direction. This helper does not implement those workflows.

## URL conflict checks and native validation (internal)

A well-formed URL can still belong to another page. This layer checks that separate
question before the future field offers a change. It is implemented and approved,
but not connected to the fixture or exported from the package. No existing Studio
field behaves differently yet, and no documents are changed.

### Use Sanity's existing validation system

Sanity's slug field already has a uniqueness check. By default, it compares the
same field path on documents of the same type. That is useful for an ordinary
slug, but not sufficient for a site's complete URL space. A page might store
`/journal/story` in `pathname.current`, while a post stores `story` in
`slug.current`. Both would produce the same website URL.

The private `createUrlIsUnique()` adapter is compatible with native
`options.isUnique`. It uses shared route registration to compare those two storage
forms. Sanity keeps responsibility for displaying validation errors; the kit does
not introduce another validation UI. See [Sanity's slug validation options](https://www.sanity.io/docs/studio/slug-type).

The adapter returns `true` when its check finds no conflict and `false` when it
finds one. It throws a descriptive error when the check cannot finish, rather
than reporting a network failure as a duplicate or a successful check. It checks
that the native field path matches the registered slug object, including nested
objects. Arrays and unrelated slug fields are not supported. Required-value and
format rules remain separate field-factory responsibilities.

### What counts as a conflict

Compare the exact complete pathname across all types in the supplied registration,
not just the current type or the five recent rows in the navigator. Thus:

- `/company/team` and `/leadership/team` can coexist.
- A full-path page and a slug-only post cannot both claim `/journal/story`.
- Root `/` is checked like any other pathname.
- A stored match on a registered type is reported even if that type is not an
  allowed owner of the path in the navigator. Bad ownership must not hide a match.

The query uses the authenticated Studio client, bypasses the API CDN, and explicitly
uses the `raw` perspective. This sees published documents, drafts, and release
versions side by side instead of hiding one behind another. It follows Sanity's
native self-exclusion: `getPublishedId()` and `sanity::versionOf()` exclude every
version of the current document. Versions of other documents still count.
See [Sanity perspectives](https://www.sanity.io/docs/content-lake/perspectives).

A release version of the current document is not a uniqueness conflict with
itself. Restrictions on editing URLs involved in releases remain a separate
save/rename safeguard; passing this check does not permit those changes.

### Results and failure handling

The underlying `createUrlConflictChecker()` returns one of three states:

- `checked`: the prepared candidate, up to 20 matching document-version records,
  and `hasMore` if more matches exist. Each record contains its document ID, type,
  revision, and published/draft/release classification. No document bodies are read.
- `invalid`: the proposed URL or document identity cannot be checked.
- `unavailable`: the request failed, was canceled, or returned an unexpected shape.

The 20-record limit bounds the response, not the search. A match beyond that list
does not turn a conflict into success. Multiple versions of another document may
appear separately, so this list is not a count of distinct pages.

Explicit authoring preparation can clean repeated/trailing separators before
checking a proposed URL. Native validation, however, checks the actual stored
value and refuses noncanonical input; it never silently validates a repaired URL.
Neither path rewrites existing content. Matching does not fold case, decode
percent escapes, or equate legacy trailing/repeated slashes. Applications that
treat those as aliases need an additional routing policy and content audit.

### What this does not guarantee

These are read-time checks, not URL reservations or a database uniqueness
constraint. Two editors can both see a free URL before either saves. API writers
can bypass Studio validation, and queries may lag recent writes. `raw` does not
bypass permissions: the client must be able to see every relevant document version,
and an empty result cannot prove that it has that access.

There is no result cache. Cancellation is forwarded to Sanity and checked again
after the response; the future input must also discard obsolete checks when its
value changes. Folder persistence, publication permissions, reviewed URL moves,
redirects, dynamic prefixes, and write coordination remain later work.

Implementation: `src/studio/url/conflicts.ts` performs the read;
`src/studio/url/is-unique.ts` adapts it to Sanity. Tests in
`tests/studio/url-conflicts.test.ts` evaluate the generated GROQ against offline
documents, including native version matching. Neither module is loaded by the
public `/url` resolver or the current Pages UI.
