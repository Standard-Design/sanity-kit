import { describe, expect, it } from 'vitest'
import { prepareSanityImage } from '../../src/image/index.js'

const hash = 'a'.repeat(40)
const id = `image-${hash}-2000x1000-jpg`
const url = `https://cdn.sanity.io/images/project123/production/${hash}-2000x1000.jpg`

describe('prepareSanityImage', () => {
	it.each([
		id,
		{ _ref: id },
		{ _id: id },
		{ asset: { _ref: id } },
		{ asset: { _id: id } },
		url,
		{ asset: { url } },
		{ url },
		{ asset: { path: `images/project123/production/${hash}-2000x1000.jpg` } },
	])('resolves standard source shape %# without metadata', (value) => {
		expect(prepareSanityImage(value)).toEqual({
			success: true,
			image: {
				value: {
					asset: { _ref: id },
					crop: { left: 0, right: 0, top: 0, bottom: 0 },
				},
				intrinsicWidth: 2000,
				intrinsicHeight: 1000,
			},
		})
	})

	it('uses the ID rather than metadata or a document-supplied URL', () => {
		const source = {
			asset: {
				_id: id,
				url: 'https://attacker.example/image.jpg',
				metadata: { dimensions: { width: 0, height: 0 } },
			},
			crop: { left: 0.1, right: 0.1 },
			hotspot: { x: 0.7, y: 0.4, width: 0.2, height: 0.3 },
			alt: 'App-owned',
			caption: 'App-owned',
			decorative: false,
		}
		const before = structuredClone(source)
		expect(prepareSanityImage(source)).toEqual({
			success: true,
			image: {
				value: {
					asset: { _ref: id },
					crop: { left: 0.1, right: 0.1, top: 0, bottom: 0 },
					hotspot: source.hotspot,
				},
				intrinsicWidth: 2000,
				intrinsicHeight: 1000,
			},
		})
		expect(source).toEqual(before)
	})

	it.each([
		undefined,
		null,
		{ asset: null },
		{ asset: undefined },
		{ _upload: { progress: 50 } },
	])('reports missing assets %#', (source) => {
		expect(prepareSanityImage(source)).toEqual({
			success: false,
			reason: 'missing-asset',
		})
	})
	it.each([
		{},
		[],
		42,
		'',
		'bad',
		'image-abc-2000x1000-jpg',
		`file-${hash}-jpg`,
		`image-${hash}-100x100-jpg-extra`,
		`image-${hash}-1.5x100-jpg`,
		`image-${hash}-1e3x100-jpg`,
		{ asset: { _id: 'bad', url } },
		{ asset: { _ref: 'bad', _id: id } },
		'https://attacker.example/image.jpg',
	])(
		'reports malformed assets without throwing or falling back %#',
		(source) => {
			expect(prepareSanityImage(source)).toEqual({
				success: false,
				reason: 'invalid-asset',
			})
		},
	)
	it.each(['0x100', '100x0', '9007199254740992x100'])(
		'rejects unusable original dimensions %s',
		(dimensions) => {
			expect(prepareSanityImage(`image-${hash}-${dimensions}-jpg`)).toEqual({
				success: false,
				reason: 'invalid-dimensions',
			})
		},
	)
	it.each([{}, null, undefined, { left: null, top: undefined }])(
		'defaults absent draft crop edges %#',
		(crop) => {
			const result = prepareSanityImage({ asset: { _ref: id }, crop })
			expect(result.success && result.image.value.crop).toEqual({
				left: 0,
				right: 0,
				top: 0,
				bottom: 0,
			})
		},
	)
	it.each([-0.1, 1.1, NaN, Infinity, '0.1', true])(
		'rejects invalid crop fractions %s',
		(left) => {
			expect(
				prepareSanityImage({ asset: { _ref: id }, crop: { left } }),
			).toEqual({ success: false, reason: 'invalid-crop' })
		},
	)
	it.each([[], 'crop', 0])('rejects invalid crop shapes %#', (crop) => {
		expect(prepareSanityImage({ asset: { _ref: id }, crop })).toEqual({
			success: false,
			reason: 'invalid-crop',
		})
	})
	it.each([
		{ left: 0.5, right: 0.5 },
		{ top: 0.6, bottom: 0.5 },
		{ top: 0.99999 },
	])('rejects crops with no retained pixels %#', (crop) => {
		expect(prepareSanityImage({ asset: { _ref: id }, crop })).toEqual({
			success: false,
			reason: 'empty-crop',
		})
	})
	it.each([
		undefined,
		null,
		{},
		{ x: 0.7 },
		{ x: 0.5, y: 0.5, width: NaN, height: 1 },
		{ x: -0.1, y: 0.5, width: 1, height: 1 },
		{ x: 0.5, y: 0.5, width: 1, height: 2 },
		{ x: 0.5, y: 0.5, width: 0, height: 1 },
	])(
		'omits incomplete or invalid hotspots without discarding the image %#',
		(hotspot) => {
			const result = prepareSanityImage({ asset: { _ref: id }, hotspot })
			expect(result.success).toBe(true)
			expect(result.success && result.image.value.hotspot).toBeUndefined()
		},
	)
})
