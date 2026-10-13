# Prerelease integration

Version `0.1.0-alpha.5` of `@standard-design/sanity-kit` is prepared, not yet
published. It excludes deprecated client `8.6.0` and includes the improved
README and guides. Original code uses the [MIT license](../LICENSE);
[third-party notices](../THIRD_PARTY_NOTICES.md) describe adapted code and
Standard Design's MIT interpretation of conflicting Tinloof license declarations.
Upstream confirmation remains a follow-up, not a release prerequisite.

The API is unchanged from alpha.3, which introduced breaking changes to request
context naming and loader validation/types, as well as static link fragments and
expanded documentation. Follow the [upgrade checklist](#upgrading-from-alpha2)
when replacing alpha.2. Use the approved artifact for the intended revision;
a source version bump does not itself tag, push, or publish a release.

## Release status

Alpha.5 requires a reviewed release commit, passing CI, a clean-commit artifact,
and separate publication approval. Its intended tarball is
`standard-design-sanity-kit-0.1.0-alpha.5.tgz`. Do not infer availability from the
source version or a successful publication dry-run.

Alpha.4 is available on [npm](https://www.npmjs.com/package/@standard-design/sanity-kit/v/0.1.0-alpha.4)
and as a [GitHub prerelease](https://github.com/Standard-Design/sanity-kit/releases/tag/v0.1.0-alpha.4),
built from commit `7332725e0d61313b1ccfc245f2cb45e1e2ef7726`. The npm download
matched the reviewed tarball byte-for-byte; a clean registry installation passed
runtime and strict minimal-consumer TypeScript checks. GitHub assets include the
tarball, `manifest.json`, and `SHA256SUMS`.

Publication explicitly used `--tag alpha`, but npm also assigned `latest` on
first publication. An authenticated removal attempt returned HTTP 400. As of
October 12, 2026, both tags point to alpha.4; `latest` is not a stability guarantee.
Pin the exact approved version for reproducible integration. Check all registry
tags again when alpha.5 is published; do not assume `latest` will move with `alpha`.

Alpha.5 will include the navigation and status corrections made after alpha.4.
The alpha.4 tarball, its bundled documentation, and its checksums are unchanged.

## Upgrading from alpha.4

1. Check the application's installed `@sanity/client` version. Alpha.5 requires
   `^7.27.0 || ^8.6.1`. Client 7 users in range need no client upgrade; client
   `8.6.0` users must choose `8.6.1` or a later supported 8.x release. Upstream
   deprecated `8.6.0` for an abort-listener memory leak.
2. Once alpha.5 is published, update frontend and Studio/codegen package pins to
   `@standard-design/sanity-kit@0.1.0-alpha.5` together, then regenerate the
   consumer lockfile. No import, decoder, stored-data, or cache migration is needed.
3. Run application typechecks, TypeGen, and build/runtime checks. The package's
   own lockfile still resolves client `8.6.2`; applications own their client pins.

Exported APIs, subpaths, runtime behavior, and all other peer ranges are unchanged.
The README reorganization and release-status corrections now ship in the package.

## Upgrading from alpha.3

Alpha.4 changes the package identity from `@standard/sanity-kit` to
`@standard-design/sanity-kit`; the exported APIs, subpaths, and runtime behavior
are unchanged. There is no compatibility alias or replacement artifact under
the old name. When moving directly to alpha.5, also apply the
[client compatibility checklist](#upgrading-from-alpha4).

1. Remove the old dependency key and install the reviewed new package/version.
   Update frontend and Studio/codegen dependencies together; do not keep both
   package identities installed as a migration shortcut.
2. Change imports and any package-specific tooling references from
   `@standard/sanity-kit` to `@standard-design/sanity-kit`, preserving subpaths.
   For example, `/image/react` and `/react-router/server` remain the same.
3. Regenerate the consumer lockfile and run its typechecks, build, and TypeGen.
   No stored-data migration, cache reset, or decoder change is needed from alpha.3.
4. When redistributing the kit, retain `LICENSE` and `THIRD_PARTY_NOTICES.md`.

### Licensing change after alpha.3

Original code and package metadata use MIT, copyright 2026 Standard Design LLC.
The build copies the complete license and third-party notices into the compiled
package; checks verify both inside the actual tarball. Third-party terms are
not replaced by the kit's license.

The old alpha.3 tarball still contains the proprietary license and `UNLICENSED`
metadata. Do not overwrite or relabel it. The first MIT artifact was
`standard-design-sanity-kit-0.1.0-alpha.4.tgz`, with a new manifest and checksums.
Update working pins deliberately using the migration checklist above.

## Distribution

`pnpm build` replaces generated output and assembles `dist` as a complete package
root. Its exports reference compiled JavaScript and declarations directly.
The current build includes README, LICENSE, THIRD_PARTY_NOTICES, CHANGELOG, the
[documentation index](README.md), all subsystem guides, this prerelease guide,
and extraction provenance. These expanded guides have shipped since alpha.3;
previously released tarballs are unchanged.
Source files, source maps, tests, development dependencies, and lifecycle scripts
are excluded. Source-level debugging uses the matching repository commit.

The repository root retains `private: true` and blocks pack/publish commands.
Do not disable those guards. The generated `dist/package.json` deliberately sets
`private: false` and `publishConfig` to public access, the `alpha` tag, and
`https://registry.npmjs.org/`. No dependency code is bundled into the tarball.

## Verification and handoff

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm test:coverage
pnpm test:package
```

GitHub Actions runs all four commands above on every push, pull request, and
manual dispatch, using Node 24 and pnpm 11.26.0. It logs the actual Node, npm,
and pnpm versions. `pnpm verify` is the baseline formatting, build, lint, type,
and unit-test suite; coverage and package checks are additional full-CI gates.
The workflow has read-only repository permissions and does not publish or deploy.

The package check builds and packs `dist`, checks the tarball with
`publint --strict` and Are the Types Wrong (`attw --profile esm-only`), then
installs that same tarball in temporary
consumer projects with install scripts disabled and strict peer resolution. It
checks the complete license and third-party notices, package identity, artifact
contents, runtime imports, TypeScript declarations, hidden deep
imports, ordinary browser bundles, and a separate lazy Visual Editing chunk.
It exercises minimal core peers, current development peers, and declared minimum
peer versions, the client 8 minimum (`8.6.1`), and Standard Stack's client 7/React
19.3 combination. A separate negative install check ensures that a strict
consumer rejects deprecated client `8.6.0`. Ordinary
fixtures use npm; the Standard Stack fixture uses pnpm to test the intended
consumer installation route. All install scripts are disabled. Ordinary
declarations are checked with `skipLibCheck: false`. Visual Editing usage is
checked separately with `skipLibCheck: true`: its upstream `@sanity/types` and
`xstate` declarations currently fail strict library checking. This exception
does not disable strict checking of application code. It may download dependencies.
Temporary consumers are retained
under the system temporary directory and their location is printed for inspection.

The current package check also installs a temporary pnpm Studio/frontend
workspace and verifies that Sanity codegen 8.1.0 can extract queries containing
the static link fragments. See [TypeGen integration](link.md#monorepo-code-generation)
for the direct-dependency requirement and limits of that check.

The `esm-only` profile matches the supported ESM exports; CommonJS and legacy
Node 10 resolution are not supported. No other ATTW rules are suppressed.
The check also runs `npm publish <tarball> --dry-run --ignore-scripts` with
explicit public access and the `alpha` tag. It checks the exact compiled tarball,
not the repository root, and verifies its reported integrity. Dry-run success
does not confirm registry write permission, name availability, license clearance,
or publication. Root packing and root publishing dry-runs must still fail.

After reviewing and committing the slice on the intended release branch, run:

```sh
pnpm pack:release
```

This requires a clean working tree. It creates a local tarball, `manifest.json`,
and `SHA256SUMS` under `.artifacts/<version>-<commit>/`. The manifest records the
full commit, branch, npm integrity value, SHA-256, and exact packed file list.
No tag, GitHub release, push, or npm publication is performed. Verify the intended
branch before handing off the artifact. Once an artifact is shared, use a new
prerelease version for any subsequent code change.

Transfer the reviewed tarball through an authenticated channel, verify its
SHA-256 against the handoff manifest, and install the local file:

```sh
pnpm add ./vendor/standard-design-sanity-kit-0.1.0-alpha.5.tgz
```

Keep that exact file accessible to CI and other developers and commit the
consumer lockfile. No dependency build approval is needed for the compiled
tarball because it contains no lifecycle scripts. Private GitHub release URLs
are not anonymous package URLs: download assets using authenticated GitHub
access first. Never put credentials into dependency URLs or lockfiles.

Direct Git dependencies are not supported by this compiled-only handoff. The
repository's source manifest references build output, while the installable
manifest lives in the assembled distribution. Use the verified tarball.

## Public npm publication

Public publication is a separate, explicitly approved step. Standard Design has
chosen to proceed under the MIT interpretation recorded in
[third-party notices](../THIRD_PARTY_NOTICES.md); confirmation from Tinloof is
not a release prerequisite. This maintainer decision does not establish upstream
confirmation. Package tests check technical packaging, not redistribution rights.

For each future publication:

1. Review the recorded license interpretation and included notices as part of
   the final change set. Retain the Tinloof confirmation task as a follow-up.
2. Confirm the publisher's npm account can publish under `standard-design`,
   satisfy its authentication/2FA requirements, and check that the exact package
   version is not already published. Organization creation alone is not proof
   of this environment's permissions. These account checks remain a release gate.
3. Commit the reviewed slice, pass CI, and run `pnpm pack:release` from clean
   history. Inspect the generated manifest, file list, and SHA-256; the tarball
   must contain only compiled output, docs, and the required notices.
4. After explicit publication approval, publish that exact reviewed tarball
   generated from `dist` with `--access public --tag alpha` and the npm registry.
   Never publish the repository root, suppress its guards, or repack changed code
   under an existing version. Continue explicitly selecting `alpha`; do not
   assume that prevents the registry from also assigning `latest` (see
   [release status](#release-status)).
5. Verify the registry's name, version, integrity, public access, and `alpha` tag;
   inspect all dist-tags and report unexpected assignments. Install the registry
   package in a clean consumer before handing it off.

After alpha.5 is published, consumers can install its exact version:

```sh
pnpm add @standard-design/sanity-kit@0.1.0-alpha.5
```

The checked-in CI workflow does not publish, manage npm credentials, or configure
trusted publishing. See npm's [publication documentation](https://docs.npmjs.com/cli/v11/commands/npm-publish/)
and [organization-scoped package instructions](https://docs.npmjs.com/creating-and-publishing-an-organization-scoped-package/).

## Upgrading from alpha.2

1. Install the approved alpha.5 artifact when available and update the consumer
   lockfile, following the [client compatibility checklist](#upgrading-from-alpha4).
   In a Studio/frontend monorepo using the link fragments with TypeGen, install the
   same artifact as a direct Studio/codegen dev dependency as well as the
   frontend runtime dependency. Do not rely on package hoisting.
2. Replace `sanity.preview.getContext(request)` with `sanity.getContext(request)`.
   Rename imported `SanityPreviewContext` types to `SanityRequestContext` and
   update hand-written kit mocks. There are no old-name aliases. Returned fields,
   cookie behavior, and preview enable/disable handlers are unchanged.
3. Remove `validation.published: 'passthrough'`. Every page loader still requires
   an app-supplied decoder, and published validation failures now always throw.
   Fix invalid published data rather than treating it as validated output.
4. Add `previewDecoder` where useful, and handle published/draft output in page
   components and mutations. Without a preview decoder, draft types guarantee
   only `_type`. Keep original encoded render strings for Visual Editing.
5. Review cache adapters: store raw query results, let load failures propagate,
   and namespace both lookup and page keys. Clear or version any caches that
   previously stored transformed data. Decoders can run twice on a cache miss,
   so keep them free of side effects. Preview still bypasses the page-data cache.
6. Read detailed validation issues through server-side `onFailure`, not public
   error responses. Route information may be absent when the first lookup fails.
   Update error UI/logging and keep preview diagnostics request-scoped and private.

The [server migration notes](server.md#migration-from-alpha2),
[loader guide](loaders.md#alpha-compatibility-changes), and
[TypeGen setup](link.md#monorepo-code-generation) explain these changes in detail.
No stored-link migration or dependency-range changes are required by alpha.3.
Generate types with the application's own schema and queries, then run the
[application acceptance checks](#standard-stack-acceptance) before deployment.

## Peer dependencies

### Image compatibility in alpha.2

Image preparation and crop-aware responsive sizing are new in `0.1.0-alpha.2`.
`prepareSanityImage` returns original dimensions and a normalized
standard Sanity image source. Remove consumer-side cropped-dimension workarounds
when upgrading: the React component now applies editorial crop accounting itself
and rejects dimensions that do not match the asset ID. Sources must resolve via
the official asset parser; synthetic shortened IDs used in tests should be
replaced with valid Sanity-style IDs (including their full asset hashes).

Missing/invalid image data can be handled without throwing by inspecting the
preparation result. Application content fields and omit/placeholder decisions
stay with the consumer. Existing component props remain; no peer ranges change.
`@sanity/asset-utils` is an automatically installed runtime dependency, imported
only by the image entrypoints, not by the core browser bundle. Direct URL builder
helpers remain uncapped for advanced transformations.

### Supported peers

Node 24+ is required. This prerelease targets ESM, React 19.2.7+ and React Router
8.4+. React Router's own minimum is why the React peer floor is 19.2.7.

| Import                             | Required peers in addition to `@sanity/client`                         |
| ---------------------------------- | ---------------------------------------------------------------------- |
| root, `/core`, `/link`, `/sitemap` | None                                                                   |
| `/image`                           | `@sanity/image-url`                                                    |
| `/image/react`                     | `@sanity/image-url`, React, React DOM                                  |
| `/react-router`                    | React, React DOM, React Router, `groq`                                 |
| `/react-router/server`             | React, React DOM, React Router, `groq`, `@sanity/preview-url-secret`   |
| `/react-router/visual-editing`     | React, React DOM, React Router, `@sanity/visual-editing` and its peers |
| `/validation/zod`                  | Zod                                                                    |

The manifest is the authority for supported ranges. Alpha.5
requires `@sanity/client ^7.27.0 || ^8.6.1`, excluding `8.6.0`, which upstream
deprecated for an abort-listener memory leak. Published alpha.4 still declares
`^7.27.0 || ^8.6.0`; changing this repository does not alter that release.
Applications can already select a supported patched client without a kit API change.

Client 7 and 8 are supported;
preview URL secret 3 and 4 are supported. The optional Visual Editing adapter
requires `@sanity/visual-editing ^6.1.2`; consumers still using 4.x must upgrade.
Its `styled-components` peer must also be satisfied by the consuming
application/package manager. Unused optional integrations need not be installed.

Keep server imports and secrets in application server modules. The portable
entrypoints have no application environment or Cloudflare dependency. Browser
bundle tests protect their import boundaries; consumers must still keep the
server entrypoint out of client-reachable application modules.

## Standard Stack acceptance

Before deploying an integration, test real Studio preview authorization and exit,
published/preview cache isolation, route/link matching, responsive images, and
sitemap URLs against that application's schemas and origin. Verify that only
serializable preview state reaches the browser and that the overlay loads only
in preview. These application checks need configured Sanity credentials and are
separate from the package's isolated checks.

The package intentionally leaves application schemas, query ownership, styles,
runtime cache implementations, and deployment configuration to the consumer.

Return to the [documentation index](README.md) or [package overview](../README.md).
