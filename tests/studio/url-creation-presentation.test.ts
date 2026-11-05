import { beforeEach, describe, expect, it, vi } from 'vitest'
import { encodeJsonParams } from 'sanity/router'

const native = vi.hoisted(() => ({
	params: null as Record<string, unknown> | null,
	document: { _id: 'drafts.new-page', _type: 'page' },
}))
vi.mock('sanity', () => ({ useFormValue: () => native.document }))
vi.mock('sanity/presentation', () => ({
	usePresentationParams: () => native.params,
}))
import { useUrlCreationContext } from '../../src/studio/url/creation-presentation.js'

describe('Presentation URL creation transport', () => {
	beforeEach(() => {
		native.document = { _id: 'drafts.new-page', _type: 'page' }
		native.params = {
			id: 'new-page',
			type: 'page',
			template: 'page',
			templateParams: encodeJsonParams({
				sanityKitCreation: {
					version: 1,
					mode: 'index',
					pathname: '/about',
					schemaType: 'page',
					templateId: 'page',
					pathField: 'pathname.current',
				},
			}),
		}
	})
	it('reads the native JSON payload at the registered slug field', () => {
		expect(useUrlCreationContext(['pathname'])).toEqual({
			version: 1,
			mode: 'index',
			pathname: '/about',
			schemaType: 'page',
			templateId: 'page',
			pathField: 'pathname.current',
		})
		expect(useUrlCreationContext(['other'])).toBeUndefined()
	})
	it('ignores malformed parameters and fields outside Presentation', () => {
		native.params = { ...native.params, templateParams: 'not-json' }
		expect(useUrlCreationContext(['pathname'])).toBeUndefined()
		native.params = null
		expect(useUrlCreationContext(['pathname'])).toBeUndefined()
	})
	it('does not apply a surviving template parameter to another edited document', () => {
		native.document = { _id: 'drafts.shared-footer', _type: 'page' }
		expect(useUrlCreationContext(['pathname'])).toBeUndefined()
	})
})
