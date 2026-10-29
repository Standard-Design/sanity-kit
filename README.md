# `@standard-design/sanity-kit`

Reusable Sanity tools for public configuration, data validation, images, links,
React Router pages and preview, and sitemaps.

Use individual helpers or combine them into a React Router integration. The kit
does not require your application to use a particular content model, CSS system,
cache backend, or hosting provider. It is React Router-aware, not Cloudflare-aware.

Start with the [quick start](#quick-start) for the setup sequence. Use the
[documentation index](docs/README.md) for shared terminology, a reading order,
and detailed subsystem guides. The [extraction record](docs/extraction-provenance.md)
explains where the package came from and what changed during extraction.

For the unreleased Studio work, see [Pages architecture and design](docs/pages.md).
That guide covers the internal routing proof and approved UI direction, not
features available in the current npm release.

## Table of contents

- [Installation and release status](#installation-and-release-status)
  - [Migrating from the old scope](#migrating-from-the-old-scope)
- [Requirements](#requirements)
- [What the kit owns—and what it does not](#what-the-kit-ownsand-what-it-does-not)
  - [Browser and server boundaries](#browser-and-server-boundaries)
- [Quick start](#quick-start)
  - [1. Define public configuration](#1-define-public-configuration)
  - [2. Create the server kit](#2-create-the-server-kit)
  - [3. Select published or preview data per request](#3-select-published-or-preview-data-per-request)
  - [4. Connect the application](#4-connect-the-application)
- [Package entry points and subsystem guides](#package-entry-points-and-subsystem-guides)
- [Development and verification](#development-and-verification)
  - [Building and preparing a release](#building-and-preparing-a-release)
- [License](#license)

## Installation and release status

[`@standard-design/sanity-kit@0.1.0-alpha.5`](https://www.npmjs.com/package/@standard-design/sanity-kit/v/0.1.0-alpha.5)
is published on npm, with matching assets in the
[GitHub prerelease](https://github.com/Standard-Design/sanity-kit/releases/tag/v0.1.0-alpha.5).
Alpha.5 excludes deprecated client `8.6.0`, preserves client 7 support,
and bundles the improved documentation. Runtime APIs and behavior are unchanged.
See the [alpha.4 upgrade checklist](docs/prerelease.md#upgrading-from-alpha4).

Pin the exact version when integrating:

```sh
pnpm add @standard-design/sanity-kit@0.1.0-alpha.5
```

The existing [alpha.4 npm release](https://www.npmjs.com/package/@standard-design/sanity-kit/v/0.1.0-alpha.4)
and [GitHub assets](https://github.com/Standard-Design/sanity-kit/releases/tag/v0.1.0-alpha.4)
remain available. These are alpha releases, not stable-release promises. npm
assigned both `alpha` and `latest` on first publication despite `--tag alpha`,
and rejected removal of `latest`. As of October 25, 2026, `alpha` points to
alpha.5 while `latest` remains on alpha.4. Prefer an exact version over an
unqualified install. See the [release status](docs/prerelease.md#release-status) for the
verification record and tag caveat; a source version bump is not a publication.

You can also install the reviewed compiled tarball from the release assets;
see [artifact verification and handoff](docs/prerelease.md#verification-and-handoff).
Direct Git dependencies are not supported: the installable package lives in the
compiled distribution, not the repository root.

Alpha.5 includes the navigation and status corrections made after alpha.4.
These repository docs also correct alpha.5's preparation-time publication wording.
Published tarballs, their bundled documentation, and their checksums are unchanged.

### Migrating from the old scope

Replace `@standard/sanity-kit` with `@standard-design/sanity-kit` in dependencies
and imports, preserving subpaths such as `/image/react`. Update frontend and
Studio/codegen dependencies together, regenerate the consumer lockfile, and run
the application's checks. Do not keep both package identities installed as a
compatibility shortcut.

Alpha.4 changes identity, licensing, and distribution settings, not alpha.3's
exports or runtime behavior. There is no compatibility alias under the old name.
Follow the [alpha.3 migration checklist](docs/prerelease.md#upgrading-from-alpha3).
Consumers on alpha.2 also need the
[API upgrade checklist](docs/prerelease.md#upgrading-from-alpha2) for request
context naming and loader validation. Historical artifacts remain unchanged.

## Requirements

- Node.js 24+ and ESM; CommonJS is not supported.
- An `@sanity/client` peer satisfying `^7.27.0 || ^8.6.1`, including for
  framework-independent use. Client `8.6.0` is excluded starting with alpha.5.
- Only the optional peers needed by the entry points you import. React adapters
  require React/React DOM 19.2.7+ within the declared ranges; router adapters
  require React Router 8.4+ within the declared range.
- Your own Sanity project, dataset, and explicit API date when fetching content.

The [peer dependency table](docs/prerelease.md#supported-peers) lists requirements
by entry point, including image, preview, Visual Editing, and Zod dependencies.
The [package manifest](package.json) is the authority for supported ranges.
Package development uses Node 24 and pnpm 11.26.0.

## What the kit owns—and what it does not

The kit supplies configuration checks, decoder contracts, image URL and rendering
helpers, link projection/resolution, document-type routing, preview sessions,
page loaders, and sitemap serialization. You choose which pieces to use.

Your application owns:

- Studio schemas, content queries, page components, styles, and accessibility;
- document-type registration, URL policy, metadata, and sitemap inclusion rules;
- decoders describing valid published data and how incomplete drafts are handled;
- environment loading, credentials, cache storage and expiry, and deployment;
- authentication and authorization beyond the kit's Sanity preview protocol.

The kit never reads application environment variables for you. Its server adapter
uses standard `Request`/`Response` objects and React Router sessions, not platform
bindings. Runtime validation is independent of a schema library; Zod is optional.
The kit does not generate Studio schemas or your application's route table.

### Browser and server boundaries

Public configuration, images, links, and the document-type route registry can be
used in browser-reachable modules. Keep `/react-router/server`, its credentials,
and its clients in server-only application modules. Never return a kit instance,
Sanity client, or full request context as loader data.

The root export is the core configuration/validation API, not every subsystem.
Image, React, Zod, and Visual Editing implementations have separate entry points.
The Visual Editing wrapper loads its upstream implementation after browser mount
only when preview is enabled; it does not authorize preview or fetch content.

## Quick start

These steps show how the pieces connect, not a complete generated application.
Use the linked guides for route modules, schemas, error handling, and cache policy.
For images, links, or validation alone, skip the server steps and go directly to
the relevant [entry point](#package-entry-points-and-subsystem-guides).

### 1. Define public configuration

```ts
// app/sanity.ts — safe for browser and server imports.
import { defineSanityConfig } from '@standard-design/sanity-kit/core'

export const sanityConfig = defineSanityConfig({
	apiVersion: '2026-09-18',
	dataset: 'production',
	projectId: 'your-project-id',
	studioUrl: 'https://studio.example.com',
})
```

Choose an API date deliberately; a package upgrade does not change it. This helper
validates and shallow-freezes the supplied object, but does not remove extra
properties. Never add tokens or secrets to it. See [core configuration](docs/core.md).

### 2. Create the server kit

```ts
// app/sanity.server.ts — never import this from browser code.
import { createSanityKit } from '@standard-design/sanity-kit/react-router/server'
import { sanityConfig } from './sanity'

export function createAppSanity(secrets: {
	readToken: string
	sessionSecret: string
}) {
	return createSanityKit({ ...sanityConfig, ...secrets })
}
```

`createAppSanity` is an application helper, not a kit export. Call it with values
from your runtime's secret configuration. A server module can keep the resulting
instance when configuration is fixed; a host that supplies bindings per request
can construct it in a request-scoped application factory.

The read token and cookie-signing secret are separate values. The signing secret
must have at least 32 characters after trimming; generate it independently.
See [server setup and cookies](docs/server.md) for configuration and preview routes.

### 3. Select published or preview data per request

Inside a server loader or helper, use the same path for ordinary and preview reads:

```ts
const { preview, options, client } = await sanity.getContext(request)
const result = await client.fetch(query, params, {
	...options,
	signal: request.signal,
})
```

Here `sanity` is the instance returned by your factory; `request`, `query`, and
`params` come from your application. `preview` is a boolean read from the signed
session. Reading context does not enable preview or write a cookie. Pass both the
selected client and its options so the request's perspective is respected.

This low-level fetch does **not** run a decoder. The
[page loader factory](docs/loaders.md) adds query dispatch, validation, and optional
caching; its published decoder is required. Preview can use a separate tolerant
decoder, and without one only the draft's `_type` is guaranteed. Keep preview
render strings intact so their invisible editing metadata is preserved.

### 4. Connect the application

For a full React Router setup, continue in this order:

1. Connect `sanity.preview.enable` and `sanity.preview.disable` to application-owned
   [resource routes](docs/server.md#wire-enable-and-disable-resource-routes).
2. Register document types and components with `createSanityRoutes`, then match
   them to queries and decoders with `createSanityLoaders`. Export their component,
   metadata function, and loader from an application route. See
   [routing](docs/react-router.md) and [loaders](docs/loaders.md).
3. Create a shared image component with `createSanityImageComponent` and a shared
   link component with `createSanityLinks`. Import those configured components
   throughout the app; do not recreate them during rendering. See
   [React images](docs/image-react.md) and [links](docs/link.md).
4. Return only serializable preview state to the browser and use it to enable
   [Visual Editing](docs/visual-editing.md). Add a
   [published-only sitemap route](docs/sitemaps.md) using your query, decoder,
   entry mapping, and canonical site origin.

## Package entry points and subsystem guides

Every path below is relative to `@standard-design/sanity-kit`. The root and
`/core` expose the same API. Import other capabilities from their own entry points;
internal compiled paths are not public APIs.

| Entry point                    | Purpose and detailed guide                                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| root or `/core`                | [Public configuration, decoders, and validation diagnostics](docs/core.md)                                                                                   |
| `/image`                       | [Source preparation, URL builder, crops, and hotspots](docs/image.md)                                                                                        |
| `/image/react`                 | [Responsive React component, loading, and layout inputs](docs/image-react.md)                                                                                |
| `/link`                        | [Framework-independent link projections and resolution](docs/link.md)                                                                                        |
| `/react-router`                | [Document-type routing and metadata](docs/react-router.md), plus the [link component factory](docs/link.md#create-the-shared-react-router-component)         |
| `/react-router/server`         | Server-only [clients and preview sessions](docs/server.md), [page loaders](docs/loaders.md), and [sitemap loader](docs/sitemaps.md#react-router-integration) |
| `/react-router/visual-editing` | [Lazy preview overlays and exit control](docs/visual-editing.md)                                                                                             |
| `/sitemap`                     | [Framework-independent XML serialization and responses](docs/sitemaps.md)                                                                                    |
| `/validation/zod`              | [Optional Zod decoder adapter](docs/validation-zod.md)                                                                                                       |
| `/package.json`                | Package metadata and supported dependency ranges                                                                                                             |

The [documentation index](docs/README.md) explains shared terms and application
ownership. Each subsystem guide covers its options, failure behavior, and tests.

## Development and verification

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm test:coverage
pnpm test:package
```

`pnpm verify` checks formatting, builds, lints, typechecks, and runs unit tests.
Coverage and packed-consumer checks are additional CI gates. Package checks
exercise runtime imports, declarations, optional peers, browser/server boundaries,
and TypeGen query extraction. CI runs on pushes, pull requests, and manual
dispatch; it does not publish or deploy.

These checks do not replace [application acceptance testing](docs/prerelease.md#standard-stack-acceptance)
with real Studio preview, schemas, credentials, and storage.

### Building and preparing a release

`pnpm build` assembles compiled JavaScript, declarations, metadata, licenses, and
these guides in `dist`. Repository-root packing and publishing are blocked.
After review and commit, `pnpm pack:release` creates a local tarball with commit
and checksum metadata; it does not tag, push, or publish.

Follow the [publication checklist](docs/prerelease.md#public-npm-publication) for
separate release approval and registry checks. Never overwrite an existing
version's artifacts. Each logical change set and its commit message must be
reviewed before committing. The [changelog](CHANGELOG.md) records release changes.

## License

Original code is licensed under [MIT](LICENSE), copyright 2026 Standard Design
LLC. Compiled distributions include the license and
[third-party notices](THIRD_PARTY_NOTICES.md); adapted code and dependencies retain
their own terms. The notices record Standard Design's MIT interpretation of
Tinloof's conflicting license declarations, not upstream confirmation.

Historical `@standard/sanity-kit` alpha.0–alpha.3 artifacts retain their original
proprietary license and `UNLICENSED` metadata. They are not replaced or relabeled.
