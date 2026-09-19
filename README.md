# `@standard/sanity-kit`

Reusable, runtime-explicit Sanity primitives for Standard Design applications.

This repository is a clean extraction of the useful Sanity integration patterns
from Sawkill. It intentionally does not import Sawkill's application models,
styles, environment globals, or Cloudflare bindings.

## Status

The package is under active extraction and is not currently published to npm.
It is private to prevent accidental publication while its APIs are hardened.
Reviewed consumers will use a packed tarball or an exact Git revision.

The first implemented public contract is browser-safe configuration:

```ts
import { defineSanityConfig } from '@standard/sanity-kit/core'

export const sanityConfig = defineSanityConfig({
	apiVersion: '2026-09-18',
	dataset: 'production',
	projectId: 'your-project-id',
	studioUrl: 'https://studio.example.com',
})
```

The API version is required rather than defaulted so a package release cannot
silently pin every consumer to a stale Sanity API date.

Runtime validation is decoder-based rather than tied to a schema library. The
core validator cleans a non-mutating Stega shadow while preserving the original
data for Visual Editing:

```ts
import { validateSanityData } from '@standard/sanity-kit/core'
import { createZodDecoder } from '@standard/sanity-kit/validation/zod'

const validation = await validateSanityData(
	previewData,
	createZodDecoder(pageSchema),
)

// Keep this value for preview rendering and overlays.
validation.data

// Parsed or transformed clean data is separate.
if (validation.result.success) validation.result.value
```

Applications decide whether invalid data is tolerated. Preview loaders can
return `validation.result.diagnostics`; published loaders can call
`requireValidSanityData(validation)` to enforce a strict boundary.

## Intended boundaries

- `@standard/sanity-kit/core`: browser-safe configuration and shared contracts
- `@standard/sanity-kit/image`: explicit image URL helpers
- `@standard/sanity-kit/react-router`: client-safe React Router integration
- `@standard/sanity-kit/react-router/server`: server-only clients, preview
  sessions, handlers, and loaders
- `@standard/sanity-kit/validation/zod`: optional Zod adapter

Only implemented entrypoints are exported. Each boundary will be added with
runtime, type, and bundle-boundary tests.

## Development

Node.js 24 and pnpm 11 are required.

```sh
pnpm install
pnpm verify
```

No commits are created until each logical change set and its proposed commit
message have been reviewed.
