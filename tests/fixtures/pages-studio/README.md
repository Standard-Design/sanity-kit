# Pages: native Studio integration proof

This is the native integration proof (A1), not the finished Pages plugin.
It answers a narrow question: can the kit add a browser and a header picker
without replacing Sanity's editor, preview, routing, or document actions?

Nothing in this directory is published. The reusable plugin now lives under `src/studio/` and local builds expose
`/studio`; the fixture itself is never packed. Consumers supply their own Studio
installation. Studio-only runtime packages are optional peers. The browser now
renders the first folder tree and collection view. Folder writes, advanced filters,
the URL field, and full release acceptance are still pending.

The plugin uses a shared internal route registry. See
[the routing foundation](ROUTING.md) for its configuration, validation,
resolver overrides, and remaining work. The A1 live integration checks are now
complete; see the dated observations in [ACCEPTANCE.md](ACCEPTANCE.md). This does
not mean the finished navigator or an npm release is available.

Collection overviews will initially require a Sanity document, including an
SEO-only document. Document-free overview entries are deferred; this does not
prevent navigating to an app-owned route in Presentation and editing its
Sanity-backed content through overlays. See
[collection overviews and app-owned routes](ROUTING.md#collection-overviews-and-app-owned-routes).

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
the token server-side and only queries the fixture types. It binds to loopback
port 3334, rejects other Host/Origin values, sends no CORS headers, and disables
HTTP caching. It is a local development server, **not a deployable preview-mode
implementation**. Do not expose it through a tunnel or public network interface.

Open `http://localhost:3000/pages-proof`. Sign in with your normal Sanity account.
Native Sanity permissions still control the editor and create intent.

## Create fixture content deliberately

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
loading, and native version indicators. Folder actions, query-side sort/status
filters, long-list virtualization, schema previews,
permission-aware template choices, and the URL field remain pending.
A5 adds the full compatibility/distribution checks and release
documentation. No version bump, commit, publication, or deployment is implied
by this fixture.
