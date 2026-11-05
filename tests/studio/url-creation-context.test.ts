import { describe, expect, it } from 'vitest'
import {
	matchSanityKitCreationContext,
	parseSanityKitCreationContext,
} from '../../src/studio/url/creation-context.js'

const context = {
	version: 1,
	mode: 'page',
	pathname: '/about/company',
	schemaType: 'page',
	templateId: 'page-with-seo',
	pathField: 'seo.pathname.current',
}
const identity = {
	selectedId: 'new-page',
	documentId: 'drafts.new-page',
	selectedType: 'page',
	documentType: 'page',
	templateId: 'page-with-seo',
	pathField: 'seo.pathname.current',
}
describe('native URL creation hints', () => {
	it('accepts canonical folders and the root, without writing document values', () => {
		expect(
			parseSanityKitCreationContext({ sanityKitCreation: context }),
		).toEqual(context)
		expect(
			parseSanityKitCreationContext({
				sanityKitCreation: { ...context, mode: 'index', pathname: '/' },
			})?.pathname,
		).toBe('/')
	})
	it.each([
		{ pathname: '/about/' },
		{ pathname: '/about//team' },
		{ pathname: '//host' },
		{ pathname: '/about?query' },
		{ pathname: '/a/%2f/b' },
		{ version: 2 },
		{ mode: 'anything' },
		{ schemaType: '' },
		{ templateId: '' },
		{ pathField: 'pathname' },
		{ pathField: '__proto__.current' },
	])('rejects malformed or noncanonical hints: %j', (override) => {
		expect(
			parseSanityKitCreationContext({
				sanityKitCreation: { ...context, ...override },
			}),
		).toBeUndefined()
	})
	it('matches a native ID before and after its drafts prefix is assigned', () => {
		const payload = { sanityKitCreation: context }
		expect(matchSanityKitCreationContext(payload, identity)).toEqual(context)
		expect(
			matchSanityKitCreationContext(payload, {
				...identity,
				documentId: 'new-page',
			}),
		).toEqual(context)
	})
	it.each([
		{ selectedId: 'other' },
		{ documentId: 'drafts.other' },
		{ selectedType: 'post' },
		{ documentType: 'post' },
		{ templateId: 'other' },
		{ pathField: 'pathname.current' },
		{ documentId: 'versions.release.new-page' },
		{ selectedId: undefined },
	])('does not leak a hint into a different editor context: %j', (override) => {
		expect(
			matchSanityKitCreationContext(
				{ sanityKitCreation: context },
				{ ...identity, ...override },
			),
		).toBeUndefined()
	})
})
