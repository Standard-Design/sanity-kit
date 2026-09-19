import { describe, expect, expectTypeOf, it } from 'vitest'
import {
	createSanityImageTools,
	parseSanityImageAspectRatio,
} from '../../src/image/index.js'

const image = {
	asset: { _ref: 'image-abc123-1600x900-jpg' },
	crop: { top: 0.1, bottom: 0, left: 0, right: 0 },
	hotspot: { x: 0.5, y: 0.4, height: 0.8, width: 0.8 },
}

const images = createSanityImageTools({
	dataset: 'production',
	projectId: 'project123',
})

describe('createSanityImageTools', () => {
	it('retains the native builder for custom transformations', () => {
		const url = images.urlFor(image).width(800).fit('crop').url()

		expect(url).toContain(
			'https://cdn.sanity.io/images/project123/production/abc123-1600x900.jpg',
		)
		expect(new URL(url).searchParams.get('w')).toBe('800')
		expect(new URL(url).searchParams.get('fit')).toBe('crop')
	})

	it('builds an auto-formatted crop from an aspect ratio', () => {
		const url = new URL(
			images.buildUrl(image, {
				aspectRatio: '16/9',
				quality: 82,
				width: 1200,
			}),
		)

		expect(url.searchParams.get('w')).toBe('1200')
		expect(url.searchParams.get('h')).toBe('675')
		expect(url.searchParams.get('fit')).toBe('crop')
		expect(url.searchParams.get('q')).toBe('82')
		expect(url.searchParams.get('auto')).toBe('format')
	})

	it('allows automatic format negotiation to be disabled', () => {
		const url = new URL(
			images.buildUrl(image, { autoFormat: false, width: 400 }),
		)

		expect(url.searchParams.get('auto')).toBeNull()
	})

	it.each([
		[{ width: 0 }, '`width` must be a positive integer'],
		[{ height: 20.5 }, '`height` must be a positive integer'],
		[{ width: 100, quality: 101 }, '`quality` must be an integer'],
		[
			{ width: 100, height: 100, aspectRatio: '1/1' },
			'`aspectRatio` cannot be combined with `height`',
		],
		[{ aspectRatio: '1/1' }, '`aspectRatio` requires an explicit `width`'],
	] as const)('rejects invalid options %#', (options, message) => {
		expect(() => images.buildUrl(image, options)).toThrow(message)
	})

	it('rejects empty project details', () => {
		expect(() =>
			createSanityImageTools({ dataset: ' ', projectId: 'project123' }),
		).toThrow('`dataset` must not be empty')
	})
})

describe('parseSanityImageAspectRatio', () => {
	it('parses numeric and fractional ratios', () => {
		expect(parseSanityImageAspectRatio(1.5)).toBe(1.5)
		expect(parseSanityImageAspectRatio('16/9')).toBeCloseTo(16 / 9)
		expectTypeOf(parseSanityImageAspectRatio('4/3')).toBeNumber()
	})

	it.each(['16', '0/9', '16/0', 'wide/tall', '1/2/3'])(
		'rejects invalid ratio %s',
		(value) => {
			expect(() => parseSanityImageAspectRatio(value)).toThrow('`aspectRatio`')
		},
	)
})
