# Extraction provenance

## Source

- Project: Sawkill Lumber
- Repository path: `/Users/austinmaurer/Dev/Sawkill/sawkill-lumber`
- Source revision: `e16501c35bb4d10ee1d9c5397563935874148d2a`
- Original package path: `packages/sanity-kit`
- Extraction model: clean repository history with explicit provenance

The source revision was clean for the package and its related design documents
when this extraction began. Sawkill remains read-only.

## Why the history is clean

Sawkill's Git history describes a complete application, not an independently
versioned package. The extracted package also changes the distribution model,
runtime boundaries, validation strategy, and public API. Importing the
application-wide history would add unrelated commits and imply a continuity
that the hardened package does not have.

Relevant source commits remain discoverable in Sawkill's history:

- `bde815c`: initial workspace-package extraction
- `b707aa2`: subpath exports and factory API refactor
- `a05c5b9`: React Router route-export binding fix
- `74093f0`: explicit TSX extension fix in the route barrel
- `b5b06af`: route-data fragment support for link schemas

## Reuse policy

The extraction preserves useful behavior and lessons, but it does not copy the
source package wholesale. In particular, the standalone package must replace:

- raw TypeScript package exports with compiled ESM and declarations;
- package-internal `import.meta.env` reads with explicit configuration;
- unconditional Zod coupling with an optional parser contract;
- preview validation bypasses with structured diagnostics;
- Sawkill CSS class and token assumptions with headless or minimal UI;
- broad server barrels with physically separate, explicit entrypoints;
- Cloudflare-specific imports with runtime-neutral interfaces.

## Reference integration

Sitemap generation is adapted from the application route
`app/routes/sitemap.xml.tsx` in Sawkill Lumber. Its schema-specific query and
Cloudflare cache remain application-owned; the extraction adds portable XML
serialization, strict validation, and an explicitly configured server loader.

Standard Stack is coordinated separately and remains read-only. It will consume
only a reviewed packed artifact or exact Git revision after the package passes
its integration gates; it will not import this workspace's source directly.
