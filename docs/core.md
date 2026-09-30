# Core: configuration and validation

Import from `@standard/sanity-kit/core` or the package root; both expose the same
core API. This entrypoint is browser-safe and does not import React Router, Zod,
image tooling, or Visual Editing. `@sanity/client` is its required peer.

## Public configuration

```ts
import { defineSanityConfig } from '@standard/sanity-kit/core'

export const sanityConfig = defineSanityConfig({
	projectId: 'your-project-id',
	dataset: 'production',
	apiVersion: '2026-09-18',
	studioUrl: 'https://studio.example.com',
})
```

`projectId` and `dataset` must be nonempty strings. `apiVersion` must be an
explicit, real calendar date in `YYYY-MM-DD` form. Optional `studioUrl` must be
an absolute URL. The helper validates local configuration; it does not contact
Sanity, check that the dataset exists, or choose an API version for you.

It returns a shallow-frozen copy and preserves extra fields and inferred literal
types. It is **not a secret filter**: passing a token as an extra property keeps
that token in the result. Supply only public fields if this object reaches the
browser. Nested extra objects are not deeply frozen.

The [server factory](server.md) adds required preview settings and credentials.
[Image tools](image.md) need project/dataset, not an API date or server token.

## The decoder contract

A decoder checks an unknown input and describes the value it can safely return.
It can be synchronous or asynchronous. It is not tied to a schema library.

```ts
import { defineSanityDataDecoder } from '@standard/sanity-kit/core'

export const titleDecoder = defineSanityDataDecoder<string>({
	decode(input) {
		if (typeof input === 'string' && input.length > 0) {
			return { success: true, value: input, diagnostics: [] }
		}
		return {
			success: false,
			diagnostics: [{ code: 'title', message: 'Title is required.', path: [] }],
		}
	},
})
```

`defineSanityDataDecoder` preserves inference; it does not add validation of its
own. A `SanityDecodeResult<T>` has exactly one of two forms:

- Success: `success: true`, a typed `value`, and an empty `diagnostics` array.
- Failure: `success: false` and diagnostics, with no claimed valid value.

Each diagnostic has a machine-readable `code`, human-readable `message`, and
`path` of string keys or numeric array indexes. Optional `source` identifies its
producer. The [Zod adapter](validation-zod.md) implements this same contract.

Return diagnostics for expected invalid content. Unexpected exceptions are not
caught by the core helpers. Keep decoders free of mutation and side effects:
cache-backed loaders can call them more than once for the same input.

## Validate without stripping editing metadata

```ts
import {
	validateSanityData,
	requireValidSanityData,
} from '@standard/sanity-kit/core'

const validation = await validateSanityData(queryResult, pageDecoder)

// Original data, including any encoded editing metadata.
const original = validation.data

// Parsed output, including decoder defaults/transforms, or a thrown error.
const publishedPage = requireValidSanityData(validation)
```

`validateSanityData` recursively removes Stega from a separate value and gives
that clean shadow to the decoder. It returns both the original data and the
decoder result. The default cleaning does not mutate the input. An optional
`{ clean(data) }` callback replaces the cleaning operation; custom cleaners must
preserve that separation themselves.

Successful validation does not turn `validation.data` into the decoder's output.
For example, a decoder may convert a date string to a `Date`, while the original
still contains the string. Use `validation.result.value` after checking success
when you need parsed data.

The core helper deliberately does not decide whether failure should be tolerated.
That decision belongs to the caller. `requireValidSanityData` is the strict
convenience: it returns parsed output or throws `SanityDataValidationError` with
code `SANITY_DATA_INVALID` and a `diagnostics` property.

## How other subsystems use core

[Page loaders](loaders.md) validate published data with this clean-shadow path.
In preview they also run the strict decoder for diagnostics, then use a separate
preview decoder on the original data when configured. A draft schema must keep
the encoded strings used for rendering.

[Sitemap loaders](sitemaps.md) use strict decoded results; sitemaps never need
preview strings. Both loader families validate raw data before allowing cache
writes and validate cache reads again.

Diagnostics are not automatically safe for public responses. Schema messages
and paths may reveal content details. Log selected fields and expose detailed
issues only in appropriate, access-controlled editor UI.

## Source and related guides

Implementation: `src/core/config.ts` and `src/core/validation.ts`; public exports:
`src/core/index.ts` and `src/index.ts`. Tests live under `tests/core`.

Continue with [Zod](validation-zod.md), [loaders](loaders.md), or the
[documentation index](README.md).
