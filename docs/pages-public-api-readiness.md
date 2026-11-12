# Pages public API readiness

This is a source and packaging audit, not an installation guide or a claim that
Pages is release-ready. It was checked against commit `77b0fa2` on November 10, 2026.
Collection-prefix review, read-access checks, and the writer/recovery core are
committed. The native write/schema checks and editor workflow still need
integration. Final exports should wait for that workflow's contract, as agreed
in the [release plan](pages-release-plan.md).

## What is public in this checkout

`@standard-design/sanity-kit/studio` exports `pagesTool` and its route, creation,
and collection UI configuration types. `@standard-design/sanity-kit/url` exports
`createSanityUrlResolver`, its result types, and the shared fixed-route types.
These are real entries in `package.json`, not proposed future entries. This does
not mean they are present in the already published alpha artifact.

The root remains the core API. It does not import Studio. The build emits all
source modules into `dist`, including private implementation files, but package
exports restrict which paths consumers can import. A file being present in the
tarball does not make it a supported public API.

The current tarball consumer fixture installs the Studio peers, imports
`pagesTool` from `/studio`, type-checks it, and bundles a consumer-owned Studio.
Its schemas use ordinary Sanity slug fields and fixed collection prefixes.
It does **not** install the kit's URL field, settings editor, publication review,
or redirect management. The development Studio uses source-relative imports for
those parts, so its success cannot establish that a consumer can install them.

## Integration boundaries to expose

The following names already exist in source. The proposed import locations are
recommendations for the final export review, not imports consumers can use today.
Keep small wiring APIs public; leave dialogs, stores, planners, permission
adapters, and recovery machinery private unless a consumer actually needs them.

| Consumer need                                       | Existing integration                                                                                                                                                                                         | Proposed location                                                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Pages around native Presentation                    | `pagesTool`, `PagesToolOptions`, `PagesCollectionUiOptions`, `PagesCreateOptions`                                                                                                                            | Keep `/studio`                                                                                                         |
| URL input in Pages or ordinary Structure            | `defineSanityUrlField`, `SanityUrlFieldDefinition`; `withUrlPublication`, `UrlPublicationPluginOptions` for published-page editing and publishing checks                                                     | Add to `/studio`                                                                                                       |
| Collection settings in the consumer's Studio        | `withCollectionRoutingSettings`, `CollectionRoutingSettingsOptions`, `collectionRoutingSettingsItems`                                                                                                        | Add to `/studio` after prefix publishing is complete                                                                   |
| Resolve URLs using separately supplied settings     | `createCollectionRouting`, `CollectionRoutingConfig`, `SettingsCollectionDefinition`, `CollectionSettingValue`, `RoutingSettingsSnapshot`, `CollectionRoutingResult`                                         | Add pure resolution/configuration to `/url`                                                                            |
| Read collection settings with an application client | `createCollectionRoutingLoader`, its client/request/result types                                                                                                                                             | A separate `/url/settings` entry; keep its GROQ dependency out of the basic `/url` import                              |
| Manage redirects in Structure                       | `redirectManagementItem`; enable checked actions through `withUrlPublication({…}, {redirectManagement: 'publish', …})`                                                                                       | Add the structure helper to `/studio`                                                                                  |
| Follow redirects in a consuming server              | `resolveRedirectRequest`, `redirectResponse`, `invalidateRedirectCache`, `RedirectCache`, `RedirectRequestOptions`; `loadRedirectSnapshot` and `compileRedirectSnapshot` are existing lower-level boundaries | A separate `/redirect` entry                                                                                           |
| Use redirects in React Router                       | `createSanityRedirectMiddleware`, `CreateSanityRedirectMiddlewareConfig`                                                                                                                                     | Add to existing `/react-router/server`                                                                                 |
| Adopt imported page folders                         | `createFolderWriter({routes}, client).synchronize(request)`; `createFolderSynchronizer` is the existing checked Studio service                                                                               | Decide the smallest supported import-helper surface before export; keep Node import jobs independent of Studio runtime |

The collection live-routing hook/provider is already wired internally by
`pagesTool` and the URL field. Consumers should not need to manually install
`CollectionRoutingProvider` or subscribe to `createCollectionRoutingStore` to
use those features. Likewise, raw schema/plugin/action internals do not need
exports simply because the development fixture can import them.

## Contracts the consumer guide must explain

**The app owns its Studio and website.** It supplies document schemas, native
templates, its Studio configuration, and frontend routes. Pages does not vend a
Studio installation or generate route files. Use one shared registration for
URL fields, Pages, publication checks, and frontend URL resolution.

**Standalone fields work without Pages.** `defineSanityUrlField` supports
`inputMode: 'folders'` and `inputMode: 'text'`. Both store native slug objects;
ordinary pages store the full path in `current`, while slug-only collection
items store the final segment. Text mode changes the control, not folder
semantics or storage. A folder picker does not require the Pages navigator.
Whole-field `readOnly` still applies. `withUrlPublication` is required for normal
draft URL editing on published documents and the checked publish workflow.
Installing the field alone currently limits editing to unpublished documents.

**Settings ownership is explicit.** `settingsDocumentId` identifies a collection
settings singleton. `displayName` and `routePrefix` independently accept default
or locked configuration; a string prefix is locked shorthand. A default seeds a
new draft, not a fallback live URL. The loader selects published or draft settings
explicitly. Draft reads require known access to the needed drafts; a successful
filtered query alone does not prove that access. Unsupported release perspectives
remain an explicit limitation. Settings publishing is still blocked by the
current wrapper until the new checked workflow is installed.

**Folders are organizational metadata.** Page URLs determine placement; folder
records are not page parents and are not required to render the website. The
internal `sanityKit.folders` registry preserves empty folders. Kit-managed edits
preserve folders, Pages runs background synchronization as a fallback, and import
jobs should synchronize after writes. The import API's access evidence and
uncertain-write recovery must be documented before it is public. Do not expose
an unchecked import shortcut merely to avoid the existing checks.

**Redirect lookup is separate from saving redirects.** The server chooses where
to run the check and supplies any cache. The kit does not provide a cache backend
or deployment infrastructure. React Router middleware is an ordered pair; both
functions must be installed together. It uses the kit's signed preview session,
including Published preview, and the router's logical URL for data requests.
Caches need a finite lifetime and safe invalidation; cache keys isolate the
project, dataset, and validation policy. Invalid or unavailable rules stop the
check rather than silently acting like an empty redirect list.

## Dependencies and compatibility

The source package requires Node 24 or later. The current Studio fixture targets
Sanity **6.17.0**, pinned exactly because Pages uses unstable native Presentation
extension slots. Studio peers include Sanity UI `^4.4.10`, icons `^5.2.2`, React
and React DOM `^19.2.7`, styled-components `^6.5.3`, react-focus-lock `^2.13.7`,
`@tanstack/react-virtual` `^3.14.22`,
i18next `^26.5.10`, react-i18next `^17.1.8`, and rxjs `^7.8.2`. They are optional
package peers so non-Studio consumers need not install them, not optional when
using a Studio entry that needs them. The isolated Studio check currently tests
the installed versions; it is not a full Studio peer-version matrix.

The client range is `^7.27.0 || ^8.6.1`; deprecated 8.6.0 is deliberately excluded.
The React Router adapter targets `^8.4.0`, not React Router 7. Query readers use
`groq` (`^5.1.0` peer). Plain URL resolution depends on the client Stega helper
but not React, Studio, or network access. Keep those import boundaries in the
package tests when adding entries.

## Minimal remaining release checks

1. Finish collection-prefix publishing, including first publication and edits
   that keep the prefix unchanged. Then settle wrapper ordering, supported
   actions, public option/result types, and the field/publication configuration
   consistency checks. Exporting unfinished internals does not complete this.
2. Extend the installed-tarball Studio fixture to use the URL field in Structure
   **without Pages**, and separately with Pages. Exercise text/folder modes,
   editable and locked settings, native templates, and redirect management.
   Compile and bundle without source aliases or workspace dependency fallback.
3. Add installed-consumer checks for settings loading/resolution and redirect
   middleware, with document and data requests, signed preview bypass, cache
   failures/invalidation, and aborts. Keep the existing minimal-client and
   browser-bundle checks proving that frontend imports do not pull in Studio
   or server-only integrations.
4. Run live acceptance in a consumer-owned Studio/app, including draft/published
   routing, permission failures, concurrent changes, recovery, and actual
   redirect following. The proof Studio's source imports remain useful evidence,
   but do not replace this installation check.
5. Reconcile and pack the subsystem guides. The committed packaging fixes
   (`afccbcc` and `b3e2831`) include the URL-field, release-plan, prefix-publication,
   prefix-access, and navigator-acceptance guides, with a check for missing local
   guide links in the actual tarball. Repeat that check as new integration guides
   are added. Keep private workflow descriptions clearly distinguished from
   public APIs. This readiness audit is a repository work document and is not
   included in the package.

The existing package check covers five application consumer profiles, the
current Studio consumer, TypeGen, package/declaration checks, and packaged guide
links. Those checks cover the current export surface, not the additional
consumer integrations listed above. This audit verifies the source exports and
check definitions; it does not add a new consumer test or establish release
acceptance. No release was published as part of this checkpoint.
