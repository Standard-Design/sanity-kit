# Third-party notices

Original SanityKit code is licensed under MIT in [LICENSE](LICENSE), copyright
2026 Standard Design LLC. That license does not replace third-party terms.
Keep the applicable notices when redistributing adapted code.

## Sanity image URL builder

The crop-pixel calculation in `src/image/prepare.ts` (`getSanityImageCropRect`),
compiled to `image/prepare.js`, is adapted from `@sanity/image-url` 2.1.1. It
preserves upstream rounding so preparation and responsive sizing agree with the
image URL builder. The rest of that dependency is installed separately, not
bundled into this package.

Sources: [crop calculation](https://github.com/sanity-io/image-url/blob/v2.1.1/src/urlForImage.ts)
and [license](https://github.com/sanity-io/image-url/blob/v2.1.1/LICENSE).

```text
The MIT License (MIT)

Copyright (c) 2025 Sanity.io

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Tinloof responsive-image provenance — MIT interpretation

The earlier application image component explicitly credited Tinloof's Sanity
Kit for inspiration and its original implementation. The current image tools
and React component were rewritten during extraction, but retain that lineage
in responsive URL generation and preload behavior. This credit must not be
silently removed or treated as covered by Standard Design LLC's copyright.

At upstream revision `105e9c3fc780e98bcf23d2b80a27889bf07a9518`, which predates
the application adaptation:

- [Image source](https://github.com/tinloof/sanity-kit/blob/105e9c3fc780e98bcf23d2b80a27889bf07a9518/packages/sanity-web/src/components/sanity-image.tsx).
- [Package metadata](https://github.com/tinloof/sanity-kit/blob/105e9c3fc780e98bcf23d2b80a27889bf07a9518/packages/sanity-web/package.json)
  declares `ISC` and author `Tinloof`.
- [Package README](https://github.com/tinloof/sanity-kit/blob/105e9c3fc780e98bcf23d2b80a27889bf07a9518/packages/sanity-web/README.md#license)
  declares `MIT` and credits Tinloof, but its linked `LICENSE` file is absent.

The same discrepancy is present at inspected revision
`2964ee66121e660a50a1ed2ba9ec1711836ade3c`. A neighboring Studio package's MIT
license is not evidence that it applies to this image component.

### Maintainer decision

On October 11, 2026, Standard Design LLC, through maintainer Austin Maurer,
chose to treat this image lineage as MIT-licensed, interpreting the upstream
README's explicit MIT statement as the intended license despite the conflicting
ISC package metadata. This is Standard Design's interpretation, not confirmation
from Tinloof or a claim that the conflicting metadata has been corrected.

Upstream confirmation remains a follow-up, not a release prerequisite. No
upstream contact has been made as part of this audit. If clarification establishes
different terms or attribution, review and update the notices and distribution
accordingly. This decision does not itself approve a commit or publication.

### Notice included under that interpretation

The notice below combines the README's `© Tinloof` attribution with the standard
MIT permission and disclaimer text. It is supplied under the interpretation
above, not represented as a recovered upstream LICENSE file. No copyright year
has been inferred.

```text
MIT License

© Tinloof

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Separately installed dependencies

Sanity, React, React Router, Zod, and other dependencies retain their own terms.
The kit compiles its own TypeScript without bundling dependencies; test bundles
are temporary and are not shipped. No third-party fonts, icons, stylesheets, or
other binary assets are included. This file is not a license dump of development
or transitive dependencies. Applications that bundle dependencies must preserve
the notices applicable to their resulting bundles.
