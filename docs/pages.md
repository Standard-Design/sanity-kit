# Pages Studio integration — in development

Pages is a page-browser plugin for an application's existing Sanity Studio. It helps editors find a
page, preview it, and open its document without leaving Sanity's native
Presentation tool.

**This is not part of the released package.** The repository currently contains
a reusable `pagesTool()` foundation under `@standard-design/sanity-kit/studio`.
Local builds include that entry point; the existing npm release does not. Its
browser now includes the first folder tree and collection browsing slice. Folder
actions, the URL field, advanced filtering, and broader release acceptance are
still pending; this is not the finished Pages feature set.

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
					itemsTitle: 'Posts',
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
react-focus-lock **2.13.7**, and Sanity icons **5.2.2**, with React/React DOM
**19.3.1** in the Studio tests.
Sanity itself is an exact peer version. The other Studio peers use caret
ranges from those baselines, so the plugin does not unnecessarily pin shared
Visual Editing UI dependencies to one patch/minor version.
Sanity's header/navigator extension slots are unstable; a broad version range
would promise compatibility we have not checked. This baseline may need widening
before adoption by an existing Studio.

Sanity, Sanity UI, styled-components, react-focus-lock, and `@sanity/icons` are optional peers.
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
| Pages browser                | Group ordinary pages into folders, browse collection items, and ask Presentation to open a document and its available preview URL.                             |
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
| Slug-only post   | `first-post` in `slug.current`              | Collection item; Pages adds `/journal` when reading    |

Ordinary pages store a **complete pathname**, starting with `/`. Collection
items can use the same format or opt into slug-only storage. Each item type
chooses exactly one: `pathnameField` or `slugField`. This is explicit configuration,
not a guess based on whether a value starts with a slash.

### Full paths or collection slugs

An app with a `journal/:slug` route can register posts like this:

```ts
collections: [
	{
		name: 'journal',
		title: 'Journal',
		itemsTitle: 'Posts',
		overview: { schemaType: 'page', pathname: '/journal' },
		routePrefix: '/journal',
		items: [{ schemaType: 'post', slugField: 'slug.current' }],
	},
]
```

Here, a post stores `first-post` in `slug.current`. Pages derives
`/journal/first-post` for navigator rows, collection search, the picker title,
and native Presentation links. When Presentation looks up that URL, Pages removes
the known prefix and queries `slug.current == "first-post"`. It does not query a
second full-path field or save a generated URL back to the document. The website
can likewise query by its route's slug parameter; it still owns that route and
query. The kit's separate frontend link/loader APIs are not configured by this
Studio registration, so the app must use the same prefix in its frontend links.

A `slugField` can point to any string reached through object fields, not only a
field literally named `slug.current`. The schema must already define it. Slugs
must be one nonempty URL segment: `first-post`, not `/first-post`, `first-post/`,
or `archive/first-post`. Unsafe URL characters, dot segments, and encoded slashes
are rejected for navigation. The reader does not lowercase, trim, decode, or
repair stored content. Missing or invalid items remain available for editing.
The forthcoming custom input will provide the locked prefix and authoring feedback;
this storage contract does not yet supply that UI or content-value validation rules.

For `pathnameField`, the stored value remains the full path and `routePrefix`
only checks its boundary. Nothing is prepended. Existing full-path collection
items can still contain nested paths. A collection may contain several types
using different storage modes, but each type chooses just one. URL collisions
are checked across both modes and ordinary page types; the generated resolver
does not choose an arbitrary document. These lookup checks do not prevent saving
duplicate URLs.

The collection overview remains an ordinary document at `/journal`; an empty
item slug does not turn that item into the overview. Exclusions still apply to
the resulting full URL. Changing a slug-only collection's configured prefix
changes its derived URLs without changing documents, so coordinate that change
with the website's routes and redirect policy. Switching an existing type from
`pathnameField` to `slugField` also needs an explicit content migration; changing
configuration alone does not strip prefixes from stored values. No migration
or dataset writes are performed by this slice.

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
`pathname` properties in the result. For slug-only collection types, the projection
joins the configured prefix and stored slug. Downstream browser components still
receive full paths; they do not each implement their own joining rules.

The browser reads the shared session's ordinary-page, recent-item, and collection
resources in Studio's selected perspective (the content view, such as drafts or
a release). The session owns requests and one change listener. These resource
results serve different purposes; they are not three copies of the same query.

### Header identity

The header answers two separate questions with `usePageIdentity()`:

- Which registered page matches the preview URL? Its title labels the picker.
- Which registered document is open in the editor? If it has no usable page URL,
  the header explains that the previous page remains in the preview.

These are targeted reads, not searches through the newest documents or the
currently loaded browser rows. An older page or collection item works without
loading more rows first. The preview lookup ignores query parameters and hashes,
and uses the same registered-type and pathname rules as the generated native
main-document resolver. It requests at most two matches: one identifies the page;
two mean the URL is ambiguous. No match, an ambiguous match, or an initial pending
read leaves the preview URL as the picker label instead of guessing a title.

The edited-document lookup uses its ID and registered type. Draft and release
version IDs are reduced to the underlying document ID; Studio's selected
perspective determines which version is returned. Shared content types that are
not registered as pages are not queried and do not show a missing-preview notice.
Editing a shared footer therefore does not change the previewed page's title.

Both reads use the existing session's listener, cancellation, refresh, and
perspective isolation. A new URL or edited ID selects a separate resource
immediately, so the old title or notice does not flash while the new read loads.
When an identity resource loses its last reader, its result is cleared. Equivalent
preview URLs that differ only by query parameters or hashes share one resource.
Small resource descriptors remain in the tool's store, not document bodies.
Custom native resolver overrides still own their routing policy; these labels
describe the kit's registry, not arbitrary application-specific resolver results.

## Browsing pages and collections

The sidebar and header picker render the same browser. Ordinary pages come from
the complete page snapshot, not just the latest 50 records. A folder button
expands its children without changing the preview or edited document. Chevrons
sit on the left; child groups have a left rule and the original sketch's
indentation. Folders have names only. Page rows have their actual title and URL
subtitle, including index pages; there is no Index badge or Site root folder.
Folder labels capitalize their first letter for display only; stored paths and
expansion keys keep their original spelling and case.
Expanded folders and collections add 12px before the next sibling, using the
same spacing token as the gap above collection labels such as Posts. Collapsed
groups and the last group in a list do not add this extra gap.
Row typography follows native Structure previews: size-1 medium titles and
size-1 regular muted subtitles (13px/19px on the tested theme). Folder names use
the same title style. Rows use Sanity UI's selectable `Card`, the same underlying
component as Structure previews, rendered as real buttons. It supplies hover,
selected, disabled, and keyboard-focus styling and the matching text colors;
we do not copy fixed light/dark colors. Document rows have 8px padding and a
49px minimum height. Folder rows match Structure's compact first-pane rows
(such as “Proof page”): 4px top/bottom/left and 8px right padding, with a 33px
minimum height. Long paths
can still wrap and make a row taller. The approved nesting and row actions stay
the same. The focus-ring adapter uses the same beta Card prop as Structure and
is covered by the live Studio checks.
The Pages options menu expands or collapses all groups. These controls change
only local navigation state, never document URLs.

`browser-header.tsx` shares the header and search layout between the page tree,
collection view, and picker. It matches Structure's document-list panel: a
size-1 semibold title using the native title color, compact icon buttons, and a
size-1 borderless search input with a clear button. The header uses 12px outer
spacing and 8px title padding. The list aligns with the search field below it.
Collection Back sits beside its title instead of taking up a separate row.
The `+` still opens the configured native create intent; the horizontal `…`
still contains Expand/Collapse all. We use public Sanity UI primitives rather
than importing Structure's pane header, which requires a different pane router.
Matching the appearance does not add Structure's sort/filter menu or change our
search scopes. Keyboard focus and the picker's menu boundary remain intact.

`tooltip.tsx` gives Pages controls and status indicators the same tooltip style
as native Studio: size-1 text, compact padding, no arrow, and a 400ms opening
delay. It uses the public Sanity UI tooltip, so theme colors, positioning, and
keyboard-focus behavior stay native. We do not import Studio's private wrapper.
Browser `title` attributes are removed to avoid a second, mismatched tooltip.
Open picker/menu triggers suppress their tooltip, and full page titles remain
available in accessible names as well as the styled tooltip.

Page search matches titles and stored paths across all ordinary pages and
overviews, including collapsed folders. Results appear as a flat list. Clearing
search restores the previous expansion state. Collection items are not included
in this search; the search hint explains that boundary.

Each expanded collection shows its document-backed overview, any ordinary
nested pages, five recently edited items, and a total for the active perspective.
The label adds “Recent” to the collection's `itemsTitle`, such as **Recent posts**
under **Journal**.
Consumers supply the plural wording explicitly, including irregular words,
translated labels, or an umbrella name for a collection with multiple types.
When omitted, it falls back to the collection title; schema names are not
automatically pluralized. The label has 12px of space above it to separate it
from the overview. Section labels and helper text use the same size as page subtitles.
**Browse all posts** uses the configured plural item label, lowercased for the
sentence. Its right side shows the full collection count followed by a chevron,
so the total cannot be mistaken for the number of recent items shown above.
The accessible button name explicitly calls it a total. The count is hidden while
loading or when unavailable. This left-aligned selectable row uses the same
native hover, pressed, and focus colors as page rows. Without `itemsTitle`, the
wording falls back to the collection title. It opens that collection inside the browser without
changing either native pane. Missing or ambiguous overview documents are shown
explicitly instead of inventing a page.

Collection search waits 200 ms after typing, then queries matching titles and
paths in Content Lake. It does not filter only the five recent items. Old search
rows are hidden while the new search waits. Results are ordered by last edit,
with document ID as the tie-breaker. Approaching the bottom requests another
50-item batch; a Load more button provides a keyboard-accessible alternative.
There is no loaded-count or sort-summary label below collection search; the
results follow the search field directly. This does not change the query order
or incremental loading behavior.
Search text, collection mode, folder expansion, and separate scroll offsets
survive moving between the sidebar and picker. Back to pages restores page search.

### Native document status

`document-status.tsx` asks Sanity's `useDocumentVersions()` for actual version
records and passes them to `DocumentVersionsStatusIndicator`. Sanity decides
which icons apply to its selected perspective. The kit does not guess that a
record is published merely because an effective-perspective query returned a
plain ID. A text description reports available published, draft, and release
versions; it describes availability, not whether every version is visible in
the active perspective. Loading and failure show an unknown status, not a green dot.

These APIs are exported from `sanity`, but the hook is beta and the indicator is
marked internal upstream. They are isolated in one adapter and covered by the
exact Studio version pin. There are no private bundle imports. Visible row status
uses Sanity's own preview/version subscriptions in addition to the kit's shared
navigation listener. Native schema preview customization is not yet used for row
titles: those still follow the registered `titleField` mapping.

This is the first browsing UI slice, not the full release gate. Sort choices,
query-side status filters, virtualization of long lists, contextual creation,
folder/index actions, the custom URL field, and reviewed folder rename are still
pending. No dead rename/create-folder buttons imply those writes already work.

## Shared live-data loading

The tool-level provider creates one `dataStore`. For each Studio client and
perspective stack, that store keeps a separate session. A session contains
resources: independently loaded results such as header identity, complete ordinary
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
is refreshed. Closing the sidebar leaves the header's identity resource alive,
so reopening the picker uses the same listener. Tree and collection resources
retain their rows but refresh when mounted again. When the last reader leaves a session, all its requests are aborted,
timers and listener are stopped, and cached result data is cleared.

Collection resources now drive the collection browser's search and incremental
scroll loading. Page search remains local to the complete ordinary-page snapshot;
collection search runs in the query. Status filters and additional sort choices
must also run in the query when added, not just filter already-loaded rows.

## Navigator data foundation

The navigator uses the separately tested helpers in `navigation.ts`, `queries.ts`,
and `snapshot.ts`. These are private implementation details, not new consumer APIs.

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
  In the UI, entries without a usable preview path appear under **Pages without
  URLs**. Valid but ungroupable paths appear separately under **Ungrouped pages**;
  they are not mislabeled as missing URLs. Empty sections are hidden.

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
not this provider, owns the URL and selected document. The browser keeps this state
in memory; it does not save it to Sanity or promise persistence across reloads.

With the sidebar closed, the picker trigger sits on the left, immediately after
the navigator toggle. It uses Sanity UI's outlined `ghost` button, a Documents
icon, and a down chevron. Its title follows the previewed page, not the document
being edited (which may be shared content). Long titles are visually clipped with
an ellipsis, up to roughly 22 character widths and less on narrow screens. The
full title remains in the accessible label and native hover tooltip. The adapter
relocates only the public navigator toggle; `renderDefault` still owns the other
native preview controls. With the sidebar open, the default header is unchanged.

The header picker is a modal dialog: while it is open, Tab and Shift+Tab stay
inside it. Sanity UI supplies the popover and pointer-blocking layer;
`react-focus-lock` supplies keyboard focus containment. Opening the picker
focuses the dialog itself, without highlighting Search. The first forward Tab
moves to Search; subsequent Tab/Shift+Tab navigation stays inside the picker,
including its header actions. The dialog is not an extra stop in that tab cycle.
The picker is 320px wide (or 90% of the viewport on small screens) and grows to
fit its contents instead of reserving a fixed-height box. The empty-page notice
uses the same 8px vertical inset as page rows, inside the list's existing 12px
bottom padding (default theme). This keeps the empty state compact without
crowding the message against the picker edge.
It is capped by the viewport (with padding) and Sanity's available popover space;
when necessary, the list scrolls while its header stays visible. Search results
and collapsed folders can make it shorter again. The sidebar still fills its pane.
Escape or page selection closes it and returns focus to Choose
page. When the sidebar replaces the picker, the header does not try to focus
the now-removed button. These behaviors belong to the plugin's header adapter, not to
the route registry or frontend router.

## Collection overviews and document-free routes

A collection currently groups item types, such as posts, and identifies an ordinary page
as its overview. The overview needs a Sanity document in the current registration. It
can contain only SEO fields: the app may own the listing layout and fetch posts
separately. A document-backed overview does not require a page builder or a splat
route.

Document-free overview entries in the Pages navigator are deferred. That does
not prevent reaching an app-owned listing through links in the preview iframe.
With the frontend's Visual Editing setup and source metadata, overlays can still
open the posts or other Sanity content shown there. There is simply no overview
document to select or edit. Overlays edit stored fields, not the app's query or
listing code. See the [full distinction](../tests/fixtures/pages-studio/ROUTING.md#collection-overviews-and-app-owned-routes).

## Design decisions and remaining work

The interface choices were approved on October 28, 2026, with further field and
folder decisions on October 30 and 31. Earlier sketches are preserved, but the
following decisions describe the selected direction. Explicitly marked proposals still
need agreement before implementation. This section records design intent, not
additional working APIs. The navigator is partly implemented; the custom URL
field and editor controls for folders and collection prefixes are
not implemented yet. The first [shared frontend URL helper](url.md), for fixed-prefix
registration, is implemented locally and approved. The separate
[internal authoring preparation](url.md#authoring-preparation-internal) is now
implemented and approved; it does not yet add the Studio field or save candidates.
The next [internal conflict-checking layer](url.md#url-conflict-checks-and-native-validation-internal)
is implemented and approved, including a native `options.isUnique` adapter. It is not
yet installed on any Studio field.

Private [folder plans](folders.md), [collection-settings resolution](collection-routing.md),
and [redirect validation](redirects.md) are also approved. Their UI and persistence
integrations are still pending. The [Studio generation bridge](url.md#studio-generation-context-internal)
is also approved as a private foundation.
The [collection-settings loader](collection-routing.md#loading-settings-from-sanity)
is approved and reads and validates settings; it is not connected to Studio controls.
A private [folder writer](folders.md) for creation and explicit synchronization
is now under review. It adds folder records without changing page URLs. It is
not connected to the navigator; removal and rename remain future work.

### Storage and shared URL results — agreed October 30

Use full pathnames for site-owned pages and single-segment slugs for reusable
collection content. A post's content and slug should not have to change when the
website changes the collection's prefix. Use one configurable URL input for both
storage modes, rather than separate editor experiences. The current routing foundation
also retains explicit full-path collection registration for existing consumers;
this decision does not authorize a migration of their documents.

Shared helpers should expose the same resolved shape in either mode:

```ts
{
	pathname: '/journal/first-post',
	prefix: '/journal',
	slug: 'first-post',
}
```

For a page, split the stored pathname into its folder prefix and final segment.
For a collection item, combine the collection prefix with the stored slug. These
are derived values, not three independently stored fields. On October 31, the
homepage result was agreed as `{pathname: '/', prefix: '/', slug: ''}`; empty
collection-item slugs remain invalid. Resolution must distinguish missing data,
invalid data, and unavailable routing settings. The first fixed-prefix helper's
name, result wrapper, and reason codes are documented in [the URL guide](url.md)
with the approved API. Settings-unavailable behavior remains future work.

Also approved: pure URL resolution against already loaded routing settings. The
caller loads the appropriate published/preview context separately, allowing reuse
and caching without hiding network reads inside a pure helper.

URL uniqueness concerns the resolved full pathname across registered page and
collection types in the same site. `/company/team` and `/leadership/team` may
coexist; two documents must not claim `/company/team`. Slug-only queries need
type or collection scope. Current reverse lookup refuses ambiguous matches;
the new internal checker compares registered storage fields across raw document
versions. It excludes all versions of the current document, following Sanity's
native slug validation. Connecting it to the field is still future work. Neither
read-time check is a database-level uniqueness guarantee.

### Collection prefix ownership

Support two explicit sources: a fixed prefix configured in code, or a centrally
editor-controlled prefix read from Sanity. In both cases, individual collection
items show the prefix as read-only and expose only their slug for editing. The
whole-field read-only option can disable slug editing as well. Only fixed,
code-configured prefixes are implemented in the current routing foundation.

**Preferred proposal, not finalized:** use one routing-settings document per
collection for editor-controlled prefixes, rather than deriving the prefix from
an overview page. Keep the collection's stable identity separate from its mutable
URL prefix. Fixed-prefix consumers should not need an editable settings document
just to supply the prefix.

Under that proposal, a collection could have zero, one, or many pages displaying
its items. A page at `/insights` could list posts whose URLs begin with `/journal`.
Changing that page's pathname would not move the posts; changing the item prefix
would not move that page. A prefix does not itself create an index page. Whether
the navigator should designate an optional overview shortcut, and how it selects
that document, remain open. The current overview registration has not changed.

This is distinct from a document-free overview entry: we are not proposing a
synthetic page to select when no page document exists. Document-free overview
entries remain deferred. Approved October 31: preview a draft settings prefix,
then explicitly publish the reviewed routing change. Published traffic keeps the
published prefix until that change. No item slugs or independently located listing
pages are rewritten. The settings schema, registration binding, optional overview
association, and activation implementation still need design.

Although the item storage does not change, activation must still check the
resulting URLs for conflicts/reserved routes, plan redirects for old published
URLs, and refresh routing-related caches. Studio, frontend links, lookup, preview,
and sitemaps must resolve the same settings and perspective. Redirect records and
operation metadata can change without rewriting the collection items themselves.

### Frontend routing remains the consumer's choice

The URL field and helpers must not require every consumer to use a catch-all.
Both explicit app routes alongside a CMS catch-all and a dynamic
`/:collection/:slug` route are valid integration patterns. The latter supports a
single-segment collection prefix; nested prefixes require a different matching
route, such as a catch-all. Consumers must constrain editable prefixes to paths
their app can handle, including reserved application routes.

The consumer still owns route matching, content loading, and rendering. Shared
helpers should prevent repeated URL-resolution logic, not choose that application
architecture. Build-time route generation is not part of the planned examples.
Runtime cache invalidation and publication behavior for changing prefixes remain
to be specified.

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

Creating from a folder's menu can prefill that folder's prefix. Creating from the
Pages header has no folder context. This is a convenience, not a stored parent
relationship: a page's pathname determines where it appears in the navigator.

Consumers should explicitly register which page types/templates can be created;
being browsable is not sufficient. Collection creation should use its registered
item choices. Approved October 31: skip selection when only one eligible choice
exists and offer a chooser when several exist. Create drafts, never auto-publish.
Exact configuration, template parameters, defaults, and permission-aware behavior
remain to be designed. The existing single `create` shortcut does not yet
implement these contextual flows.

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
centrally configured prefix as locked, with a single editable slug segment. The
`slugField` routing contract now supports that storage shape, but the custom
input and folder-creation persistence are still pending. The current fixture's
existing collection documents retain their full-path registration and data.

The planned field includes a **Generate** button that derives the final slug
segment from the document's configured name/title source. Generation keeps the
chosen prefix; it does not generate a new folder path. The source must be
configurable because consumers do not all name their title field the same way.
Approved October 31: accept a source field such as `title` or `name`, or a callback,
and support configurable slug generation. Never silently append numeric suffixes
to resolve a collision. The single field factory should use shared routing
registration rather than repeat prefix configuration in every subsystem.
Ordinary title edits must not silently regenerate an existing URL. Generation
still needs the same URL validation and conflict checks as manual editing.

The private preparation layer now follows the Sanity-compatible generation rules
agreed October 31 and described in the [URL guide](url.md#generate-follows-sanity-defaults):
native transliteration, symbol conversion, and truncation, plus async custom
generators that bypass the default length limit. The private Studio bridge now
binds native source and slugify context and discards invalidated async
results. It prepares candidates without writing them. The Generate button and
replacement confirmation UI are not implemented yet.

Support a read-only setting for the entire field, in addition to locking only
the prefix. Whole-field read-only disables slug editing, generation, folder
selection, and folder creation from this field. The resolved URL remains visible
and copyable. This is an editor-interface restriction, not dataset-level write
protection. The field and these controls are not implemented yet.

### Persistent folders — agreed October 30, editor integration pending

Explicitly created folders should persist even when no pages use them. Removing
or moving the last page must not remove an explicitly created folder from the
navigator. The navigator will need to combine saved folder records with folders
inferred from page URLs, without showing duplicates. An empty folder is
organizational metadata; it does not create a website page or occupy its index
URL. The private creation/synchronization writer is now under review. Schema
registration, navigator integration, and removal/rename operations remain future
work.

Approved October 31: use one internal, authenticated-only folder-registry document
per project/dataset, with stable record identifiers and paths. Its fixed ID is
`sanityKit.folders`; no separate `site` configuration is required. Hide it from normal content
lists and creation menus. Organizational changes take effect immediately without
a publishing step; frontend rendering does not depend on this metadata. Define
size limits and concurrent-write safeguards before shipping.

Inferred folders should become persistent too: an explicit initial synchronization
adopts them, kit-managed URL changes preserve existing and destination ancestors,
and imports can invoke the same synchronization. Viewing the navigator stays
read-only. Once adopted, inferred and explicitly created folders share the same
lifecycle. This does not automatically persist arbitrary external changes before
they have been synchronized.

The approved first removal workflow is **Remove folder** in the navigator, only
for an empty folder: no index page, descendant pages, or saved subfolders. It
removes the folder record without changing document URLs. The operation must
recheck occupancy before writing; the currently displayed tree alone is not
sufficient, particularly when drafts
and published content differ. Concurrency safeguards remain to be designed.

Removing a populated folder and lifting its descendants into its parent is a
different bulk URL-change operation, not simple folder removal. It can create
conflicting paths and affect published URLs. It is not part of the approved
empty-folder removal workflow.

### URL cleanup — agreed October 29, field integration pending

The internal preparation layer can now propose separator cleanup, but it is not
connected to Studio yet. The planned URL field will clean up mistakes when an
editor finishes editing: collapse repeated slashes and remove trailing slashes, while preserving
the site root `/`. For example, `/about//team/` becomes `/about/team`. Show the
resulting value in the field and check for a conflicting page URL before applying
the change. This does not allow nested slugs in collection fields: those still
accept a single segment beneath their locked prefix.

Cleanup belongs in the authoring field, not the navigator. The navigator must
not silently rewrite stored paths or preview a different URL. Field validation
must also identify malformed values from imports or API writes, which can bypass
the input component; Studio validation does not prevent those writes at the
dataset level. Keep affected documents accessible so an editor can correct them.

The current project content is test content. Its separator mistakes can be
corrected during that implementation without redirect work, but URL collisions
still need checking. This is not permission to silently migrate future consumer
datasets. No dataset cleanup has been performed as part of this documentation.

“Ungrouped pages” is a transitional fallback, not an intended destination for
normal authoring. Keep it until the field, validation, and test-content audit
are complete. Once malformed separator paths are classified as invalid by the
shared URL rules, route them to an actionable invalid/missing-URL section instead
of retaining a separate group for otherwise valid URLs. Update the section label
and tests in that slice; do not hide malformed documents. Empty sections already
disappear automatically.

### Rename a folder

Open **Rename folder** from the navigator's folder actions, then review the
affected URLs in a modal before applying. Changing a single page's URL in its
field is different from renaming the folder and moving all nested paths.

The sketches only change local demo state. Approved October 31: show old/new URLs
and live impact; require explicit **Apply URL changes** confirmation; keep
draft-only documents unpublished; and patch only URL fields on published pages
and matching existing drafts, without publishing unrelated draft content. Stop
for conflicting planned draft URLs or affected release versions. Use a bounded
transaction with revision guards; changes during review require a refreshed
review. Too-large operations must not silently become partially applied batches.

Permissions, concurrent new documents/versions, collision checks, and redirects
remain implementation gates. Revision guards do not create a database-wide URL
uniqueness constraint. Storing complete paths does not create parent references
or make descendant paths update automatically. Code-owned collection prefixes
must not become editor-renamable through this workflow.

### Details still to harden — updated October 31

- **Collection settings:** finalize the preferred per-collection document
  arrangement, fields, registration, optional overview relationship, and the
  controlled publication integration. The draft-preview/published-activation
  lifecycle is agreed.
- **Folder implementation:** define exact fields, size
  limits, and safe synchronization/concurrency mechanisms. The private singleton,
  immediate organizational lifecycle, adoption of inferred folders, and empty-only
  removal are agreed.
- **Bulk-change implementation:** prove permissions, revision guards, new-document
  race handling, size bounds, recovery, and cache/redirect coordination. The
  URL-only write policy and initial release-version refusal are agreed.
- **Detailed APIs:** settle function/configuration names, result wrappers and
  error codes and template parameters. Sanity-compatible generation is now agreed. The root
  value, pure resolution, configurable title source and slug generation, explicit
  failure categories, and one-versus-many chooser behavior are agreed.
- **Redirect defaults:** review the defaults and integration gates in the separate
  subsystem design. The design exists; its presence does not mean every proposed
  status code, query-string policy, or cache-failure behavior has been approved.

These are subsequent implementation decisions, not reasons to change the current
fixed-prefix/slug-only routing contract. No settings documents, folder records,
or page URLs have been written by this documentation update.

Concrete recommendations for these open contracts are in
[Pages contracts and proposals](pages-design-proposals.md), with October 31
approvals distinguished from remaining suggestions. None of these future APIs
or workflows should be treated as implemented behavior unless explicitly linked
to the working [fixed-prefix URL helper](url.md).
The separate [redirect subsystem design](redirects-design.md) covers proposed
redirect records, publication integration, request handling, and cache adapters
without deciding the remaining Pages contracts.

## Where to read the implementation and evidence

The source paths and fixture links below refer to a repository checkout at the
same revision. Local package builds include the compiled plugin and this guide,
but not the test fixture. Only `/studio` is a supported Studio import; compiled
implementation paths are private. Nothing in this slice publishes a release.

- `src/url/registry.ts`: shared configuration and pathname checks; no Studio
  runtime import and no database writes. `src/studio/pages/registry.ts` is the
  private bridge used by the navigator and Presentation resolvers.
- `src/studio/pages/resolvers.ts`: query projection and native Presentation
  resolver definitions. It returns configuration, not an editor or a router.
- `tests/fixtures/pages-studio/routes.ts`: the fixture's application-owned registry.
- `src/studio/pages/model.ts`: targeted header identity queries and preview-path matching.
- `src/studio/pages/browser.tsx`, `tree-browser.tsx`, and `collection-browser.tsx`:
  shared shell, inferred folder rendering, and incremental collection mode.
  `page-row.tsx` opens documents through native Presentation; `document-status.tsx`
  isolates native version/status APIs. `data-warning.tsx` provides the shared retry message.
- `src/studio/pages/navigation.ts`, `queries.ts`, and `snapshot.ts`: the
  navigator's tree model, bounded query plans, and ordinary-page snapshot reader.
  The shared session loads these resources for the browser.
- `src/studio/pages/data-store.ts`, `data-session.ts`, and `data-source.ts`:
  tool-scoped sessions, shared read lifetimes, and the authenticated transport.
  `use-page-data.ts` selects the session inside native Presentation. Components
  subscribe to its resources through React's external-store subscription API.
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
