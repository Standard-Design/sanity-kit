import { describe, expect, expectTypeOf, it } from 'vitest'
import {
	defineSanityDataDecoder,
	requireValidSanityData,
	SanityDataValidationError,
	validateSanityData,
} from '../../src/core/index.js'

describe('validateSanityData', () => {
	it('validates a clean shadow while preserving preview render data', async () => {
		const previewData = {
			title: 'Stega-encoded title',
			nested: { count: 1 },
		}
		let decoderInput: unknown

		const decoder = defineSanityDataDecoder({
			decode(input) {
				decoderInput = input
				return {
					success: true,
					value: { title: 'Clean title' },
					diagnostics: [],
				}
			},
		})

		const validation = await validateSanityData(previewData, decoder, {
			clean: (data) => ({ ...data, title: 'Clean title' }),
		})

		expect(validation.data).toBe(previewData)
		expect(validation.data.title).toBe('Stega-encoded title')
		expect(decoderInput).toEqual({
			title: 'Clean title',
			nested: { count: 1 },
		})
		expectTypeOf(validation.data).toEqualTypeOf<{
			title: string
			nested: { count: number }
		}>()
	})

	it('supports asynchronous decoders', async () => {
		const validation = await validateSanityData(
			{ title: 'Page' },
			defineSanityDataDecoder({
				async decode() {
					return Promise.resolve({
						success: true,
						value: 42,
						diagnostics: [],
					})
				},
			}),
		)

		expect(requireValidSanityData(validation)).toBe(42)
	})

	it('keeps structured diagnostics for tolerant preview handling', async () => {
		const previewData = { title: null }
		const validation = await validateSanityData(
			previewData,
			defineSanityDataDecoder({
				decode() {
					return {
						success: false,
						diagnostics: [
							{
								code: 'invalid_type',
								message: 'Expected a string.',
								path: ['title'],
							},
						],
					}
				},
			}),
		)

		expect(validation.data).toBe(previewData)
		expect(validation.result).toEqual({
			success: false,
			diagnostics: [
				{
					code: 'invalid_type',
					message: 'Expected a string.',
					path: ['title'],
				},
			],
		})
	})
})

describe('requireValidSanityData', () => {
	it('returns parsed or transformed data', () => {
		const value = requireValidSanityData({
			data: { title: 'Render title' },
			result: {
				success: true,
				value: { heading: 'Application heading' },
				diagnostics: [],
			},
		})

		expect(value).toEqual({ heading: 'Application heading' })
	})

	it('throws a structured error for strict published boundaries', () => {
		const diagnostics = [
			{
				code: 'missing',
				message: 'Title is required.',
				path: ['title'],
			},
		]

		expect(() =>
			requireValidSanityData({
				data: { title: null },
				result: { success: false, diagnostics },
			}),
		).toThrow(SanityDataValidationError)

		try {
			requireValidSanityData({
				data: { title: null },
				result: { success: false, diagnostics },
			})
		} catch (error) {
			expect(error).toMatchObject({
				code: 'SANITY_DATA_INVALID',
				diagnostics,
			})
		}
	})
})
