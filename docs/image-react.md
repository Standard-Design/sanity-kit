# Responsive React images

Import from `@standard/sanity-kit/image/react`. This optional adapter uses
[image tools](image.md) to render a native `<img>` with responsive URLs, layout
dimensions, and optional preload. It works in server-rendered React and in the
browser. It requires React, React DOM, and `@sanity/image-url` peers.

## Create one shared component

In a shared application module, for example `app/components/sanity-image.tsx`:

```tsx
import { createSanityImageComponent } from '@standard/sanity-kit/image/react'

export const SanityImage = createSanityImageComponent({
	projectId: 'your-project-id',
	dataset: 'production',
	widths: [320, 640, 960, 1200, 1600],
	quality: 85,
})
```

Import this configured `SanityImage` throughout the application. Calling the
factory during render creates a new component identity and should be avoided.
The component needs no context provider, CSS package, or hosting-specific image
service. It forwards its ref to the native image element.

Factory settings are `projectId`, `dataset`, optional `baseUrl`, and shared
`widths`, `quality`, `fit`, and `autoFormat` policies. Without custom widths, the
candidates are 320, 480, 640, 768, 960, 1200, 1600, 1920, and 2400 pixels.
Widths must be a nonempty list of positive integers; duplicates are removed and
the list is sorted. Quality, fit, and automatic format behavior follow the
[URL helper](image.md#configure-the-url-builder).

## Prepare and render an image

```tsx
import { prepareSanityImage } from '@standard/sanity-kit/image'
import { SanityImage } from './sanity-image'

export function ContentImage({ value, alt }: { value: unknown; alt: string }) {
	const prepared = prepareSanityImage(value)
	if (!prepared.success) return null // The application's missing-image policy.

	return (
		<SanityImage
			{...prepared.image}
			alt={alt}
			aspectRatio="16/9"
			sizes="(min-width: 60rem) 50vw, 100vw"
		/>
	)
}
```

Required props are `value`, `alt`, `intrinsicWidth`, and `intrinsicHeight`.
Preparation supplies the image source and dimensions; your application supplies
alt text. Use `alt=""` for an image your application considers decorative.
The component removes Stega metadata from alt text before writing the attribute.

The intrinsic dimensions must match the **original asset ID**, not dimensions
after editorial cropping. Preparation supplies the correct original values.
The component prepares the source again to protect direct callers and throws
if the supplied dimensions do not match.

## How responsive sizing works

The component starts from the pixels left after the editor's crop, not the
uncropped asset size. For each axis it rounds the leading crop offset, then
rounds the retained extent after the trailing crop. For width, this is:

```text
leftPixels = round(crop.left * originalWidth)
retainedWidth = round(originalWidth - crop.right * originalWidth - leftPixels)
```

Height uses the equivalent top/bottom calculation. Without `aspectRatio`, the
retained crop determines the natural ratio and URLs request width only. With
an explicit ratio, the maximum width is the smaller of the retained width and
`floor(retainedHeight * ratio)`. This prevents requests larger than the available
crop in either axis; Sanity's builder still owns hotspot positioning.

The effective cap is also limited by the largest configured width. Candidates
below that cap are kept, and the cap itself is included even if it was not in
the original list. The largest candidate becomes `src`; all candidates become
width-descriptor `srcSet` entries. The browser uses `sizes` and device conditions
to select one.

The exported `createResponsiveSanityImageWidths(widths, intrinsicWidth)` performs
the sorted, unique, capped candidate selection independently. It does not inspect
an image or calculate crops; pass the usable width budget when calling it directly.

Explicit output heights are rounded to whole pixels with a minimum of one.
Very small images may therefore differ slightly from the requested ratio.
A ratio that cannot yield even one pixel of width without upscaling throws.

## Layout and loading options

| Setting                | Default and behavior                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| `sizes`                | `100vw`; set it to describe the image's actual layout width                                     |
| `decoding`             | `async`; native override allowed                                                                |
| `loading`              | `lazy`, or `eager` for high-priority images; explicit native override wins                      |
| `fetchPriority="high"` | Adds a React DOM preload using the same URL, `srcSet`, and `sizes`                              |
| `placeholderColor`     | Optional background color while loading; no blur image is generated                             |
| `style`                | Overrides minimal inline defaults: `height: auto`, `maxWidth: 100%`, and placeholder background |

Generated HTML `width` and `height` reserve the largest rendition's aspect ratio.
Native events, classes, and other supported image props pass through. The kit
owns `src`, `srcSet`, width, and height; callers cannot override those URLs or
dimensions through native props.

Use high priority selectively for important initial images. The kit does not
detect the page's most important image for you. A custom `baseUrl` applies to
`src`, every responsive candidate, and the preload.

## Application responsibilities and failures

You own alt/decorative policy, captions, layout, `sizes`, quality choices, proxy
origin policy, and missing-image UI. The component performs no asset fetch to
verify existence and supplies no design-system styling.

Use preparation failures to handle incomplete drafts before render. Invalid
configuration, source geometry, or ratios still produce `TypeError`; they are
not converted to a silent empty image. See [image preparation](image.md#prepare-unknown-or-incomplete-image-data).

## Source and related guides

Implementation: `src/image/react/index.tsx`; tests under `tests/image`.
See [image tools](image.md), [prerelease image compatibility](prerelease.md#image-compatibility-in-alpha2),
or the [documentation index](README.md).
