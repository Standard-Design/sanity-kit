import { renderToStaticMarkup } from 'react-dom/server'
import { createImageUrlBuilder } from '@sanity/image-url'
import { prepareSanityImage } from '../../src/image/index.js'
import { describe, expect, it } from 'vitest'
import {
	createResponsiveSanityImageWidths,
	createSanityImageComponent,
} from '../../src/image/react/index.js'

const assetId = (width: number, height: number) =>
	`image-${'a'.repeat(40)}-${width}x${height}-jpg`
const value = {
	asset: { _ref: assetId(1600, 900) },
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
				intrinsicWidth={1600}
				intrinsicHeight={900}
				sizes="(min-width: 60rem) 50vw, 100vw"
			/>,
		)

		expect(html).toContain('alt="A responsibly sized image"')
		expect(html).toContain('decoding="async"')
		expect(html).toContain('loading="lazy"')
		expect(html).toContain('width="1280"')
		expect(html).toContain('height="720"')
		expect(html).toContain(' 320w')
		expect(html).toContain(' 640w')
		expect(html).toContain(' 1280w')
		expect(html).not.toContain(' 1600w')
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
				intrinsicWidth={1600}
				intrinsicHeight={900}
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

function renderPrepared(
	source: unknown,
	aspectRatio?: number | string,
	fit: 'crop' | 'max' = 'max',
) {
	const prepared = prepareSanityImage(source)
	if (!prepared.success) throw new Error(prepared.reason)
	const config = {
		projectId: 'project123',
		dataset: 'production',
		baseUrl: 'https://assets.example.com/sanity',
		widths: [320, 480, 640, 768, 960, 1200],
		quality: 80,
		fit,
	}
	const Image = createSanityImageComponent(config)
	const html = renderToStaticMarkup(
		<Image
			{...prepared.image}
			alt="Example"
			{...(aspectRatio === undefined ? {} : { aspectRatio })}
		/>,
	)
	const attribute = (name: string) => {
		const match = new RegExp(` ${name}="([^"]*)"`).exec(html)
		if (!match?.[1]) throw new Error(`Missing ${name}`)
		return match[1].replaceAll('&amp;', '&')
	}
	const candidates = attribute('srcSet')
		.split(', ')
		.map((candidate) => {
			const [url, descriptor] = candidate.split(' ')
			if (!url || !descriptor) throw new Error('Missing candidate')
			return { url: new URL(url), width: Number(descriptor.slice(0, -1)) }
		})
	return {
		html,
		attribute,
		candidates,
		src: new URL(attribute('src')),
		config,
		image: prepared.image,
	}
}

describe('crop-aware responsive SSR', () => {
	it('uses the same custom-origin srcSet for the image and priority preload', () => {
		const prepared = prepareSanityImage({
			asset: { _ref: assetId(800, 600) },
			crop: { left: 0.25, right: 0.25 },
		})
		if (!prepared.success) throw new Error(prepared.reason)
		const Image = createSanityImageComponent({
			projectId: 'project123',
			dataset: 'production',
			baseUrl: 'http://localhost:8788/sanity',
			widths: [320, 640, 1200],
		})
		const html = renderToStaticMarkup(
			<Image {...prepared.image} alt="" fetchPriority="high" sizes="50vw" />,
		)
		expect(html).toContain('rel="preload"')
		expect(html).toContain('loading="eager"')
		expect(html).toContain('imageSizes="50vw"')
		expect(/imageSrcSet="([^"]+)"/.exec(html)?.[1]).toBe(
			/ srcSet="([^"]+)"/.exec(html)?.[1],
		)
		expect(html).toContain('http://localhost:8788/sanity/images/')
		expect(html).not.toContain('cdn.sanity.io')
	})

	it('keeps integer output sizes inside retained pixels across small crops and ratios', () => {
		for (const [width, height] of [
			[7, 11],
			[101, 99],
			[800, 600],
		] as const) {
			for (const aspectRatio of [0.5, 1, 4 / 3, 16 / 9, 3]) {
				const result = renderPrepared(
					{
						asset: { _ref: assetId(width, height) },
						crop: { left: 0.125, right: 0.125, top: 0.125, bottom: 0.125 },
					},
					aspectRatio,
				)
				for (const { url, width: outputWidth } of result.candidates) {
					const outputHeight = Number(url.searchParams.get('h'))
					const [left, top, rectWidth, rectHeight] = url.searchParams
						.get('rect')!
						.split(',')
						.map(Number) as [number, number, number, number]
					expect(outputWidth).toBeLessThanOrEqual(rectWidth)
					expect(outputHeight).toBeLessThanOrEqual(rectHeight)
					expect(outputHeight).toBeGreaterThanOrEqual(1)
					expect(left + rectWidth).toBeLessThanOrEqual(width)
					expect(top + rectHeight).toBeLessThanOrEqual(height)
				}
			}
		}
	})
	it.each([
		{
			width: 2000,
			height: 1000,
			crop: { left: 0.1, right: 0.1 },
			rect: '200,0,1600,1000',
			outputWidth: 1200,
			outputHeight: 750,
			widths: [320, 480, 640, 768, 960, 1200],
		},
		{
			width: 800,
			height: 600,
			crop: { left: 0.25, right: 0.25 },
			rect: '200,0,400,600',
			outputWidth: 400,
			outputHeight: 600,
			widths: [320, 400],
		},
		{
			width: 2000,
			height: 1000,
			crop: { left: 0.45, right: 0.45 },
			rect: '900,0,200,1000',
			outputWidth: 200,
			outputHeight: 1000,
			widths: [200],
		},
		{
			width: 101,
			height: 99,
			crop: { left: 0.125, right: 0.125, top: 0.125, bottom: 0.125 },
			rect: '13,12,75,75',
			outputWidth: 75,
			outputHeight: 75,
			widths: [75],
		},
	])(
		'uses original $width x $height once with crop $rect',
		({ width, height, crop, rect, outputWidth, outputHeight, widths }) => {
			const source = {
				asset: {
					_id: assetId(width, height),
					url: 'https://attacker.example/file',
				},
				crop,
			}
			const result = renderPrepared(source)
			expect(result.attribute('width')).toBe(String(outputWidth))
			expect(result.attribute('height')).toBe(String(outputHeight))
			expect(result.candidates.map((entry) => entry.width)).toEqual(widths)
			for (const url of [
				result.src,
				...result.candidates.map((entry) => entry.url),
			]) {
				expect(url.origin + url.pathname).toBe(
					`https://assets.example.com/sanity/images/project123/production/${'a'.repeat(40)}-${width}x${height}.jpg`,
				)
				expect(url.searchParams.get('rect')).toBe(rect)
				expect(url.searchParams.get('h')).toBeNull()
				expect(url.searchParams.get('q')).toBe('80')
				expect(url.searchParams.get('fit')).toBe('max')
			}
			expect(result.html).not.toContain('attacker.example')
		},
	)

	it.each(['crop', 'max'] as const)(
		'caps both axes for fixed output ratios with fit=%s',
		(fit) => {
			for (const aspectRatio of ['1/1', '4/3', '16/9', '1/3']) {
				const result = renderPrepared(
					{
						asset: { _ref: assetId(2000, 1000) },
						crop: { left: 0.1, right: 0.1, top: 0.2, bottom: 0.2 },
						hotspot: { x: 0.8, y: 0.7, width: 0.1, height: 0.1 },
					},
					aspectRatio,
					fit,
				)
				const official = createImageUrlBuilder(result.config).image(
					result.image.value,
				)
				for (const { url, width } of result.candidates) {
					const height = Number(url.searchParams.get('h'))
					expect(width).toBeLessThanOrEqual(1600)
					expect(height).toBeLessThanOrEqual(600)
					expect(height).toBeGreaterThanOrEqual(1)
					expect(url.href).toBe(
						official
							.width(width)
							.height(height)
							.fit(fit)
							.quality(80)
							.auto('format')
							.url(),
					)
					const rect = url.searchParams.get('rect')!.split(',').map(Number)
					expect(rect[2]).toBeGreaterThanOrEqual(width)
					expect(rect[3]).toBeGreaterThanOrEqual(height)
				}
				expect(result.src.searchParams.get('w')).toBe(result.attribute('width'))
				expect(result.src.searchParams.get('h')).toBe(
					result.attribute('height'),
				)
			}
		},
	)

	it('positions the output crop over the hotspot inside the editorial crop', () => {
		const result = renderPrepared(
			{
				asset: { _ref: assetId(2000, 1000) },
				crop: { left: 0.1, right: 0.1 },
				hotspot: { x: 0.8, y: 0.5, width: 0.1, height: 0.1 },
			},
			'1/1',
		)
		expect(result.src.searchParams.get('rect')).toBe('800,0,1000,1000')
		expect(result.attribute('width')).toBe('1000')
		expect(result.attribute('height')).toBe('1000')
	})

	it('rejects cropped intrinsic dimensions instead of applying the crop twice', () => {
		expect(() =>
			renderToStaticMarkup(
				<SanityImage
					value={{
						asset: { _ref: assetId(800, 600) },
						crop: { left: 0.25, right: 0.25, top: 0, bottom: 0 },
					}}
					intrinsicWidth={400}
					intrinsicHeight={600}
					alt="Example"
				/>,
			),
		).toThrow('must match the original asset dimensions')
	})
	it('keeps unusable source and invalid output ratio errors explicit at render', () => {
		expect(() =>
			renderToStaticMarkup(
				<SanityImage
					value="bad"
					intrinsicWidth={100}
					intrinsicHeight={100}
					alt="Example"
				/>,
			),
		).toThrow('Use prepareSanityImage')
		expect(() => renderPrepared(assetId(100, 100), 0)).toThrow('`aspectRatio`')
		expect(() => renderPrepared(assetId(100, 100), 0.00001)).toThrow(
			'without upscaling',
		)
	})
	it('never emits zero output heights for tiny wide images', () => {
		const result = renderPrepared(assetId(2000, 1), '2000/1')
		expect(result.attribute('height')).toBe('1')
		for (const { url } of result.candidates)
			expect(url.searchParams.get('h')).toBe('1')
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
