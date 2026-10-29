# Pages routing foundation

Start with the [Pages subsystem guide](../../../docs/pages.md) for the overall
architecture, selection and preview flows, and approved interface direction.
This guide describes the current internal configuration in more detail. It does
not describe the planned custom URL field or folder-renaming implementation.

This is the first part of A2: a shared, validated description of the app's page
routes. It is internal development code, not a released API. There is still no
`@standard-design/sanity-kit/studio` import and no public `pagesTool()` factory.

The helpers live under `src/studio/pages/`, but the distribution build excludes
that directory until the plugin is ready. Package tests enforce this boundary.
The ordinary typecheck and tests still check the new source. Existing web and
server imports do not gain Studio dependencies.

## What the registry describes

The fixture's `routes.ts` now supplies the information that previously appeared
separately in its browser query and native resolver configuration:

```ts
const registry = createPagesRegistry({
	pages: [
		{ schemaType: 'page', pathnameField: 'pathname.current' },
		{ schemaType: 'landing', pathnameField: 'route', titleField: 'heading' },
	],
	collections: [
		{
			name: 'journal',
			title: 'Journal',
			overview: { schemaType: 'page', pathname: '/journal' },
			routePrefix: '/journal',
			items: [{ schemaType: 'post', pathnameField: 'pathname.current' }],
		},
	],
	excludePaths: ['/'],
})
```

These are proposed internal names, not instructions to import implementation
files into an application. The finished plugin will accept configuration through
its public entry point after the remaining implementation and acceptance gates.

- `pages` lists ordinary routed document types. At least one is required.
- `pathnameField` points to a string containing the **complete path**, such as
  `/journal/first-post`. It does not contain just `first-post`.
- `titleField` defaults to `title`. It supplies location-link text and the proof
  list's title; it does not replace Sanity's schema preview configuration.
- `collections` defaults to an empty list. Each has a stable `name`, visible
  `title`, an existing ordinary page as its `overview`, and registered item types.
- `routePrefix` limits item URLs to descendants, such as `/journal/first-post`.
  It is not automatically added to a slug or written into documents. The prefix
  itself belongs to the overview, not an item.
- `excludePaths` lists exact app-owned URLs. With `['/']`, a page document cannot
  claim the homepage. `/about` is unaffected. There are no wildcard exclusions.

The fixture intentionally keeps its CMS-owned homepage, so its exclusion list is
empty. Standard Stack's planned page-only configuration would exclude `/`, which
its app router currently owns. This slice does not change Standard Stack.

## Collection overviews and app-owned routes

For the initial Pages implementation, a collection overview must be backed by a
Sanity document. **Document-free overview entries are deferred** until a real
consumer needs them. There is no preview-only overview configuration in the
current registry.

A dedicated app route is not the same as a document-free page. For example, a
React Router route at `/journal` can fetch an overview document for its title,
introduction, and SEO, then query posts separately. The app still owns the layout,
listing, and pagination. The overview document can contain only SEO fields; it
does not need a page builder. Register its type under `pages` and identify it in
the collection's `overview`. This does not require a splat route. The current
registry still requires the document's configured pathname field to contain its
complete path.

The generated Presentation `/*` lookup is not an application route. A dedicated
`/journal/:slug` React Router module can use it without adopting a splat route.
With the current registry, that module must query the full stored path (or an
independent app-owned field). Slug-only storage with an automatically joined,
locked prefix is planned, not provided by `routePrefix` today.

This deferral concerns the **Pages navigator**, not what the frontend can show
inside Presentation. An app-owned `/journal` page with no overview document can
still be reached through navigation inside the preview iframe. With Visual
Editing enabled and source metadata preserved (or explicit edit targets supplied),
overlays can open the Sanity documents and fields displayed there. For example,
clicking a post title can open that post's title field even though the listing
page has no document of its own.

Without an overview document, there is no overview document to open, publish, or
select as a document-backed overview entry in Pages. Overlays edit underlying
fields, not the query or app code that assembles the listing. Editors can control
ordering or selection only when the app exposes suitable stored fields and uses
them to build that listing.

This describes the supported architectural distinction, not a new live acceptance
result. The fixture's outstanding overlay checks remain recorded in
[ACCEPTANCE.md](ACCEPTANCE.md). Revisit document-free navigator entries only when
a concrete use case requires more than native preview navigation and overlays.

## Invalid configuration fails early

The registry copies and freezes its configuration so later changes to the app's
input objects cannot change navigation unexpectedly. It rejects duplicate types,
duplicate collection names, duplicate overview paths, and overlapping collection
prefixes. A type cannot be both an ordinary page and a collection item, or belong
to two collections. The initial model assigns whole types to collections; it does
not divide one type using arbitrary filters.

Field paths support direct and nested object fields, such as `route` or
`pathname.current`. They do not support arrays, reference traversal, or GROQ
expressions. Studio setup also checks its compiled schema: registered types must
be documents, and pathname/title fields must resolve to strings. It does not
change or add schemas.

Path values must be root-relative and already URL-safe. External URLs, query
strings, fragments, backslashes, malformed percent escapes, encoded separators,
control characters, and dot segments that a browser would rewrite are rejected.
Encoded text such as `/caf%C3%A9` is supported. Valid paths, including trailing
slashes, are kept exactly as authored. Stega metadata is removed for route logic,
not from rendered titles. This is validation, not a URL migration or redirect
system.

Invalid, missing, excluded, or out-of-prefix paths do not hide their documents.
The browser can still open the native editor while leaving the previous preview
in place. Native location links explain that no previewable page URL is available.

## One routing policy, several uses

`registry.ts` owns validation and `registeredPathname()`. The fixture calls that
helper before navigating or choosing which page to highlight. The resolver
helpers use the same policy for native document-location links and reverse lookup.

`resolvers.ts` supplies three pieces:

1. `pageProjection()` selects the registered title and pathname fields into a
   small browser record. It does not fetch document bodies or references. The
   proof query is still limited to 50 records; the finished data layer comes later.
2. `pageLocationResolvers()` creates Sanity's ordinary document-location
   definitions. It offers no location for an unavailable route.
3. `pageMainDocuments()` creates native URL-to-document lookup configuration.
   Excluded or invalid paths skip the lookup. Document types and URL values are
   query parameters; validated field names use quoted attribute access. A bounded
   count of up to two matches makes duplicate URLs resolve to no main document
   instead of picking one arbitrarily.

Sanity runs reverse lookup under its selected perspective. The local query tests
use synthetic datasets; they do not simulate Content Lake's draft/release overlay
rules. Perspective and release acceptance still need the later live checks.
The browser's own draft identity reconciliation and collision messages are also
later work. The proof only avoids highlighting one arbitrary duplicate.

Presentation continues to own when lookup runs and when it changes the editor.
These helpers never force the edited document to equal the previewed page.
Opening a shared footer or a social-image document may legitimately keep another
page visible in the iframe.

## Explicit resolver overrides

`createPageResolvers(registry, overrides)` composes native configuration with
clear replacement rules:

- A `locations` object replaces the generated entry for each named type and adds
  entries for other app types. Unmentioned generated entries remain.
- A `locations` callback replaces all generated location definitions.
- `mainDocuments` replaces the whole generated list. Passing `[]` disables
  automatic main-document lookup. It is not appended after the kit's catch-all.

Overrides own their own policy, including exclusions and uniqueness checks. The
kit does not rewrite them. An override does **not** silently change the browser's
route mappings: keep mappings consistent, or wait for a supported custom-routing
contract before adopting an application that needs derived/locale-dependent URLs.

## What this slice does not finish

The public plugin factory and optional Studio peers, native header-slot
composition rules, templates/icons, the finished tree and collection UI, query
subscriptions and incremental loading, schema previews, and complete live
acceptance remain subsequent work. No dependency version range is being promised
by this internal routing slice. The known development peer warnings remain in
[README.md](README.md#compatibility-and-checks).

The helpers use the native resolver contracts described in Sanity's
[Presentation configuration guide](https://www.sanity.io/docs/visual-editing/configuring-the-presentation-tool).
The fixture's [acceptance record](ACCEPTANCE.md) separates observed native behavior
from local query tests and checks still requiring a live Studio.
