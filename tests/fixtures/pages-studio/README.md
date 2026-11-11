# Pages: native Studio integration proof

This is the native integration proof (A1), not the finished Pages plugin.
It answers a narrow question: can the kit add a browser and a header picker
without replacing Sanity's editor, preview, routing, or document actions?

Nothing in this directory is published. The reusable plugin now lives under `src/studio/` and local builds expose
`/studio`; the fixture itself is never packed. Consumers supply their own Studio
installation. Studio-only runtime packages are optional peers. The browser now
renders the folder tree and collection view, including saved folder records when
available. The private URL field now uses the internal folder writer during
editor actions, but the fixture does not call it or seed folders on startup.
Navigator folder creation, removal, and reviewed renaming are available.
Advanced filters and full release acceptance remain pending.

The plugin uses a shared internal route registry. See
[the routing foundation](ROUTING.md) for its configuration, validation,
resolver overrides, and remaining work. The A1 live integration checks are now
complete; see the dated observations in [ACCEPTANCE.md](ACCEPTANCE.md). This does
not mean the finished navigator or an npm release is available.

Collection index pages will initially require a Sanity document, including an
SEO-only document. Document-free index page entries are deferred; this does not
prevent navigating to an app-owned route in Presentation and editing its
Sanity-backed content through overlays. See
[collection index pages and app-owned routes](ROUTING.md#collection-index-pages-and-app-owned-routes).

## Run the proof

For a plain-language explanation of the architecture, the responsibilities of
each part, and the approved interface direction, start with the
[Pages subsystem guide](../../../docs/pages.md). This README covers running the
fixture; [ROUTING.md](ROUTING.md) covers its internal configuration contract.

Use Node 24 and install the repository dependencies with `pnpm install`.
Set the public configuration for an authorized test project in your shell:

```sh
export SANITY_STUDIO_PROJECT_ID=your-test-project
export SANITY_STUDIO_DATASET=your-test-dataset
```

Start the Studio from the repository root:

```sh
pnpm studio:dev
```

It listens on loopback port 3000. The project must already allow
`http://localhost:3000` as a credentialed Studio origin. This fixture does not
register a Studio, change CORS, deploy schemas, or deploy an application.

In another shell with the same project and dataset, make an appropriate
read-only Sanity token available as `SANITY_API_READ_TOKEN`, then run:

```sh
pnpm studio:preview
```

Do not put the token in a `SANITY_STUDIO_*` variable: those variables are
embedded in Studio builds. Do not commit it to a file. The preview server keeps
the token server-side and reads fixture content and kit redirect records. It starts
two loopback listeners: Studio preview on port 3334 and a published-only website
on port 3335. Both reject other Host/Origin values, send no CORS headers, and disable
HTTP caching. It is a local development server, **not a deployable preview-mode
implementation**. Do not expose it through a tunnel or public network interface.

Use port 3335 to test saved redirects as actual HTTP responses; port 3334 always
bypasses them for preview. See [the HTTP redirect walkthrough](HTTP-REDIRECTS.md)
for commands, perspective boundaries, and failure behavior.

Open `http://localhost:3000/pages-proof`. Sign in with your normal Sanity account.
Native Sanity permissions still control the editor and create intent.

## Create fixture content deliberately

### Review collection settings

Open the collection's **Settings** action in Pages, or **Articles collection
settings** in Fixture content. The displayed name follows the settings draft, so
it may currently say **Stories**. This fixture explicitly enables the private
native Publish integration. All settings checks use `proofLiveCollectionRouting`,
the same registration as Pages and the preview website.

A display-name-only edit publishes directly after checks. A change to an existing
prefix opens the URL review, including affected item URLs, redirect updates, and
the choice to create redirects from old URLs. Confirmed success closes the dialog
and shows a native toast. Publishing includes the whole settings draft; it does
not publish collection items or change their stored slugs.

The older Journal settings demo is no longer installed in this Studio. Its data
is preserved, and existing Journal pages continue to use full stored paths.
No startup seed or automatic publication is performed.

### Preview a collection prefix change

Articles uses `collection-routes.ts` in Pages, its URL field, and the website's
server loader. It stores item slugs in `slug.current`; `kitProofArticleRouting`
supplies the prefix. Existing Journal posts keep their complete stored paths.

This proof requires a deliberately created **published** Articles settings
record with `collection: 'articles'` and a valid `prefix.current`, initially
`/articles`. There is no startup seed or runtime default for an absent record.
The preview server credential must be able to read that record and its draft.
A draft-only setting works for preview but cannot supply a live routing context.

Open Articles' **Settings** action and save `/stories` in its settings draft.
Draft navigation and preview links should resolve an item such as `routing-proof`
at `/stories/routing-proof`. Published reads should keep `/articles/routing-proof`.
The stored item slug does not change, nor does an independently placed index page.
Changing the iframe perspective does not publish settings. The item URL field
still edits its draft URL; native location links follow the selected perspective.

While live and draft prefixes differ, URL-changing publish/redirect/folder actions
remain protected until the reviewed settings change is published. A content-only
item update uses fresh checks and can publish without publishing its settings.
Do not bypass these guards in a real application; this fixture's initial published
settings were explicitly created for acceptance testing.

### Seed page fixtures

`seed.ts` creates 14 new documents: four pages, eight posts, one alternate-path
document, and one shared footer. It uses Sanity-generated IDs and the returned
footer ID for references. It does not create a blog in the consuming app.

Only run it after authorization to create test content in the selected dataset:

```sh
cd tests/fixtures/pages-studio
../../../node_modules/.bin/sanity exec seed.ts --with-user-token
```

The script refuses to run if any `kitProof*` fixture types already exist. It
never overwrites or deletes documents. If a run fails partway, inspect and reuse
the documents already created; do not blindly rerun it. The script prints the
IDs it creates. Builds and tests never call this script.

Use the browser's **Create page** button to test an incomplete draft. Enter a
title and leave the pathname empty. The native editor should remain usable,
while the previous preview stays in place and the header explains why the new
document cannot yet be previewed. Nothing is published automatically by this
button; the seed script creates published fixture records explicitly.

## Test an empty folder

Until the folder creation controls are available, `seed-empty-folder.ts` can
add `/empty-folder-test` through the internal guarded folder writer. It is
restricted to the Standard Stack test project (`ha9kep4l`, `development`) and
checks unrestricted document read access before loading the inventory. It
refuses a path that already contains a page. It changes only folder metadata.

With the project and dataset environment variables set, run from the fixture
directory:

```sh
../../../node_modules/.bin/sanity exec seed-empty-folder.ts --with-user-token
../../../node_modules/.bin/sanity exec seed-empty-folder.ts --with-user-token -- --apply
```

The first command only checks; the second saves the folder. If the write result
is uncertain, inspect the registry before retrying. Open the page picker or
navigator and expand **Empty-folder-test** to see “No pages in this folder.”
Studio startup and automated tests never run this script.

## Try the private URL field

Proof page and Proof post now use the draft URL field from source. The alternate
path type deliberately keeps its ordinary string field. Existing records keep
their storage; this schema change does not migrate or publish anything.

Create a new Proof page, enter a title, and choose **Generate** in its URL field.
Choose a folder, or use **New subfolder** to open the creation modal. Its **Nest
inside** control is a popover. Folder creation saves metadata immediately; the
selected folder then starts checked URL autosave. Typing saves after a 500 ms
pause, and generating a slug also starts a save. There is no Apply button.
Wait for the save indicator to clear before changing documents: navigating away
before the pause or checks finish discards the local edit. Leave the document
unpublished for continued testing.

Invalid values, conflicts, and failed reads remain local with native validation
feedback beside the field label.
Correct the value, or use **Retry saving URL** after a network failure. Clearing a
root-level segment must not silently save the homepage: choose **Use as homepage**
to make that intent explicit. This still runs the usual access and conflict checks.

The fixture wraps its workspace config with the private `withUrlPublication`
helper, so Publish is finalized after all plugin actions. Existing published
pages allow normal draft URL edits; clicking Publish for a changed live URL opens
the old/new URL dialog with an optional redirect checkbox. The final Publish
button publishes the whole reviewed draft and its optional new redirect in one
transaction. If older redirects point to the page, the dialog lists them and
updates their destinations directly to the new URL in that same transaction.
Turning off the checkbox skips only the new rule, not those reviewed updates.
The published listener on port 3335 serves saved rules as HTTP redirects; Studio
preview on port 3334 bypasses them. Collection settings drive the matching
Articles URLs in Pages, the URL field, and both websites. Reviewed folder renaming,
removal, and synchronization are available. Collection-prefix publishing is
enabled for acceptance. This
factory is private and is not available through the package's `/studio` export.
See [the URL-field guide](../../../docs/url-field.md) for access requirements,
storage behavior, and concurrency limits.

## How the pieces fit together

- `src/studio/pages/plugin.tsx` installs the unstable header and navigator slots.
  `header.tsx` retains `renderDefault` for native preview controls. With the
  sidebar closed, it moves the public navigator toggle ahead of the outlined
  page-title picker and omits that toggle from the default renderer to avoid a
  duplicate. With the sidebar open, it passes the original props unchanged.
  A bounded picker button sits beside the native controls rather than replacing
  them. A separate status line explains unavailable previews.
  Sanity UI's modal popover blocks pointer interaction with the background;
  `react-focus-lock` keeps Tab navigation inside the picker, including when no
  pages match the search. The adapter focuses the dialog on opening; the first
  forward Tab enters Search. Content determines its height up to the available
  viewport space, with the list scrolling when needed. It restores
  focus to Choose page on dismissal, unless the sidebar has replaced that button.
- `src/studio/pages/browser-state.tsx` lives around the native **tool**, not its navigator. Sanity
  unmounts the navigator when it closes; search and scroll therefore survive the
  move to the picker. Each mounted workspace/tool gets its own provider. There
  is no module-global document router or cross-workspace state cache.
- `src/studio/pages/use-page-data.ts` reads Studio's authenticated client and
  native perspective inside Presentation. The header, picker, and sidebar share
  a session from `data-store.ts`, instead of each opening a separate listener.
  `data-session.ts` cancels obsolete reads, retains rows during refreshes, handles
  reconnection, and releases data when the last reader leaves. It also provides
  lazy tree and collection resources for the current browser. The header uses
  separate targeted reads for the preview URL and edited document ID, without
  depending on the newest documents or currently loaded browser rows.
  See [Shared live-data loading](../../../docs/pages.md#shared-live-data-loading)
  for the lifecycle, retry behavior, and periodic query cost.
- `routes.ts` registers the fixture's page, alternate-path, and collection types.
  It deliberately retains full-path post storage. The reusable registry also
  supports opt-in `slugField` collection mappings; automated query/browser tests
  and the packed Studio consumer cover those without migrating fixture content.
  Internal helpers in `src/studio/pages/` generate native resolvers and the
  browser projection from that same metadata. The compiled helpers are private implementation files beneath the new `/studio`
  entry point, not separate public imports.
- `src/studio/pages/model.ts` applies that registry's route policy. The selected preview page is derived
  from Presentation's preview URL, not its edited document ID. This distinction
  allows a shared footer to open in the editor without selecting a different page.
- `schema.ts` owns the test schemas. Most routes use `pathname.current`; the
  alternate document uses `route`. The eventual plugin must not inject schemas
  or require either field name.
- `preview-server.mjs` and `preview-client.ts` make a small real frontend. Native
  Visual Editing supplies overlays. The frontend owns its history adapter,
  perspective-aware reads, and refresh behavior. Same-URL navigation echoes are
  ignored so a Studio/iframe round trip does not cause a refresh loop.
- `sanity.config.ts` installs generated native document locations and reverse URL lookup.
  The `pages-proof` tool name is fixture-specific, not a proposed public default.

The fixture's homepage is deliberately CMS-owned. That does not establish a
homepage policy for consumers: Standard Stack currently owns `/` in its app
router, and its first rollout will register only `page`, with no collections.
The plugin accepts route exclusions/overrides and configurable native tool names. An explicit edit intent may validly pair one document with
another preview URL; do not force the editor to match the preview at all times.

These adapters use public imports from `sanity`, `sanity/presentation`,
`sanity/router`, `@sanity/ui`, and `react-focus-lock`. No private bundles, internal contexts, or
Studio DOM selectors are used. The only DOM lookup in the header searches its
own picker for the input to focus on that initial Tab.

## Compatibility and checks

The reusable plugin candidate pins Sanity **6.17.0** as an optional peer and uses
caret ranges from Sanity UI **4.4.10**, styled-components **6.5.3**, and
react-focus-lock **2.13.7**. The development installation pins those baselines.
The fixture uses React/React DOM **19.3.1**. These versions address the earlier
CLI and Portable Text peer mismatches. They define one tested baseline, not
support for every Sanity version. The existing released package has no Studio
plugin; no release is implied by this fixture.

One development peer warning remains: `@sanity/workflow-blueprint@0.36.0`
requests TypeScript 6 or 7, while this repository uses 5.9.3. Do not describe the
whole development graph as warning-free. The packed consumer checks and Studio
build are distinct from the later full compatibility matrix.

Run checks from the repository root, with the public project variables set for
the Studio build:

```sh
pnpm verify
pnpm studio:build
pnpm test:package
```

The focused React tests use real Sanity UI primitives and focus locking, and mock
Sanity's hooks. Their JSDOM environment supplies visible anchor/viewport geometry
because it has no layout engine; real Tab navigation is checked in Studio.
They prove the adapter's lifecycle, not the native editor or iframe connection.
Keep those results separate from the live checklist in [ACCEPTANCE.md](ACCEPTANCE.md).

## Gate before the finished interface

A1 is complete only when the real Studio demonstrates selection, native
creation, reverse preview navigation, shared-content overlay editing, and
sidebar/picker transitions with all native controls preserved. Do not count a
successful build or mocked test as a substitute for an unchecked live item.

A2 now provides the reusable plugin and opt-in `/studio` boundary in local
builds. A3/A4 now include the first path hierarchy, collection search/incremental
loading, native version indicators, and the private draft URL field. Navigator
folder actions, query-side sort/status filters, long-list virtualization, schema
previews, and permission-aware template choices remain pending.
A5 adds the full compatibility/distribution checks and release
documentation. No version bump, commit, publication, or deployment is implied
by this fixture.

## Redirect editing and publishing

Open **Fixture content → Redirects** to inspect generated rules or use the list’s
`+` button to create a manual redirect. The fixture opts into
`redirectManagement: 'publish'` and installs `redirectManagementItem(S)` alongside
its existing collection settings.

The native form autosaves drafts and validates paths, required values, and
self-redirects. **Created by** stays read-only. Publish checks for conflicts and
saves the draft in one action. A notice appears only if something needs attention.
To retire a redirect, turn off **Enabled**, then publish that change. Its record
stays available for inspection. Delete is also available for active, retired,
and draft-only redirects and opens Sanity's native confirmation. Discard changes
remains available; Unpublish, Duplicate, and Schedule are omitted.

Changes to an existing rule stay in its draft until publishing succeeds. The
website must load the published rules and refresh any consumer-owned cache;
this Studio integration does not install a frontend redirect handler. The
`/redirect-editor-proof` record is dedicated to live acceptance of this flow.
The collection acceptance record below describes the newly verified prefix
publishing flows; the earlier native integration checks remain in
[ACCEPTANCE.md](ACCEPTANCE.md).

## Collection settings publishing acceptance — November 10, 2026

These checks ran against the enabled native Publish integration in the test
Studio. They are live observations, separate from automated test results:

1. A display-name-only update to **Stories** published without a routine dialog.
   Its effective prefix stayed unchanged.
2. Publishing `/articles` → `/stories` through the review dialog created
   `/articles/routing-proof` → `/stories/routing-proof`.
3. A temporary draft of that redirect blocked the next prefix change. The
   notice showed the exact affected redirect as a clickable native row. Only
   that temporary test draft was discarded, using Studio's native action.
4. Publishing `/stories` → `/stories-test` with **Create redirects** off updated
   the existing alias to `/articles/routing-proof` → `/stories-test/routing-proof`.
   No `/stories/routing-proof` alias was created. Settings and redirect documents
   shared the transaction revision.
5. The article's complete draft and published JSON were unchanged from the
   initial snapshots. The operation did not publish its draft or rewrite its
   stored slug or content.

The resulting display name is **Stories** and the published test prefix is
`/stories-test`. These are mutable fixture data, not configuration defaults.
The stable collection identifier remains `articles`.

The checks exposed two implementation issues that are now fixed: unrelated
redirect drafts pointing to unchanged pages no longer block the move, and
Sanity's root `_system` draft metadata no longer fails the changed-field schema
check. Nested values, schema validation, and read-only rules remain protected.
The redirect-conflict notice now explains the reason and identifies the rule.

A separate first-ever settings publish passed on November 11, including native
template initialization, a success toast, and its exact write receipt. The
temporary settings and receipt were removed afterward; established settings,
article versions, and redirects were unchanged. See [the acceptance record](ACCEPTANCE.md).

Custom-role permissions, wider validation and conflict cases, concurrent edits,
cancellation, and recovery after a lost response remain acceptance work. The
November 10 checks verified saved records, not HTTP delivery or cache refresh.
The new [published-only listener](HTTP-REDIRECTS.md) now supports HTTP delivery
checks separately from Studio preview.
