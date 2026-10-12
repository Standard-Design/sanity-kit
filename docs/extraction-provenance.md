# Extraction provenance

## Origin and history

SanityKit grew out of an application-owned integration maintained by Standard
Design. It was extracted into a standalone repository with clean history rather
than importing an unrelated application's full Git history. The package changed
its build, runtime boundaries, validation strategy, and public API during that
extraction.

The repository's earlier revisions retain the internal extraction record.
This distributed guide intentionally excludes workstation paths, private project
names, and private source revisions. None is needed to install or use the kit.
Third-party attribution is preserved separately in
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md), including conflicting
image-lineage license declarations and Standard Design's decision to proceed
under an MIT interpretation while leaving upstream confirmation as a follow-up.

## What changed during extraction

The standalone package replaces:

- raw TypeScript exports with compiled ESM and declarations;
- package-internal environment reads with explicit configuration;
- unconditional Zod coupling with an optional decoder adapter;
- preview validation bypasses with structured diagnostics;
- application CSS and content-model assumptions with headless building blocks;
- broad server imports with explicit browser and server entrypoints;
- hosting-specific storage with application-supplied cache adapters.

Sitemap generation preserves an application integration pattern, while adding
portable XML serialization, strict validation, and an explicitly configured
server loader. Schema-specific queries and storage remain application-owned.

## Focused attribution review

The alpha.4 preparation reviewed source files and their introduction history,
the earlier package/image/sitemap implementations, image upstream sources and
licenses, the TypeScript build, and packed-file contents. Findings:

- Responsive images inherit Tinloof provenance through the earlier application
  implementation. Standard Design interprets the conflicting upstream license
  declarations as MIT. Upstream confirmation remains a non-blocking follow-up;
  the decision, notice, and pinned references are in the third-party notices.
- The crop-rounding helper adapts Sanity's MIT-licensed image URL builder; its
  complete notice ships in every compiled distribution.
- Other integrations call installed dependencies rather than vendoring their
  implementations. The build does not bundle those dependencies or ship test
  bundles, fonts, icons, or styles. No additional copied third-party material was
  identified in the reviewed scope. This is not a legal clearance of unknown
  historical contributions or of consumers' downstream bundles.

## Package identity

The alpha.0 through alpha.3 artifacts used `@standard/sanity-kit` and proprietary
licensing. Those tags, tarballs, and checksums are unchanged. Alpha.4 prepares
`@standard-design/sanity-kit` for public npm distribution with MIT licensing for
original code and separate third-party notices. Renaming does not alias the old
package or rewrite earlier artifacts. See the [prerelease guide](prerelease.md)
for migration steps and release gates.

Return to the [documentation index](README.md).
