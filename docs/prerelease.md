# Prerelease integration

Version `0.1.0-alpha.0` is intended for reviewed integration testing. The package
remains private and unlicensed; there is no npm publication in this workflow.

## Distribution

`pnpm build` replaces generated output and assembles `dist` as a complete package
root. Its exports reference compiled JavaScript and declarations directly.
The artifact includes README, LICENSE, CHANGELOG, this guide, and sitemap docs.
Source files, source maps, tests, development dependencies, and lifecycle scripts
are excluded. Source-level debugging uses the matching repository commit.

The repository root blocks ordinary pack/publish commands. Do not disable that
guard to distribute the root. Both manifests retain `private: true`.

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
checks artifact contents, runtime imports, TypeScript declarations, hidden deep
imports, ordinary browser bundles, and a separate lazy Visual Editing chunk.
It exercises minimal core peers, current development peers, and declared minimum
peer versions, plus Standard Stack's client 7/React 19.3 combination. Ordinary
fixtures use npm; the Standard Stack fixture uses pnpm to test the intended
consumer installation route. All install scripts are disabled. Ordinary
declarations are checked with `skipLibCheck: false`. Visual Editing usage is
checked separately with `skipLibCheck: true`: its upstream `@sanity/types` and
`xstate` declarations currently fail strict library checking. This exception
does not disable strict checking of application code. It may download dependencies.
Temporary consumers are retained
under the system temporary directory and their location is printed for inspection.

The `esm-only` profile matches the supported ESM exports; CommonJS and legacy
Node 10 resolution are not supported. No other ATTW rules are suppressed.
Unlike CFKit, this private, non-npm distribution does not run `npm publish
--dry-run`. Actual packing, artifact inspection, both package linters, and
no-script consumer installs validate the distribution without testing publication
or removing the `private: true` safeguards.

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
pnpm add ./vendor/standard-sanity-kit-0.1.0-alpha.0.tgz
```

Keep that exact file accessible to CI and other developers and commit the
consumer lockfile. No dependency build approval is needed for the compiled
tarball because it contains no lifecycle scripts. Private GitHub release URLs
are not anonymous package URLs: download assets using authenticated GitHub
access first. Never put credentials into dependency URLs or lockfiles.

Direct Git dependencies are not supported by this compiled-only handoff. The
repository's source manifest references build output, while the installable
manifest lives in the assembled distribution. Use the verified tarball.

## Peer dependencies

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

The manifest is the authority for supported ranges. Client 7 and 8 are supported;
preview URL secret 3 and 4 are supported. The optional Visual Editing adapter
requires `@sanity/visual-editing ^6.1.2`; Standard Stack's older 4.x package must
be upgraded. Its `styled-components` peer must also be satisfied by the consuming
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
