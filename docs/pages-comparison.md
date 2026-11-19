# Pages comparison with Tinloof

Reviewed November 18, 2026. This records strengths to preserve, differences to
understand, and recommendations for future work.

SanityKit is assessed at `0.1.0-alpha.8`, release commit `a19ec3e`. Tinloof is
assessed at the published `@tinloof/sanity-studio@3.3.0` and matching repository
commit `2964ee66121e660a50a1ed2ba9ec1711836ade3c`. Its related Next.js redirect
helper in `@tinloof/sanity-next@3.3.0` is included where relevant. The review inspected the published Tinloof
tarball, source, documentation, and issue history. Tinloof was not installed in
a live Studio for this audit. Accessibility and performance comparisons are
therefore implementation observations, rather than comparative measurements.

Tinloof's Pages navigator, pathname field, and surrounding Studio helpers are
the main comparison. Our folder writers, collection settings, redirect handling,
and frontend helpers extend the scope beyond a navigator. Tinloof's section
pickers, Portable Text features, SEO schemas, and broader Next.js integrations
are adjacent products with their own evaluation needs.

Sources include the [Tinloof plugin documentation](https://www.sanity.io/plugins/sanity-kit),
[published package](https://www.npmjs.com/package/@tinloof/sanity-studio/v/3.3.0),
and [reviewed source commit](https://github.com/tinloof/sanity-kit/tree/2964ee66121e660a50a1ed2ba9ec1711836ade3c).

## Overall assessment

Both tools make native Presentation easier to navigate and add a more helpful
pathname control. Tinloof offers a shorter setup path for conventional pages,
integrated locale support, and richer schema-defined document previews.
SanityKit adds explicit routing contracts, reusable slug-only collections,
persistent folders, and coordinated URL changes with redirects and recovery.

For Standard Stack's current requirements, our design has useful capabilities
worth retaining. Its main cost is the amount of integration and operational
behavior we maintain. The next improvements should make those capabilities
easier to configure, observe, and support alongside normal Studio behavior.

## Design decisions and their effects

The following usability assessments are design judgments based on the inspected
interfaces and code. Comparative editor testing would establish which tradeoffs
matter most in a particular Studio.

### Directory navigation and expandable trees

Tinloof shows one directory at a time. Clicking a folder replaces the current
list with its contents, and Back or Home returns to the parent or root. Our
folder disclosure expands its children inside the current list. Clicking a page
opens its preview/editor while surrounding branches can remain visible.

For example, an editor comparing `/about/company` and `/services/consulting`
can expand both branches in our navigator and alternate between their pages.
In a directory browser, they return to the root and enter the other branch, or
use search. Conversely, an editor working through many pages in one deep folder
gets a shorter, less indented list from the directory approach.

| Design concern                      | Directory navigation                                                                              | Expandable tree                                                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Understanding the broader structure | The list emphasizes the current folder. Parent/root controls provide the way out.                 | Ancestors and neighboring expanded branches can stay visible together.                                                                                |
| Switching between distant branches  | Requires leaving one directory and entering another, or searching.                                | Can be a single page selection once both branches are expanded.                                                                                       |
| Narrow panels and deep paths        | Full row width remains available at each level.                                                   | Indentation consumes width and competes with titles, URLs, status, and actions.                                                                       |
| Long lists                          | Other branches are hidden until entered. A large current directory still needs search/pagination. | Many expanded branches can create a long scrolling list. Virtualization reduces mounted rows while preserving the same long logical list.             |
| Interaction meaning                 | Folder clicks enter a location; page clicks open a document.                                      | Disclosure and selection have distinct meanings. Clear chevrons, focus, and page/folder styling matter.                                               |
| Index pages                         | Can appear within their directory alongside its children.                                         | A separate named page under its folder keeps opening the index independent from expanding children.                                                   |
| Returning to a browsing location    | Tinloof stores its current directory and locale in the URL.                                       | Our expansion, search, and scroll state survive sidebar/picker changes during the tool session. Reload persistence would need an additional contract. |

Our current recommendation is to retain the tree for ordinary pages and the
focused list for large collections. This supports moving between site sections
without expanding hundreds of posts into the same hierarchy. Before adding a
second general browsing mode, evaluate reveal-current-page behavior, collapse-all,
better deep-path presentation, and retained browsing state across reloads. An
optional focus-folder view could follow if editors need it.

Navigation shape does not determine storage or loading strategy. A directory
browser can use persisted folders, and a tree can infer them. Either can load
children on demand. Tinloof's reviewed directory UI still queries all matching
page routes; our tree reads the complete ordinary-page snapshot in batches.
Changing the UI alone would therefore not settle data scalability. See
[Tinloof's navigator](https://github.com/tinloof/sanity-kit/tree/2964ee66121e660a50a1ed2ba9ec1711836ade3c/packages/sanity-studio/src/plugins/navigator),
[our visible tree rows](../src/studio/pages/visible-rows.ts), and
[our collection browser](../src/studio/pages/collection-browser.tsx).

### Persisted folders and folders inferred from paths

Tinloof treats a folder as a consequence of existing URLs. It needs no separate
folder records, and changing the last page's URL naturally removes that inferred
folder. Our persisted folders give editors something stable to create, rename,
and remove, even before a page uses that destination. That stability introduces
metadata storage, synchronization, permissions, and empty-folder cleanup actions.
It is an intentional editor-experience tradeoff.

In both models, URL-derived folders describe URL organization. An About page and
an About folder may share a path while remaining separate concepts. Keeping our
named index page as a child avoids giving the same row both disclosure and
document-opening behavior. It also adds a row. Neither model supplies a website's
navigation menu or a semantic content hierarchy automatically.

### Explicit collection identity and general URL folders

Our collection is a configured group of content types with settings and item
creation actions. Its display name can differ from its route prefix, and its
items can remain reusable slug-only content. A folder represents URL placement.
Tinloof's general navigator organizes matching documents by their resolved paths,
which gives a more uniform browsing model with less collection-specific setup.

Our approach supports separate treatment of hundreds of articles and a small
number of ordinary pages. The price is teaching editors the collection/folder
distinction and maintaining a configuration shared with the consuming app.
Distinct icons and appropriate action menus should carry that distinction.

### Conventions and explicit registration

Tinloof's `pathname.current` convention makes adoption concise. Our explicit
registration supports different field names, stored slugs, reserved app routes,
and shared frontend resolution, but takes more configuration. Optional page/SEO
schema helpers could reduce setup repetition later while keeping the underlying
content and route contracts clear. A future convenience layer should preserve
consumer-owned schemas and native preview configuration.

### Immediate field feedback and coordinated URL changes

Tinloof's pathname field emits ordinary form patches and offers manual preview
navigation or debounced following. Our field prepares the URL, checks conflicts,
preserves folder metadata, and then emits a native draft patch. Publishing a
changed live URL can additionally review and update redirects. This reduces
manual coordination for structural edits but introduces async checks, local
pending input, and more possible recovery states.

The design goal should remain that routine editing feels ordinary. Show review
only where the editor has a meaningful routing decision, use native validation
and transient success feedback, and make checked input that has not yet reached
the native draft easy to understand. Our saved-state preview boundary is useful
because navigating before the new route is query-visible can produce a temporary 404. The website's preview bridge must also survive such a 404.

## Feature comparison

| Area                      | SanityKit alpha.8                                                                                                                                                                | Tinloof Studio 3.3.0                                                                                                                                             | Practical tradeoff                                                                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native editor and preview | Wraps Presentation and keeps its editor, iframe, navigation, permissions, and actions. Adds a header page picker.                                                                | Wraps Presentation with a directory navigator.                                                                                                                   | Both reuse Sanity's editor and preview. Our picker gives navigation access with the sidebar hidden.                                                           |
| Page registration         | Registers schema types and their pathname or slug fields explicitly. Supports different stored field names.                                                                      | Discovers documents through a populated `pathname.current` field.                                                                                                | Our configuration supports more content models and keeps incomplete registered pages discoverable. Tinloof requires less setup for its conventional model.    |
| Navigation shape          | Expandable tree, page paths, native version indicators, and separate collection views.                                                                                           | Browse one directory at a time, with back/root controls, schema previews, and virtualized rows.                                                                  | Our tree exposes neighboring branches. Tinloof's directory view limits visible detail and supports media previews.                                            |
| Folders                   | Persisted metadata supports empty folders, nested creation, empty-only removal, and reviewed rename.                                                                             | Folders are inferred from paths. Folder title/icon customization is available.                                                                                   | Persistence supports planning an empty structure, while introducing metadata writes and synchronization. Tinloof's inferred model has less state to maintain. |
| URL field                 | One factory supports folder or full-path text controls, generation, copy feedback, and native slug storage.                                                                      | Full-path input can lock its existing folder and expose the final segment. Supports generation and a Preview button.                                             | Our picker reduces repeated typing of existing folder paths. Tinloof's control has fewer moving parts.                                                        |
| Collections               | Registered item types can store one-segment slugs under code-owned or settings-owned prefixes. Includes settings/create actions, recent items, pagination, and collection icons. | Prefixed documents can appear in the general page tree. A dedicated collection/settings/pagination contract was not found in the reviewed navigator.             | Our collection model keeps reusable content separate from site structure. It requires coordinated Studio and frontend configuration.                          |
| Internationalization      | No first-class locale switcher, locale-aware creation, or locale-scoped URL ownership.                                                                                           | Locale filtering, URL localization, locale-aware creation, and pathname uniqueness are integrated.                                                               | This is Tinloof's clearest functional advantage for multilingual sites.                                                                                       |
| Document previews         | Configured title field, URL subtitle, standard page icons, and native status indicators.                                                                                         | Uses schema preview title, subtitle, media, and icons, with folder customization.                                                                                | Our rows are consistent and lightweight. Tinloof better reflects each document type's configured preview.                                                     |
| Saved URL following       | Ordinary pages follow query-visible saved changes in the active Drafts or Published perspective, preserving query and fragment.                                                  | Preview button by default, with optional one-second debounced navigation from field changes.                                                                     | Our saved-state boundary avoids navigating ahead of persistence. Tinloof exposes an explicit manual/automatic choice.                                         |
| URL changes and redirects | Reviewed page publishing, folder rename, and collection-prefix publishing can coordinate redirects and recover uncertain outcomes.                                               | The reviewed navigator/field does not coordinate equivalent bulk URL workflows. The separate redirect schema and Next helper provide manual redirect management. | Our workflow reduces manual coordination at the cost of more checks, permissions, and state.                                                                  |
| Customization             | Native resolver overrides, registered templates, collection icons/labels, and editable/locked collection settings.                                                               | Locale hooks, folder titles/icons, role-based filters, configurable navigator widths, and Presentation component overrides.                                      | Tinloof exposes more visual/composition controls. Ours constrains the component slots that coordinate shared state.                                           |
| Frontend integration      | Pure URL resolution, settings loading, framework-independent redirect/cache APIs, and a React Router adapter.                                                                    | Web URL helpers and a more integrated Next.js package.                                                                                                           | Our boundaries suit different application stacks. Tinloof reduces assembly work for its supported Next.js setup.                                              |

These observations come from the
[navigator plugin and configuration](https://github.com/tinloof/sanity-kit/tree/2964ee66121e660a50a1ed2ba9ec1711836ade3c/packages/sanity-studio/src/plugins/navigator),
[pathname field](https://github.com/tinloof/sanity-kit/blob/2964ee66121e660a50a1ed2ba9ec1711836ade3c/packages/sanity-studio/src/components/PathnameFieldComponent.tsx),
[types](https://github.com/tinloof/sanity-kit/blob/2964ee66121e660a50a1ed2ba9ec1711836ade3c/packages/sanity-studio/src/types.ts),
and [our Pages guide](pages.md).

## Our strengths to preserve

### Content models and routing stay explicit

An ordinary website page stores its full pathname. A reusable collection item
can store only its slug, with its site prefix supplied separately. The same
registration drives URL resolution, navigation, location links, and conflict
checks. A consumer can use explicit application routes, a catch-all, or a mix.
The Studio field can also be installed without Pages. This supports content
reuse while giving editors a consistent URL control.

The collection display name, stable identifier, item labels, optional custom
icon, and editable or locked prefix have distinct purposes. Keeping them
separate lets editors rename a collection without changing its URL or identity.
See [URL fields](url-field.md), [URL resolution](url.md), and
[collection settings](collection-routing.md).

### Structural changes have a complete editor workflow

Empty folders survive moving their last page. Editors can create nested folders
before adding content, create a folder's index page, and rename a folder with a
review of affected URLs. The index is an ordinary page document, which avoids a
special document model solely for its position in the tree.

Folder renames update reviewed URL fields while preserving unrelated draft
content. Collection-prefix changes update settings while preserving item slugs.
Both can update existing redirects directly to the final destination. Editors
can choose whether to create additional redirects from old URLs. See
[folders](folders.md) and [collection publishing](collection-settings-publication.md).

### Conflict handling and recovery are deliberate

Resolved paths are checked across registered page types and collection types,
with reserved paths/prefixes and active redirect sources included where relevant.
The same final segment can appear under different valid prefixes. The edit and
publish stages have distinct responsibilities, and the final write rechecks
reviewed evidence. Revision guards protect existing records from stale writes.

Uncertain writes retain operation evidence and offer status checks. The UI
identifies conflicting documents and redirects and keeps errors available for
correction. Success closes the review and uses Studio feedback. These are useful
capabilities to retain as the APIs evolve. Their scope and concurrency limits
remain important. See [URL publishing](url-field.md) and [redirects](redirects.md).

### Preview and browsing use the selected content view

The shared read session uses Studio's selected perspective. Navigation, identity
queries, cancellation, and reconnect handling are coordinated. Query-visible
ordinary-page moves follow the iframe only when its old path matches the page
being edited. Shared content and unrelated preview routes retain their context.

The Tinloof navigator's reviewed read helper specifies `previewDrafts`, so its
listing can differ from a Published preview. This is a source observation whose
live behavior should be checked before treating it as a universal comparison.
See [our shared sessions](../src/studio/pages/data-session.ts),
[saved URL following](../src/studio/pages/use-page-data.ts), and
[Tinloof's read helper](https://github.com/tinloof/sanity-kit/blob/2964ee66121e660a50a1ed2ba9ec1711836ade3c/packages/sanity-studio/src/plugins/navigator/utils/index.tsx).

### Large collections have a separate read strategy

Ordinary pages are fetched in batches of 100. A collection preview reads five
recent items, and its full view loads 50 items at a time with a stable cursor.
Collection search runs in Content Lake. Large visible lists are virtualized,
including wrapped row heights, keyboard traversal, and restored scroll positions.

Tinloof also uses TanStack virtualization, so virtualization itself is a shared
technique. Our additional advantage is keeping large collections out of the
ordinary-page snapshot. The reported 1,000-page profiling results establish an
improvement over our earlier renderer; they do not compare speed with Tinloof.
See [query plans](../src/studio/pages/queries.ts),
[our measurements](navigator-acceptance.md), and
[Tinloof's list](https://github.com/tinloof/sanity-kit/blob/2964ee66121e660a50a1ed2ba9ec1711836ade3c/packages/sanity-studio/src/plugins/navigator/components/List.tsx).

### Integration boundaries and verification are explicit

Consumers retain their own Studio and application. Frontend URL and redirect
APIs can be used without loading Studio. Cache storage stays with the consumer.
Installed-package checks exercise Studio composition, frontend imports, SDK
versions, redirects, TypeGen, and package isolation. The release includes setup,
upgrade, and subsystem guides. Live fixture checks and mocked browser checks are
recorded separately from production acceptance. See [prerelease verification](prerelease.md#verification-and-handoff).

## Weaknesses and implementation tradeoffs

### Permission checks can be restrictive

To reason about conflicts, URL editing requires visibility across the registered
page versions and folder metadata. Publishing needs additional redirect and
recovery-record visibility. The grant interpreter understands a bounded subset
of GROQ, so a legitimate custom role can remain unverified. A visible-page filter
alone cannot make a partial dataset sufficient for a global conflict check.

Validate a real restricted-editor installation and document the minimum useful
role. Broaden supported grant expressions only with evidence and focused tests.
For more complex deployments, consider a trusted checking service that can
answer conflict questions while keeping document mutation permissions native.
That would introduce a server component and requires a separate design. See
[access requirements](url-field.md) and [grant interpretation](../src/studio/url/access.ts).

### The complete redirect inventory has a broad failure effect

Redirects are validated as one inventory. The built-in HTTP response helper and
React Router middleware produce a 503 when that check fails. When middleware is
installed on a broad route, an invalid active rule, unavailable origin, failed
cache read, or exceeded inventory bound can affect requests unrelated to the
problem rule. This deserves an explicit consumer-facing operational guide.

The optional cache reduces repeated data fetching. Each cache hit is still
validated and compiled against the current policy, so it does not eliminate
work proportional to the inventory on each handled request. Include that CPU
cost when profiling a larger redirect list.

Evaluate a bounded last-known-good snapshot and explicit failure-policy hooks,
with a defined lifetime, diagnostics, and invalidation behavior. Preserve the
ability to explain which rule failed. A stale snapshot can keep an obsolete
redirect alive, so this choice needs a clear contract. See
[request handling](../src/redirect/request.ts),
[React Router middleware](../src/react-router/server/redirects.ts), and
[snapshot validation](../src/redirect/snapshot.ts).

### Our current bounds are reachable on growing sites

The folder registry allows 1,000 folders and a 10,000-version raw page inventory.
The redirect snapshot allows 1,000 records and 1 MiB of projected data. Disabled
redirect records still count toward record and size bounds. A folder rename
allows 100 changed page versions and 100 combined redirect creations/updates;
published and draft versions count separately. Individual request limits apply
as documented in the relevant writers.

These are deliberate implementation bounds, rather than Sanity platform limits.
An expanding redirect history can eventually block checked publication or
runtime resolution. Measure realistic inventories, expose useful counts, and
design archival, scalable lookup, and larger reviewed operations before raising
constants. Prefix redirects are one possible route for repeated folder moves,
with overlap and exception rules still to design. See [folder bounds](folders.md),
[redirect bounds](redirects.md), and [prefix redirects](redirects-design.md#future-direction-prefix-redirects-for-folder-renames).

Recovery receipts also accumulate as metadata. Folder rename receipts are
deliberately retained so an older browser tab can still confirm its operation.
Document their storage cost and design a supported retention procedure before
deleting them automatically. See [receipt retention](folders.md#recovering-when-the-response-is-lost).

### Virtualization solves rendering cost only

The ordinary-page tree still requires a complete in-memory page snapshot.
Registered-type mutations invalidate all active session resources, including
the page tree and loaded collection batches. Typing or editing a busy collection
can therefore cause repeated queries unrelated to the changed document's URL.
Identity and search descriptors are retained for the tool session even after
their result bodies are cleared.

Profile query counts, response bytes, long sessions, reconnects, and concurrent
editors. Consider narrowing invalidation using mutation identity/type, separating
URL-relevant changes from other changes where reliable, and bounding descriptor
caches. On-demand folder reads are a larger architectural option if realistic
sites outgrow the complete snapshot. See [data sessions](../src/studio/pages/data-session.ts),
[data stores](../src/studio/pages/data-store.ts), and [snapshot reads](../src/studio/pages/snapshot.ts).

### Revision checks do not establish global URL uniqueness

Existing documents can be guarded by revision. A new conflicting document can
still appear between a collision read and the write, and external API clients
can bypass the Studio workflows. The current checks reduce risk and report
conflicts, but do not provide a database-wide unique index.

Keep that limitation visible in import guidance. If a concrete deployment needs
a stronger guarantee, design coordinated URL claims or a single trusted write
boundary used by every participating writer. A reservation system used by only
some writers would leave the same gap. See [publication planning](../src/studio/url/publication-plan.ts)
and [import synchronization](folder-import.md).

### Native integration requires ongoing compatibility work

The navigator/header slots are unstable Presentation APIs, and the status
adapter uses native APIs marked internal or beta. The package pins Sanity
6.17.0. Checked Publish wrappers also coordinate validation, permission checks,
receipts, and dialog state around native actions. Studio peer alignment,
including the translation context used by the Delete warning, adds installation
work for consumers.

Maintain installed-Studio acceptance on upgrades and isolate the native adapters.
Document the supported composition order and keep the simple installation path
short. Tinloof also uses the unstable navigator slot, so this is shared platform
exposure; our additional header and publication integrations increase our own
maintenance surface. See [our plugin](../src/studio/pages/plugin.tsx),
[status adapter](../src/studio/pages/document-status.tsx),
[publishing installer](../src/studio/url/publication-plugin.tsx), and
[Tinloof's plugin](https://github.com/tinloof/sanity-kit/blob/2964ee66121e660a50a1ed2ba9ec1711836ade3c/packages/sanity-studio/src/plugins/navigator/index.ts).

### Some useful workflows and customization remain limited

Saved URL following currently covers ordinary pages. Editing a collection item's
slug can therefore leave its preview at the old URL until the editor navigates
again. Extend that workflow with saved-state and perspective checks before
describing automatic URL following as a general Pages capability. Release and
historical editing need their own explicit policy.

Locale-aware content is the largest missing product capability. Navigator rows
also cannot use native schema preview media, prepared titles, or custom page-type
icons. Ordinary folders lack configurable display names/icons. Search does not
find an empty folder by name, there are no status filters or user-selected sort
orders, and there is no navigator search shortcut comparable to Tinloof's
Cmd/Ctrl+Shift+F.

Folder rename changes its last segment but cannot reparent it. Collection
registration requires an index pathname/type even though the settings document
owns the prefix independently. This creates unnecessary configuration for
collections with several listing pages or no dedicated index. Release-aware URL
changes, arbitrary creation-template parameters, and populated-folder removal
remain deferred. An editor can still work with content through the native Studio
outside those unsupported URL operations. See [route contracts](../src/url/registry.ts),
[folder rename](../src/studio/folders/rename.ts), and [the release plan](pages-release-plan.md).

### Documentation carries too much historical implementation detail

The main guides contain useful architectural explanations, but dated development
records and private-layer descriptions can obscure the current installation
path. Some historical proposal and source-comment text still describes shipped
folder or collection-publishing work as future work. Clearly identify dated
records, link them from a current guide, and reconcile misleading status claims.
Keep the short install path, conceptual architecture, API reference, and historical
decisions easy to distinguish. See [the design record](pages-design-proposals.md).

## Future work to consider

These priorities are recommendations for review. They do not change previously
approved implementation scope.

| Priority            | Candidate                                                                                         | Why consider it                                                                                                         | Evidence needed before implementation                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Near term           | Redirect inventory counts, diagnostics, and failure-policy design                                 | An unrelated bad rule or growth limit can affect publishing and broad request handling.                                 | Model failure behavior and acceptable snapshot age with the consuming application.                               |
| Near term           | Restricted-editor acceptance and concise role guidance                                            | Broad visibility and unrecognized grant expressions can block otherwise useful editing workflows.                       | A real restricted account and representative role filters.                                                       |
| Near term           | Current quick start and historical-doc cleanup                                                    | The feature set is already substantial; adoption should require less interpretation.                                    | A consumer follows the guide without relying on the development conversation.                                    |
| Near term           | Resource/invalidation profiling                                                                   | Rendering performance is only one part of scalability.                                                                  | Query/byte counts and retained memory during large collections, typing, reconnection, and long sessions.         |
| Near term           | Saved URL following for collection items                                                          | Collection editors should get the same continuity when a saved slug changes.                                            | Draft/Published separation, settings-backed prefixes, query/fragment preservation, and unrelated-preview checks. |
| Next usability pass | Schema preview title/media/icon support, folder customization, folder search, and search shortcut | Tinloof offers helpful recognition and navigation affordances here.                                                     | Mockups plus cost checks so media/preview subscriptions do not undo list improvements.                           |
| Next API pass       | Optional collection index association                                                             | Item routing and listing pages already have independent responsibilities.                                               | Cover settings-only collections and several independently routed listing pages.                                  |
| When required       | Locale-aware registration, navigator filtering, creation, URL ownership, and folder identity      | Tinloof has substantial built-in support. Prefixing a translated URL alone would leave conflicts and folders ambiguous. | A real multilingual content model and frontend locale-routing policy.                                            |
| When required       | Reviewed folder moves between parents                                                             | Reuses much of the existing rename review/recovery workflow.                                                            | Collision, redirect, draft, and folder-identity behavior for reparenting.                                        |
| When required       | Larger redirect inventories, prefix rules, or coordinated URL claims                              | Addresses demonstrated scale or stronger write guarantees.                                                              | Real inventory measurements and a contract covering all participating writers.                                   |
| When required       | Release-aware URL moves and richer creation parameters                                            | Supports more of native Studio's publishing and template workflows.                                                     | An actual release/template use case and explicit version/parameter handling.                                     |

An initial accessibility review should accompany the usability pass. Exercise the
picker, virtual rows, nested creation menus, and conflict dialogs with a screen
reader and keyboard at narrow widths. Existing keyboard tests give useful
coverage; they do not establish the full assistive-technology experience.

## Tinloof details worth keeping in perspective

Tinloof provides role-based list filters. They control navigator visibility;
Content Lake permissions still determine access. A filter is not a replacement
for permission checks or a guarantee that hidden pages cannot own URLs.

Tinloof's folder locking controls editing a single document's pathname. It does
not supply the subtree rename workflow reviewed here. The open
[folder rename request](https://github.com/tinloof/sanity-kit/issues/21) supports
this distinction. Its pathname uniqueness query compares stored paths and locale;
the prefix-aware collision problem also has an
[issue history](https://github.com/tinloof/sanity-kit/issues/146). Audit the actual
configured prefix contract before making a stronger compatibility claim.

Tinloof's redirect schema permits absolute destinations and per-rule query
preservation. Its Next helper also offers exact query-string matching. Our
redirects currently use canonical internal destinations, exact path matching,
and a consumer-supplied query allowlist. External redirects and campaign-query
rules are reasonable candidates when a consumer needs them, with explicit
destination and matching policies. They should be evaluated separately from
automatic internal redirects created by page URL changes. See
[Tinloof's redirect schema](https://github.com/tinloof/sanity-kit/blob/2964ee66121e660a50a1ed2ba9ec1711836ade3c/packages/sanity-studio/src/schemas/redirects.tsx),
[Next redirect helper](https://github.com/tinloof/sanity-kit/blob/2964ee66121e660a50a1ed2ba9ec1711836ade3c/packages/sanity-next/src/utils/redirect.ts),
and [our request API](redirects.md).

Neither tool should be assumed to provide editorial navigation menus, breadcrumbs,
or arbitrary semantic parent/child relationships merely because it displays URL
folders. Model those relationships explicitly when the website needs them.
Likewise, neither navigator by itself installs the consuming application's routes
or cache invalidation infrastructure.
