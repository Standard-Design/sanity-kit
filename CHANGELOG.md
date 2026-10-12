# Changelog

## 0.1.0-alpha.4

- **Breaking (package identity):** rename `@standard/sanity-kit` to
  `@standard-design/sanity-kit`. Update dependency keys and imports; public
  subpaths, exported APIs, runtime behavior, and dependency ranges are unchanged.
- License original code under MIT, copyright 2026 Standard Design LLC. Include
  the full license and focused third-party notices in the compiled package.
- Prepare public npm distribution from compiled output with explicit public
  access and the `alpha` tag. Keep repository-root packing/publishing blocked.
  Add publication dry-run and packed-notice checks; CI never publishes.
- Remove workstation paths and private project details from distributed guides.
- Record Standard Design's decision to interpret the credited Tinloof image
  lineage as MIT despite conflicting upstream package metadata, and include a
  notice under that interpretation. Upstream confirmation remains a follow-up,
  not a public-release prerequisite.

Alpha.4 is published on npm and GitHub. npm assigned both `alpha` and `latest`
on first publication despite the explicit alpha tag; see the
[release status](docs/prerelease.md#release-status). Earlier tags, artifacts,
checksums, and their original license terms remain unchanged. Follow the
[scope migration](docs/prerelease.md#upgrading-from-alpha3) when adopting the
new reviewed artifact; no cache reset or runtime API migration is required.

## Historical releases under `@standard/sanity-kit`

The entries below describe the original private, non-npm distribution. Their
package name, license terms, and release assets are not retroactively changed.

## 0.1.0-alpha.3

- **Breaking (alpha):** move `kit.preview.getContext(request)` to
  `kit.getContext(request)` and rename `SanityPreviewContext` to
  `SanityRequestContext`. No compatibility aliases are retained. Published and
  preview selection, result fields, and session behavior are unchanged;
  `kit.preview.enable` and `kit.preview.disable` remain in place.
- Validate route lookups and route documents before cache writes; revalidate
  cache reads and store raw results so decoder transforms do not accumulate.
- Add per-loader `previewDecoder` for typed tolerant drafts, preserving original
  Stega render strings. Strict diagnostics remain available through `onFailure`.
- Include lookup failures, validation stage, and fetch/cache source in the
  server-only failure hook. Public loader errors now contain only a stable code
  and generic message, never diagnostic details or request paths.
- Add static canonical link fragments for TypeGen; custom fragment factories
  and the stored link contract remain unchanged. The `/link` export now has a
  default ESM resolution target for TypeGen's static module resolver.
- **Breaking (alpha):** remove published `passthrough`; published data must
  validate. Loader results and mutation inputs now include the preview decoder
  output, or only `SanityRoutable` guarantees for undecoded drafts. Failure-hook
  `routeData` and `type` are optional because lookup can fail before resolution.
  Bump application cache namespaces when upgrading from transformed caches.
- Reorganize the README and add a documentation index and subsystem guides,
  included in the compiled tarball. Expand source comments with plain-language
  explanations and references to those guides.
- Add installed-package TypeGen extraction coverage for a separate Studio/web
  workspace, plus tests for request-context selection, typed drafts, cache
  validation, and safe public errors.

Consumers must install the new compiled tarball and follow the
[alpha.3 upgrade checklist](docs/prerelease.md#upgrading-from-alpha2).
Runtime dependencies and peer ranges are unchanged. Existing tags and artifacts
remain unchanged; no npm publication is performed.

## 0.1.0-alpha.2

- Add draft-safe `prepareSanityImage` with official asset identity/dimension
  parsing, crop/hotspot normalization, and explicit unusable-source reasons.
- Make responsive image dimensions and width caps account for editorial crops,
  pixel rounding, and requested output ratios without upscaling retained pixels.
- Require original intrinsic dimensions matching the asset ID; consumers must
  remove any cropped-dimension workaround. Full valid asset IDs are required by
  preparation and the React component. Existing low-level URL builders remain
  available for custom transforms.
- Include `@sanity/asset-utils` as an automatically installed runtime dependency;
  existing peer dependency ranges are unchanged.

Consumers must install the new compiled tarball and remove cropped-dimension
workarounds to receive these changes. Earlier tags and artifacts remain unchanged.

## 0.1.0-alpha.1

- Validate required configuration strings before trimming or coercion. Missing,
  null, non-string, and blank values now produce field-named errors without
  exposing supplied values, including server secrets and public/image config.
- Enforce the required server `studioUrl` at runtime while keeping it optional
  in public configuration. Non-empty session secrets still require at least
  32 characters after trimming; valid configuration values are not modified.
- Add configuration regression coverage and GitHub Actions verification,
  coverage, and packed-consumer checks, including publint and Are the Types Wrong.
- Update repository metadata to `Standard-Design/sanity-kit`.

Consumers must install the new compiled tarball to receive these fixes. The
`0.1.0-alpha.0` tag and artifact remain unchanged. No npm publication is performed.

## 0.1.0-alpha.0

Initial extracted package for reviewed integration testing:

- Explicit Sanity configuration and optional data-decoder contracts.
- Responsive image utilities and a configurable React component.
- Signed preview sessions, route registries, validated loaders, and safe links.
- Lazy Visual Editing integration with an unstyled preview-exit control.
- Published sitemap loaders, XML sitemap/index generation, and cache adapters.
- Compiled-only distribution and isolated packed-consumer verification.

The package is private and is not published to npm. Prerelease APIs may change.
