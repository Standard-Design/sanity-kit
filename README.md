# `@standard/sanity-kit`

Reusable Sanity tools for Standard Design applications: configuration, validation,
images, links, React Router pages and preview, and sitemaps.

The kit is a clean extraction from Sawkill. It keeps useful integration patterns
without depending on Sawkill's content models, styles, environment variables, or
Cloudflare bindings. See [extraction provenance](docs/extraction-provenance.md).

## Start here

1. Read [installation and release status](#installation-and-release-status).
2. Follow [the setup order](#setup-order) for a React Router application, or use
   the framework-independent helpers on their own.
3. Open the relevant [subsystem guide](#subsystem-guides) for examples, options,
   failure behavior, and the responsibilities left to your application.

The [documentation index](docs/README.md) also explains shared terms and suggests
a reading order. Examples that use application schemas, queries, components, or
storage expect you to supply those pieces; the kit does not generate them.

## Installation and release status

This source is prepared for `0.1.0-alpha.3` integration testing. The package is
private and is **not published to npm**. Install an approved, compiled tarball, not this Git
repository as a dependency. The [prerelease guide](docs/prerelease.md) covers
installation, peer dependencies, verification, and release handoff.

These docs describe alpha.3, including stricter published-data validation,
typed draft decoding, static link fragments, and the top-level `getContext` API.
See the [upgrade checklist](docs/prerelease.md#upgrading-from-alpha2) before moving
from alpha.2. Match documentation to the exact artifact you consume; earlier
tarballs do not include these changes. A version bump in source does not itself
publish an artifact.

Node 24+ and ESM are required. React entrypoints target React/React DOM 19.2.7+;
router entrypoints also require React Router 8.4+. Only install optional peers
for the integrations you use;
see the [peer dependency table](docs/prerelease.md#supported-peers).

## What the kit owns—and what it does not

The kit provides small, explicitly configured building blocks. It never reads
your application's environment variables. You pass public configuration,
server secrets, queries, decoders, and cache adapters where needed.

It is React Router-aware, but not Cloudflare-aware. The server adapter uses
standard `Request`/`Response` objects and React Router sessions. Your application
owns hosting, bindings, storage, authentication beyond Sanity preview, and
deployment.

Your application also owns Studio schemas, GROQ queries for its content,
components, styles, accessibility choices, SEO policy, and handling incomplete
drafts. Runtime validation is independent of a schema library; Zod is an optional
adapter.

### Browser and server boundaries

Public configuration, images, links, and the route registry can be used in the
browser. Keep `@standard/sanity-kit/react-router/server` and its secrets in
server-only application modules. Never return a kit instance or Sanity client
as loader data.

Visual Editing has its own optional entrypoint. Its implementation loads after
browser mount only when preview is enabled. Unused React, Zod, image, and Visual
Editing integrations are not pulled in through the core entrypoint.

## Setup order

### 1. Define public Sanity configuration

```ts
import { defineSanityConfig } from '@standard/sanity-kit/core'

export const sanityConfig = defineSanityConfig({
	apiVersion: '2026-09-18',
	dataset: 'production',
	projectId: 'your-project-id',
	studioUrl: 'https://studio.example.com',
})
```

The API date is explicit so package upgrades do not silently change it. Keep
tokens and session secrets out of this browser-safe object. See [core](docs/core.md).

### 2. Configure server clients and preview routes

Create a server-only kit with the public settings, a Sanity read token, and an
independent cookie-signing secret. Connect its enable/disable handlers to your
application's resource routes. See [server clients and sessions](docs/server.md).

### 3. Connect page components, queries, and decoders

Register document types and their components with `createSanityRoutes`. Match
each type to a query and decoder with `createSanityLoaders`. Export the resulting
component, metadata function, and loader from your application's React Router
route module. See [routing](docs/react-router.md) and [loaders](docs/loaders.md).

Published data must satisfy its decoder. Drafts can use a separate tolerant
decoder while preserving the encoded strings needed by Visual Editing.

### 4. Share configured image and link components

Create `SanityImage` and `SanityLink` once in shared application modules, then
import them wherever they are needed. Do not call their factories during render.
See [React images](docs/image-react.md) and [links](docs/link.md).

### 5. Add preview UI and a sitemap

Expose only a serializable preview flag from your root loader and use it to
enable [Visual Editing](docs/visual-editing.md). Add a published-only sitemap
resource route using an application-owned query and canonical site origin;
see [sitemaps](docs/sitemaps.md).

## Subsystem guides

| Guide                                    | Import                                        | Covers                                                                |
| ---------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------- |
| [Core](docs/core.md)                     | root or `/core`                               | Public configuration, decoders, diagnostics, Stega-safe validation    |
| [Image tools](docs/image.md)             | `/image`                                      | URL builder, source preparation, crops and hotspots                   |
| [React images](docs/image-react.md)      | `/image/react`                                | Responsive component, pixel budgets, loading and layout               |
| [Links](docs/link.md)                    | `/link`; adapter in `/react-router`           | Stored and projected data, safe resolution, shared component, TypeGen |
| [Routing](docs/react-router.md)          | `/react-router`                               | Document-type registry, components, metadata, route lookup contract   |
| [Server](docs/server.md)                 | `/react-router/server`                        | Clients, secrets, cookies, preview enable/disable                     |
| [Loaders](docs/loaders.md)               | `/react-router/server`                        | Fetching, published/draft validation, cache adapters, diagnostics     |
| [Visual Editing](docs/visual-editing.md) | `/react-router/visual-editing`                | Lazy overlays, root-loader state, preview exit                        |
| [Zod](docs/validation-zod.md)            | `/validation/zod`                             | Schema adapter, output types, transforms and draft schemas            |
| [Sitemaps](docs/sitemaps.md)             | `/sitemap`; adapter in `/react-router/server` | XML, canonical URLs, dates, responses and caching                     |

Imports in the table are relative to `@standard/sanity-kit`. Only documented
entrypoints are public; importing internal compiled files is unsupported.

## Development and verification

CI uses Node 24 and pnpm 11.26.0.

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm test:coverage
pnpm test:package
```

`pnpm verify` checks formatting, builds, lints, typechecks, and runs unit tests.
Coverage and packed-consumer checks are additional CI gates. The package checks
exercise runtime imports, declarations, optional peers, browser/server
boundaries, and TypeGen query extraction. CI runs on pushes, pull requests, and
manual dispatch; it does not publish or deploy.

### Building and preparing a release

`pnpm build` assembles a compiled-only package, including these guides, in `dist`.
Packing the repository root is blocked. After review and commit,
`pnpm pack:release` creates a local tarball with commit and checksum metadata;
it does not tag, push, or publish. See [verification and handoff](docs/prerelease.md#verification-and-handoff).

Each logical change set and its commit message must be reviewed before a commit
is created. The [changelog](CHANGELOG.md) records release changes.
