# Pages Studio integration — in development

Pages is a page-browser plugin for an application's existing Sanity Studio. It helps editors find a
page, preview it, and open its document without leaving Sanity's native
Presentation tool.

**This is not part of the released package.** The repository currently contains
a reusable `pagesTool()` foundation under `@standard-design/sanity-kit/studio`.
Local builds include that entry point; the existing npm release does not. Its
browser is still a bounded flat list. The approved navigator and URL-field
designs below are plans, not working package features.

## Add the plugin to your Studio

The kit does **not** vend a Studio application. Your project installs and runs
Sanity, owns `sanity.config.ts`, defines schemas and templates, and deploys the
Studio. The kit adds a plugin to that installation. The Studio in this repository
is only a development fixture, not an application to copy into a consumer.

This example targets a local build of the unreleased foundation:

```ts
import { defineConfig } from 'sanity'
import { pagesTool } from '@standard-design/sanity-kit/studio'
import { schemaTypes } from './schema'

export default defineConfig({
	projectId: 'yourProjectId',
	dataset: 'yourDataset',
	schema: { types: schemaTypes },
	plugins: [
		pagesTool({
			name: 'pages',
			title: 'Pages',
			previewUrl: 'http://localhost:3000',
			pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
			collections: [
				{
					name: 'journal',
					title: 'Journal',
					overview: { schemaType: 'page', pathname: '/journal' },
					routePrefix: '/journal',
					items: [{ schemaType: 'post', pathnameField: 'pathname.current' }],
				},
			],
			// Optional: use this only if the app, not a CMS document, owns the homepage.
			excludePaths: ['/'],
			// Optional shortcut to an existing, parameter-free native template.
			create: { schemaType: 'page', templateId: 'page' },
		}),
	],
})
```

`name` defaults to `pages` and must be unique among your Studio's tools. `title`
defaults to `Pages`. Register `pagesTool()` **instead of** another
`presentationTool()` with the same name: Pages installs that native tool itself.
Other tools, such as Structure, remain independent.

`previewUrl`, `allowOrigins`, `devMode`, and `icon` are native Presentation
options. Your app still configures preview authentication and frontend overlays.
`resolve` accepts native resolver overrides: locations merge by type (a callback
replaces all locations), while `mainDocuments` replaces the generated list.
Overrides do not change the browser's registered URL rules. The plugin rejects
`components` and deprecated `locate`: it owns the header/navigator slots and
uses `resolve` for native lookups. The header always retains `renderDefault`.

The optional `create` shortcut sends a native create intent with the configured
type, template, and tool name. It supplies no document ID or URL and does not
publish anything. The app must define that template for that type; native Sanity
still owns template resolution and authorization. Parameterized templates and
the full permission-aware template chooser are later work. Omit `create` to
use Studio's global creation menu only.

## Dependencies and package isolation

The initial candidate is deliberately restricted to one Studio baseline:
Sanity **6.17.0**, Sanity UI **4.4.10**, styled-components **6.5.3**, and
react-focus-lock **2.13.7**, with React/React DOM **19.3.1** in the Studio tests.
Sanity itself is an exact peer version. The other three Studio peers use caret
ranges from those baselines, so the plugin does not unnecessarily pin shared
Visual Editing UI dependencies to one patch/minor version.
Sanity's header/navigator extension slots are unstable; a broad version range
would promise compatibility we have not checked. This baseline may need widening
before adoption by an existing Studio.

Sanity, Sanity UI, styled-components, and react-focus-lock are optional peers.
The consuming Studio supplies them; the kit does not bundle another Sanity
runtime. They are optional for the package as a whole, but required when using
`/studio`. Frontend consumers do not need them. React remains a shared peer,
with existing frontend compatibility unchanged.
Studio consumers also need the existing `groq` peer (`^5.1.0`) for the navigator
query builders. The packed Studio test installs it explicitly rather than relying
on a hoisted copy from another dependency.

Packed-consumer checks install Studio separately from the frontend profiles.
Minimal-consumer checks reject all Studio peer installation. Full frontend
profiles may already need Sanity UI/styled-components through Visual Editing,
but must not install Sanity or include Studio code in ordinary browser bundles.
Studio declarations are checked with `skipLibCheck`, as
in the fixture; this does not claim all upstream declarations pass strict library
checking. The repository still has one development-only peer warning:
`@sanity/workflow-blueprint` requests TypeScript 6 or 7, while this repository uses
5.9.3. That is not a reason to require TypeScript in every consuming application;
the later compatibility matrix must resolve or explicitly bound it before release.

## What each part owns

Pages adds navigation around Presentation; it does not build a second editor or
a second website router.

| Part                         | Responsibility                                                                                                                                                 |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application                  | Define schemas, website routes, content queries, page components, and SEO. Decide which document fields contain URLs.                                          |
| Pages route registry         | Describe which document types have page URLs, where those URLs are stored, and which types belong to collections. Check that this configuration is consistent. |
| Pages browser                | List documents and ask Presentation to open a document and, when available, its preview URL. The current proof is a flat list, not the approved tree.          |
| Presentation resolvers       | Tell Sanity where a document appears on the website and which document belongs to a preview URL.                                                               |
| Native Presentation          | Own the preview iframe, selected document, document editor, document actions, and navigation lifecycle.                                                        |
| Frontend preview integration | Authenticate preview requests, fetch the selected content perspective, preserve edit metadata, and enable overlays in the website.                             |

The last row uses the kit's existing [server](server.md), [loader](loaders.md),
and [Visual Editing](visual-editing.md) subsystems when the app adopts them.
Adding Pages to Studio would not replace that frontend setup.

## The route registry: one description used in several places

A registry is a checked list of routing information. It is created once from
application configuration, then shared by the browser and Presentation resolvers.
This keeps them from maintaining separate lists of document types and URL fields.

For example, the registry can describe these documents:

| Document         | Stored path                                 | Registration                                           |
| ---------------- | ------------------------------------------- | ------------------------------------------------------ |
| About page       | `/about` in `pathname.current`              | Ordinary page                                          |
| Journal overview | `/journal` in `pathname.current`            | Ordinary page, also identified as the Journal overview |
| Journal post     | `/journal/first-post` in `pathname.current` | Collection item under the `/journal` prefix            |

The current helpers require the **complete pathname**, starting with `/`.
`routePrefix: '/journal'` checks that an item's path is beneath `/journal`; it
does not prepend that text to a stored slug. The planned slug-only field with a
locked prefix needs additional implementation before it can use this registry.

The registry describes existing schemas. It does not add fields, create overview
documents, fetch content, save URLs, or register frontend routes. Setup checks
configuration first, then checks that the registered document types and string
fields exist in Studio's compiled schema. It does not prove that the dataset
contains a matching overview document.

This is also separate from the kit's [React Router registry](react-router.md).
That registry connects document types to rendering and metadata handlers in the
website. The Pages registry connects Studio documents to website URLs. Neither
generates the application's React Router route table.

See the [routing configuration guide](../tests/fixtures/pages-studio/ROUTING.md)
for supported field paths, validation rules, and resolver internals. Consumers
pass configuration to `pagesTool()` rather than importing those internal helpers.

## How a document becomes a browser entry

`pagesTool()` creates the shared registry once. Its browser model uses
`pageProjection()` to build a small GROQ projection: document ID, document type,
title, and pathname. A projection selects and names fields; it does not fetch
anything by itself. Different schema fields become the same `title` and
`pathname` properties in the result.

`usePageDocuments()` reads a shared session using Studio's selected perspective
(the content view, such as drafts or a release). The session, described below,
owns requests and the listener. The header and navigator no longer fetch and
subscribe separately.

This is deliberately a small proof: it fetches at most 50 documents, ordered by
last update, and searches only that loaded list. It is not a complete collection
browser or a full release-perspective acceptance result. Shared loading now works
for that list; the tree and incremental collection resources are implemented and
tested separately, but still need their visible navigator UI.

## Shared live-data loading

The tool-level provider creates one `dataStore`. For each Studio client and
perspective stack, that store keeps a separate session. A session contains
resources: independently loaded results such as the proof list, complete ordinary
pages, a collection's recent items, or a collection search. Two readers of the
same resource share its data and request. All active resources in a session share
one listener for the registered document types.

The native perspective is read inside Presentation's header and navigator, where
Sanity provides it. The outer provider only owns the store. It does not guess
which perspective is active. Switching perspectives immediately selects a different
session; it does not briefly render the previous perspective's rows while waiting
for an effect to run. Different clients, workspaces, and tool instances do not
share result data. Nothing is cached globally or persisted to browser storage.

### Requests, changes, and reconnects

`data-source.ts` uses Studio's existing authenticated client. Requests explicitly
disable the CDN and Stega encoding and supply the session's perspective and abort
signal. The kit does not create or copy a credential. An empty perspective stack
is treated as published; `raw` is rejected.

The listener requests all document versions, including drafts and releases, so
their changes can invalidate an effective-perspective result. Notifications are
not patched into the list: the session asks Content Lake for a fresh result.
Mutation bursts are grouped into a 150 ms refresh window. Obsolete requests are
aborted immediately, and their responses are ignored even if a transport does not
honor cancellation.

A `welcome` event triggers a fresh read after the listener connects or reconnects.
This closes the gap between an initial query and the listener becoming ready. A
reconnect, terminal error, or completed stream marks the data as disconnected.
The SDK handles ordinary reconnect attempts; the browser also offers **Retry
loading pages**. A successful query alone does not clear a failed-listener warning.
The listener must connect successfully too.

Query visibility is best-effort, not a guarantee that every notified change is
already queryable. While connected and in use, each session therefore rechecks
active resources once per minute. It does not interrupt a slow request for that
periodic check. See Sanity's [listener reference](https://www.sanity.io/docs/http-reference/listen)
for event and visibility semantics. This extra read has a cost: for a loaded tree
it rereads all ordinary pages, and for a collection it rereads the loaded depth.
Later optimization can narrow invalidation without changing the UI contract.

### Keep useful data without mixing views

Background refreshes keep the last successful rows visible, rather than replacing
the list with a loading screen. Search and scroll remain in the separate browser
UI state. Read failures retain those rows with a warning; the current browser
disables page selection until recovery, so stale results are not presented as
current. Initial reads still have a loading state.

A collection's `loadMore()` uses its last cursor and ignores duplicate calls while
a request is running. Results are deduplicated by effective document ID. After a
change, the session starts from the beginning and rereads the number of batches
already loaded, rather than appending to an obsolete cursor or collapsing a long
list back to 50 rows. Different normalized search terms get different resources.
Inactive old search result arrays are discarded when another search is selected;
small resource descriptors remain until the tool's store is discarded.

Resources do no work until subscribed. When an inactive resource is reopened, it
is refreshed. Closing the sidebar leaves the shared proof resource alive through
the header, so reopening the picker does not create another listener or initial
request. When the last reader leaves a session, all its requests are aborted,
timers and listener are stopped, and cached result data is cleared.

The collection resources are not yet connected to scroll controls or a search
field. Debouncing typed collection search, status filters, sort choices, list
virtualization, native status previews, and the approved tree rendering are still
next-slice work. The current browser's local search has not silently become a
full-dataset search.

## Navigator data foundation

The next navigator has a separate, tested data foundation in `navigation.ts`,
`queries.ts`, and `snapshot.ts`. **It is not wired into the visible browser yet.**
The current sidebar and picker still use the 50-document proof list described
above. These helpers are private implementation details, not new consumer APIs.

### Build folders from page URLs

`buildNavigationTree()` takes the complete list of ordinary pages for one content
perspective. It infers folders from the paths, without creating folder documents:

- `/about/company/team` establishes the `about` and `company` folders. It does
  not invent About or Company page documents.
- If a real page exists at `/about`, it appears first inside the About folder,
  with its real title. A page at `/about` with no descendants remains a regular
  page at the root. The root itself does not become a Site root folder.
- Collection items do not become ordinary page-tree entries. The collection
  group holds its overview separately, so that document appears only once.
  Ordinary pages beneath the overview URL are still retained in that group.
- A missing overview leaves an empty overview slot, not an invented document or
  a document-free route to select. Duplicate overviews stay visible as separate
  candidates; the helper does not choose one. The existing native resolver also
  refuses ambiguous URL matches.
- Missing, invalid, and app-excluded paths go into an unfiled list. Valid paths
  with repeated or trailing slashes also go there because they do not describe
  ordinary named folders. Their stored URLs are never silently corrected; a valid
  ungroupable path can still be previewed.

Page keys use document IDs, so changing a title or URL does not change the page's
identity. Folder keys use paths; collection keys use the configured collection
name. The ordering is deterministic: an index first, then folder/collection
groups by path, then pages by title with an ID tie-breaker. No Index badge or
replacement “Index” title is stored in this model.

These are navigation relationships derived from URLs, **not parent-child
references saved in Sanity**. They do not make folder renames cascade and cannot
preserve empty folders. The later URL-field and rename workflows still need their
own storage and mutation rules.

### Read pages and collections differently

`createNavigationQueries()` builds query plans; a plan is query text plus its
parameters, not a request. It reuses the registry's field mappings and projects
only ID, type, title, pathname, update time, and original source ID. Bodies and
page-builder content are not fetched.

Ordinary pages are read in batches of 100, ordered by ID. `readPageSnapshot()`
keeps requesting the next batch until it has the complete input for a tree.
Requests are bounded, but the completed ordinary-page tree still occupies memory
proportional to the number of ordinary pages. This is not a fully lazy folder tree.

Collections use separate queries:

- The tree preview requests only five most recently edited items and a total
  count. The count includes all registered item types visible in the chosen
  perspective, including incomplete items without usable paths. It excludes the
  overview and is not a published-page count.
- Browsing requests 50 items plus one look-ahead item. That extra item tells the
  caller whether another batch exists; it is not displayed or skipped. The next
  cursor records the last displayed item's update time and ID.
- Results sort by update time, newest first, then ID. Both values belong in the
  cursor so documents with the same timestamp are not lost between batches.
- Collection search runs against all matching item types in the query, not just
  the five recent rows. It matches a literal, case-insensitive title or stored-path
  substring. Search text is a parameter, including punctuation and `*` characters.
  This is not ranked Studio search; substring matching may need a different
  indexed strategy for very large collections.

This follows Sanity's [cursor pagination guidance](https://www.sanity.io/docs/developer-guides/paginating-with-groq).
The helpers currently provide recent-first ordering only. Sorting controls,
status filters, debouncing, and scroll-triggered requests are later integration work.

### Keep one content perspective throughout a read

The caller must bind its authenticated Studio client, dataset, and selected
effective perspective to the request function. Content Lake resolves which draft,
release version, or published document is visible. The helpers do not choose a
version by comparing timestamps or by stripping ID prefixes. See Sanity's
[perspective documentation](https://www.sanity.io/docs/content-lake/perspectives).

The tree and snapshot reader reject duplicate effective IDs or raw draft/version
IDs instead of guessing precedence. Original source IDs are retained as metadata,
but do not by themselves tell us whether a document is an unpublished draft or
has changes to an existing published document. Status indicators still need their
own integration with Sanity's supported preview/status facilities.

`readPageSnapshot()` receives an abort signal, passes it to every request, and
checks it again after each response. A transport that ignores cancellation cannot
return a late snapshot successfully. A failed later batch rejects the whole read
rather than returning a partial tree as though it were complete.

These batches are **not a transactionally consistent database snapshot**. Content
can change between requests. The shared session now listens for changes, restarts
reads, separates perspectives/searches, and discards obsolete responses. Those
behaviors belong to `data-session.ts`, not these pure helpers. Tests exercise the
session's lifecycle and query behavior; live collection and release-perspective
acceptance still need the corresponding UI and fixtures.

## How selection and preview navigation work

### Selecting a document in Pages

1. The browser checks the document's path with `registeredPathname()`.
2. If the path is allowed, it asks Presentation to open that URL and document.
3. If the path is missing or invalid, it opens the document without changing the
   preview. The editor can then fix an incomplete draft without losing context.

The same check is used for native document-location links: the links that show
where a document appears on the website. Invalid or excluded URLs do not become
preview links, but their documents remain editable.

### Navigating from the website preview

Presentation can ask the generated main-document resolver which document belongs
to the new URL. The resolver builds a query across the registered types and their
configured path fields. It returns a match only when exactly one document matches
under the query's perspective. With no match or duplicate matches, it does not
choose an arbitrary document. This avoids ambiguity; it does not enforce unique
URLs when documents are saved.

The generated `/*` resolver is a Studio lookup rule, **not a requirement to use a
splat route in React Router**. An app can have separate `/journal` and
`/journal/:slug` route modules. Those modules still own their queries and rendering.
With today's full-path storage, an item query must match the complete path (or
another app-owned field); registering a prefix does not make `slug.current`
contain only the final segment.

### Editing shared content without changing pages

The document being edited is not always the page being previewed. For example,
an editor can view About while opening the shared footer's document. Pages uses
the preview URL to highlight the current page; it does not force the iframe to
follow every document selection. Native overlay and reference navigation must
remain free to open shared content.

The sidebar and header picker share search and scroll state. Their provider wraps
the native tool so closing the sidebar does not discard that state. Presentation,
not this provider, owns the URL and selected document. The proof keeps this state
in memory; it does not save it to Sanity or promise persistence across reloads.

The header picker is a modal dialog: while it is open, Tab and Shift+Tab stay
inside it. Sanity UI supplies the popover and pointer-blocking layer;
`react-focus-lock` supplies keyboard focus containment. Opening the picker
focuses Search. Escape or page selection closes it and returns focus to Choose
page. When the sidebar replaces the picker, the header does not try to focus
the now-removed button. These behaviors belong to the plugin's header adapter, not to
the route registry or frontend router.

## Collection overviews and document-free routes

A collection groups item types, such as posts, and identifies an ordinary page
as its overview. The overview needs a Sanity document in the initial design. It
can contain only SEO fields: the app may own the listing layout and fetch posts
separately. A document-backed overview does not require a page builder or a splat
route.

Document-free overview entries in the Pages navigator are deferred. That does
not prevent reaching an app-owned listing through links in the preview iframe.
With the frontend's Visual Editing setup and source metadata, overlays can still
open the posts or other Sanity content shown there. There is simply no overview
document to select or edit. Overlays edit stored fields, not the app's query or
listing code. See the [full distinction](../tests/fixtures/pages-studio/ROUTING.md#collection-overviews-and-app-owned-routes).

## Approved interface direction — not implemented yet

These choices were approved on October 28, 2026. Earlier sketches are preserved,
but the following decisions describe the selected direction.

### Pages navigator

- Keep chevrons on the left and the original tree indentation: page icons align
  with sibling folders' chevron positions, rather than their folder icons.
- Show folders separately from the pages at those paths. The About page at
  `/about` appears beneath the About folder, using its actual page title.
- Do not show an Index badge. Pages have subtitle paths and status indicators;
  folders do not have subtitle paths.
- Use the Pages header for root-level actions rather than a Site root folder.
- Include a Journal section with its overview and post browsing.
- Retain both the website preview and native document pane.

Folder actions belong in this navigator. The intended actions include creating
a page in a folder and creating its index page when absent (or opening it when
present). An index page lives at the folder's own URL; an ordinary child page
adds a final segment. These actions still need templates and creation behavior.

### URL field and folder picker

Use the latest simplified picker: indented folder names, with a **New subfolder**
button that opens a modal. The modal accepts a folder name or several relative
segments separated by slashes. Its **Nest inside** picker opens as a popover and
defaults to site root (`/`).

The chosen folder is the prefix, separate from the page's final URL segment. For
example, creating `company/team` inside `/about` selects
`/about/company/team`; a final segment of `leadership` produces
`/about/company/team/leadership`.

The picker does not rename folders. Collection fields are intended to show their
app-configured prefix as locked, with a single editable slug segment. This needs
a storage/resolution contract beyond the current full-path-only registry. No
custom field or folder-creation persistence exists in this slice.

### Rename a folder

Open **Rename folder** from the navigator's folder actions, then review the
affected URLs in a modal before applying. Changing a single page's URL in its
field is different from renaming the folder and moving all nested paths.

The sketches only change local demo state. The real operation still needs rules
for URL conflicts, permissions, concurrent edits, drafts and published content,
and redirects. Storing complete paths does not create parent-child references
or make descendant paths update automatically. We have not yet implemented that
bulk update or chosen how unused folders are stored. App-owned collection
prefixes must not become editor-renamable through this workflow.

## Where to read the implementation and evidence

The source paths and fixture links below refer to a repository checkout at the
same revision. Local package builds include the compiled plugin and this guide,
but not the test fixture. Only `/studio` is a supported Studio import; compiled
implementation paths are private. Nothing in this slice publishes a release.

- `src/studio/pages/registry.ts`: configuration and pathname checks; no Studio
  runtime import and no database writes.
- `src/studio/pages/resolvers.ts`: query projection and native Presentation
  resolver definitions. It returns configuration, not an editor or a router.
- `tests/fixtures/pages-studio/routes.ts`: the fixture's application-owned registry.
- `src/studio/pages/model.ts` and `browser.tsx`: the bounded
  document query, preview-page identity, and browser selection behavior.
- `src/studio/pages/navigation.ts`, `queries.ts`, and `snapshot.ts`: the next
  navigator's tree model, bounded query plans, and ordinary-page snapshot reader.
  The shared session can load these resources; the tree UI is not connected yet.
- `src/studio/pages/data-store.ts`, `data-session.ts`, and `data-source.ts`:
  tool-scoped sessions, shared read lifetimes, and the authenticated transport.
  `use-page-data.ts` connects the current browser and header to the shared proof
  resource through React's external-store subscription API.
- `src/studio/pages/plugin.tsx`, `header.tsx`, and `browser-state.tsx`:
  native tool integration and shared browser UI state.

The [fixture README](../tests/fixtures/pages-studio/README.md) explains how to run
the proof. The [routing guide](../tests/fixtures/pages-studio/ROUTING.md) describes
configuration details. The [acceptance record](../tests/fixtures/pages-studio/ACCEPTANCE.md)
separates automated tests, observed native behavior, and pending live checks.
Iframe-link navigation and shared-content overlay navigation passed on October
29 with user-performed clicks and observed preview/editor updates. Opening the
shared footer's body field preserved the Team preview and page selection. A
user-performed click on blank preview space also dismissed Choose page without
changing the preview or edited document. Cross-layout scroll transfer and native
pane resizing also passed. Keyboard checks found and fixed a focus escape when
the picker had no results; Tab wrapping now passes with and without results.
Outside-click dismissal also passed a user-performed recheck after the focus fix:
the picker closed while Team remained the previewed and selected document.
The A1 integration-proof gate is complete. The broader compatibility and
permissions matrix is later work, not part of this integration-proof result.

The distribution now has a separate `/studio` entry. The A1 observations above
were collected before extraction into the reusable plugin; new checks are dated
separately in the acceptance record. Keep this guide, source comments, configuration examples, and acceptance
record up to date as each implementation slice replaces a planned behavior.
