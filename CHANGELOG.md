# Changelog

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
