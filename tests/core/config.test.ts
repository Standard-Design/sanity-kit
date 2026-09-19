import { describe, expect, expectTypeOf, it } from 'vitest'
import { defineSanityConfig } from '../../src/core/index.js'

describe('defineSanityConfig', () => {
	it('returns an immutable copy while preserving literal types', () => {
		const input = {
			apiVersion: '2026-09-18',
			dataset: 'production',
			projectId: 'abc123',
			studioUrl: 'https://studio.example.com',
		} as const

		const result = defineSanityConfig(input)

		expect(result).not.toBe(input)
		expect(result).toEqual(input)
		expect(Object.isFrozen(result)).toBe(true)
		expectTypeOf(result.dataset).toEqualTypeOf<'production'>()
	})

	it.each(['projectId', 'dataset'] as const)('rejects an empty %s', (field) => {
		expect(() =>
			defineSanityConfig({
				apiVersion: '2026-09-18',
				dataset: field === 'dataset' ? ' ' : 'production',
				projectId: field === 'projectId' ? ' ' : 'abc123',
			}),
		).toThrow(`\`${field}\` must not be empty`)
	})

	it('rejects a non-date API version', () => {
		expect(() =>
			defineSanityConfig({
				apiVersion: 'v2026-09-18',
				dataset: 'production',
				projectId: 'abc123',
			}),
		).toThrow('`apiVersion` must use the YYYY-MM-DD format')
	})

	it('rejects an impossible API version date', () => {
		expect(() =>
			defineSanityConfig({
				apiVersion: '2026-02-30',
				dataset: 'production',
				projectId: 'abc123',
			}),
		).toThrow('`apiVersion` must be a valid calendar date')
	})

	it('rejects a relative Studio URL', () => {
		expect(() =>
			defineSanityConfig({
				apiVersion: '2026-09-18',
				dataset: 'production',
				projectId: 'abc123',
				studioUrl: '/studio',
			}),
		).toThrow('`studioUrl` must be an absolute URL')
	})
})
