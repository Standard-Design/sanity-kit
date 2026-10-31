# Changelog

## Unreleased — Pages plugin foundation

- Add private, read-only URL conflict checks across registered full-path and
  slug-only types. Use raw document versions and Sanity's native self-exclusion,
  with a typed `options.isUnique` adapter for the future field. Bound conflict
  responses, distinguish failures from duplicates, and preserve cancellation.
  No field wiring, public exports, dataset writes, or uniqueness reservation yet.

- Add private URL-authoring preparation for the future Studio field: return
  storage-aware candidates, clean literal internal/trailing separators, and
  preserve collection boundaries without writing data. Match Sanity's default
  `speakingurl` generation and truncation; support async custom generators that
  bypass `maxLength`, followed by separate URL-safety validation. Do not add
  collision suffixes. Keep these helpers outside public exports;
  the input UI and persistence remain subsequent work. The separate internal
  conflict checker above adds read-time checks only.

- Add the framework-independent `/url` entry with `createSanityUrlResolver()`.
  Reuse Pages registration to derive `{pathname, prefix, slug}` from full paths
  or fixed-prefix collection slugs, with explicit failure results and no fetching
  or mutations. Keep legacy Studio navigation unchanged; the new resolver rejects
  noncanonical separators instead of silently repairing them. Document the API and
  add browser-boundary and package-consumer coverage. Settings-backed prefixes and
  URL editing remain future work.

- Add the opt-in `/studio` entry with `pagesTool()` for an app-owned Sanity
  Studio. Reuse native Presentation, the editor, and document actions; do not
  supply a standalone Studio application or generate schemas/frontend routes.
- Share page/collection routing configuration across the browser and
  native resolvers. Preserve picker focus, search/scroll state, and independent
  preview/document selection when moving the integration out of its fixture.
- Add optional Studio peers and packed-consumer checks that keep Studio out of
  ordinary frontend installs and bundles. Test Sanity 6.17.0 and React 19.3.1;
  document the remaining development-only TypeScript peer warning.
- Add private navigator data helpers: inferred folders, named index children,
  separate collection overviews, complete ordinary-page batch reads, five-item
  collection previews, and cursor-based collection search, with offline tests.
- Share requests and listeners between the sidebar and picker. Add
  perspective-isolated sessions, cancellation, reconnect/retry handling, periodic
  reconciliation, and lazy tree/collection resources. Preserve last-good rows
  during refresh and reread loaded collection depth after changes.
- Keep the custom URL field, folder actions, and broader release
  acceptance as later work. No version bump or publication is included here.
- Connect the first navigator UI: inferred folders, actual-title index children,
  native version indicators, five recent collection items, and debounced
  collection search with incremental loading. Preserve browser mode, expansion,
  search, and scroll across sidebar/picker mounts. Add the explicit Studio icons
  peer. Folder writes, sort/status filters, and virtualization remain later work.
- Match native Structure row/header styling and Studio tooltips. Add a compact,
  content-height picker with dialog-first keyboard focus and a page-title trigger.
  Support explicit plural collection labels with `itemsTitle`, distinguish recent
  items from the total in the browse row, and separate missing preview URLs from
  valid ungrouped paths. Document the planned URL-field cleanup separately from
  the read-only navigator; no dataset cleanup is included.
- Replace the header's latest-50 lookup with separate targeted reads for the
  previewed page and edited document. Share the generated resolver's path policy,
  detect ambiguous URLs, and clear obsolete identity results on navigation.
  Older pages and pathless documents no longer depend on a recent-document window.
- Add opt-in `slugField` registration for collection items. Derive full URLs from
  the collection prefix and one stored segment across browsing, search, header
  identity, and native Presentation resolvers. Preserve existing `pathnameField`
  behavior and detect collisions across both storage modes. The custom URL input,
  authoring validation, and content migration are not included in this slice.
- Record the approved URL-field, folder-storage, and bulk-change contracts and
  the proposed redirect subsystem, including consumer-owned caching. Keep pending
  API details and redirect defaults explicitly marked as proposals. Include both
  design guides in the package and verify packed guides match their source text;
  this documentation does not implement those features or change runtime behavior.

## 0.1.0-alpha.5

- Raise the supported `@sanity/client` 8.x minimum to `8.6.1`, excluding `8.6.0`,
  which upstream deprecated for an abort-listener memory leak. Client 7 support
  remains `^7.27.0`; the development lockfile still resolves client `8.6.2`.
- Verify that strict consumer installation rejects client `8.6.0`, and run the
  full packed-consumer checks against the new `8.6.1` minimum.
- Include the reorganized README, table of contents, quick start, entry-point
  map, and corrected release-status documentation in the compiled package.

Alpha.5 is published on npm and GitHub. Runtime APIs and behavior are unchanged from
alpha.4; only the client 8 peer minimum changes. Follow the
[alpha.4 upgrade checklist](docs/prerelease.md#upgrading-from-alpha4).
Previously released artifacts and checksums remain unchanged.

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
