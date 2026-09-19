import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
	createResponsiveSanityImageWidths,
	createSanityImageComponent,
} from '../../src/image/react/index.js'

const value = {
	asset: { _ref: 'image-abc123-1600x900-jpg' },
	crop: { top: 0, bottom: 0, left: 0, right: 0 },
	hotspot: { x: 0.5, y: 0.5, height: 1, width: 1 },
}

const SanityImage = createSanityImageComponent({
	dataset: 'production',
	projectId: 'project123',
	widths: [1280, 320, 640, 640],
})

describe('createSanityImageComponent', () => {
	it('renders a responsive, lazy image without upscaling', () => {
		const html = renderToStaticMarkup(
			<SanityImage
				value={value}
				alt="A responsibly sized image"
				intrinsicWidth={1000}
				intrinsicHeight={750}
				sizes="(min-width: 60rem) 50vw, 100vw"
			/>,
		)

		expect(html).toContain('alt="A responsibly sized image"')
		expect(html).toContain('decoding="async"')
		expect(html).toContain('loading="lazy"')
		expect(html).toContain('width="1000"')
		expect(html).toContain('height="750"')
		expect(html).toContain(' 320w')
		expect(html).toContain(' 640w')
		expect(html).toContain(' 1000w')
		expect(html).not.toContain(' 1280w')
		expect(html).toContain('max-width:100%')
		expect(html).toContain('height:auto')
	})

	it('uses the requested crop ratio and placeholder color', () => {
		const html = renderToStaticMarkup(
			<SanityImage
				value={value}
				alt="Cropped image"
				aspectRatio="16/9"
				intrinsicWidth={1600}
				intrinsicHeight={900}
				placeholderColor="#abcdef"
			/>,
		)

		expect(html).toContain('width="1280"')
		expect(html).toContain('height="720"')
		expect(html).toContain('background-color:#abcdef')
		expect(html).toContain('h=720')
		expect(html).toContain('fit=crop')
	})

	it('marks high-priority images eager and emits preload metadata', () => {
		const html = renderToStaticMarkup(
			<SanityImage
				value={value}
				alt="Important image"
				fetchPriority="high"
				intrinsicWidth={1600}
				intrinsicHeight={900}
			/>,
		)

		expect(html).toContain('rel="preload"')
		expect(html).toContain('as="image"')
		expect(html).toContain('fetchPriority="high"')
		expect(html).toContain('loading="eager"')
	})

	it('accepts explicit empty alt text for decorative images', () => {
		const html = renderToStaticMarkup(
			<SanityImage
				value={value}
				alt=""
				intrinsicWidth={320}
				intrinsicHeight={180}
			/>,
		)

		expect(html).toContain('alt=""')
	})

	it('rejects invalid intrinsic dimensions', () => {
		expect(() =>
			renderToStaticMarkup(
				<SanityImage
					value={value}
					alt="Invalid image"
					intrinsicWidth={0}
					intrinsicHeight={900}
				/>,
			),
		).toThrow('`intrinsicWidth` must be a positive integer')
	})
})

describe('createResponsiveSanityImageWidths', () => {
	it('sorts, deduplicates, and caps widths at the source size', () => {
		expect(
			createResponsiveSanityImageWidths([800, 320, 640, 640], 700),
		).toEqual([320, 640, 700])
	})

	it('caps large sources at the configured maximum', () => {
		expect(createResponsiveSanityImageWidths([320, 640, 1200], 4000)).toEqual([
			320, 640, 1200,
		])
	})

	it('rejects empty or invalid width lists', () => {
		expect(() => createResponsiveSanityImageWidths([], 800)).toThrow(
			'must not be empty',
		)
		expect(() => createResponsiveSanityImageWidths([320, -1], 800)).toThrow(
			'`responsive image width` must be a positive integer',
		)
	})
})
