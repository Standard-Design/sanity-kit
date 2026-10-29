# Pages Studio integration — in development

Pages is the planned page browser inside Sanity Studio. It helps editors find a
page, preview it, and open its document without leaving Sanity's native
Presentation tool.

**This is not part of the released package.** The repository currently contains
an integration proof and internal routing helpers. There is no public
`@standard-design/sanity-kit/studio` import or `pagesTool()` factory yet. The
approved navigator and URL-field designs below are plans, not working package
features.

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
for a complete internal example, supported field paths, validation rules, and
resolver overrides. These are development interfaces, not consumer imports.

## How a document becomes a browser entry

The fixture's `routes.ts` creates the shared registry. Its `model.ts` uses
`pageProjection()` to build a small GROQ projection: document ID, document type,
title, and pathname. A projection selects and names fields; it does not fetch
anything by itself. Different schema fields become the same `title` and
`pathname` properties in the result.

`useProofDocuments()` fetches those records using Studio's selected perspective
(the content view, such as drafts or a release). It listens for changes to the
registered types and refetches after changes become query-visible. It cancels
obsolete requests and cleans up the listener when the component unmounts.

This is deliberately a small proof: it fetches at most 50 documents, ordered by
last update, and searches only that loaded list. It is not a complete collection
browser, a shared query cache, or proof of correct draft/release reconciliation.
Incremental loading and the final data layer remain future work.

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
the now-removed button. These behaviors belong to the internal adapter, not to
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
same revision. The compiled package includes this guide, but not the internal
Studio source or test fixtures. Including the guide does not expose a Studio API.

- `src/studio/pages/registry.ts`: configuration and pathname checks; no Studio
  runtime import and no database writes.
- `src/studio/pages/resolvers.ts`: query projection and native Presentation
  resolver definitions. It returns configuration, not an editor or a router.
- `tests/fixtures/pages-studio/routes.ts`: the fixture's application-owned registry.
- `tests/fixtures/pages-studio/model.ts` and `proof-browser.tsx`: the bounded
  document query, preview-page identity, and browser selection behavior.
- `tests/fixtures/pages-studio/presentation-adapter.tsx` and `browser-state.tsx`:
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

The distribution build excludes `src/studio/`, and package checks guard that
boundary. The fixture's development dependencies are not a supported Studio peer
matrix. Keep this guide, source comments, configuration examples, and acceptance
record up to date as each implementation slice replaces a planned behavior.
