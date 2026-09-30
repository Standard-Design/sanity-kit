# Image tools

Import from `@standard/sanity-kit/image`. These browser-safe, framework-independent
helpers prepare image data and construct URLs without fetching the image.
Install the optional `@sanity/image-url` peer. `@sanity/asset-utils` is an
automatically installed package dependency, used for source parsing.

For a ready-to-use responsive `<img>`, see [React images](image-react.md).

## Configure the URL builder

```ts
import { createSanityImageTools } from '@standard/sanity-kit/image'

export const images = createSanityImageTools({
	projectId: 'your-project-id',
	dataset: 'production',
})

// image is an application-provided Sanity image source.
const cardUrl = images.buildUrl(image, { width: 1200, aspectRatio: '16/9' })
const customUrl = images.urlFor(image).width(800).fit('crop').url()
```

`projectId` and `dataset` are required, nonempty strings. Optional `baseUrl`
overrides the CDN base, including a custom path such as
`https://assets.example.com/sanity`. The application must trust and validate its
own proxy origin; the helper is not an origin allowlist.

`urlFor(source)` returns Sanity's native builder for advanced transformations.
`buildUrl(source, options)` adds validation and defaults for common options:

| Option            | Meaning and constraints                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------------------- |
| `width`, `height` | Positive whole-pixel encoded-image dimensions, not CSS dimensions                                          |
| `aspectRatio`     | Positive finite number or fraction such as `'16/9'`; requires `width` and cannot be combined with `height` |
| `quality`         | Integer from 0 through 100                                                                                 |
| `fit`             | Sanity fit mode; defaults to `crop` when height or aspect ratio is supplied                                |
| `autoFormat`      | Requests automatic format selection unless explicitly `false`                                              |

A width-only request retains the source crop's natural ratio. An aspect ratio
derives height by rounding `width / ratio`. `parseSanityImageAspectRatio` exposes
the same ratio parser independently; it rejects zero, negative, nonfinite, and
malformed ratios, including a fraction whose division overflows or underflows.

The low-level builders **do not cap output dimensions to the source**. They pass
crop and hotspot information to the official builder. Use the React adapter if
you want the kit's crop-aware responsive pixel limits. Native `urlFor` chains do
not inherit `buildUrl`'s automatic-format default or option validation.

## Prepare unknown or incomplete image data

Drafts may contain an empty image field, a missing asset, or incomplete crop
settings. `prepareSanityImage` gives you a result to inspect before rendering:

```ts
import { prepareSanityImage } from '@standard/sanity-kit/image'

const prepared = prepareSanityImage(documentImage)
if (prepared.success) {
	const { value, intrinsicWidth, intrinsicHeight } = prepared.image
	// Pass these three fields to the configured React image component.
} else {
	// Application policy: omit, show a placeholder, or report prepared.reason.
}
```

Accepted sources include standard Sanity image objects, asset references, asset
documents, asset IDs, and resolvable Sanity asset URLs/path stubs. Parsing uses
the official asset parser, including valid full asset hashes. Arbitrary URLs
and synthetic shortened test IDs are not a substitute for a valid asset identity.

The result contains only a normalized `value` and the original asset's
`intrinsicWidth`/`intrinsicHeight`. It does not copy alt text, captions, palettes,
or other application fields, and does not mutate its input. Dimensions come
from the asset ID; a metadata projection is not required.

### Asset identity and origin

Asset identity is selected in order: `_ref`, `_id`, `url`, then `path`, skipping
null or undefined values. An explicitly supplied but malformed ID does not fall
back to a URL. This avoids silently choosing a different asset.

Parsing an asset URL does not adopt its project, dataset, or origin. URLs later
generated from the normalized source use the builder's configured project,
dataset, and `baseUrl`. Preparation checks source structure, not whether that
asset exists in the configured dataset.

### Crop and hotspot handling

Missing or null crop edges become zero. Supplied edges must be finite fractions
from 0 through 1. The retained crop must have at least one pixel in each axis,
using the same pixel-rounding model as the URL builder.

A complete, valid hotspot is preserved. An incomplete or invalid hotspot is
omitted, letting the upstream builder use its centered default. A bad hotspot
does not by itself make an otherwise usable image fail preparation.

### Failure results

| `reason`             | Meaning                                                            |
| -------------------- | ------------------------------------------------------------------ |
| `missing-asset`      | Source/asset is null or absent, or an upload has no asset yet      |
| `invalid-asset`      | The supplied identity/source could not be parsed as an image asset |
| `invalid-dimensions` | Original dimensions are not usable positive integers               |
| `invalid-crop`       | Crop fields are malformed or out of range                          |
| `empty-crop`         | The rounded crop retains no usable rectangle                       |

These results describe content problems, not component configuration problems.
Invalid width settings, output ratios, or intrinsic dimensions supplied to the
React component still throw. Applications decide how to present unusable images;
the kit does not silently substitute a placeholder.

## Source and related guides

Implementation: `src/image/index.ts` and `src/image/prepare.ts`. Tests are under
`tests/image`. Continue with [React images](image-react.md),
[Visual Editing](visual-editing.md), or the [documentation index](README.md).
