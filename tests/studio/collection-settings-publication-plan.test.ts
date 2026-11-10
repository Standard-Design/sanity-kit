import { describe, expect, it } from 'vitest'
import { createCollectionSettingsPublicationClassifier } from '../../src/studio/collections/settings-publication-plan.js'
import type { CollectionRoutingConfig } from '../../src/url/settings/resolve.js'
import { configuration, setting } from './collection-prefix-fixtures.js'

const published = setting()
const draft = setting('drafts.journal-settings', '/blog', 'draft-settings')
const input = { collection: 'journal', published, draft }
const classify =
	createCollectionSettingsPublicationClassifier(configuration).classify

function withPrefix(
	routePrefix: NonNullable<
		CollectionRoutingConfig['collections']
	>[number]['routePrefix'],
) {
	return {
		...configuration,
		collections: [{ ...configuration.collections![0]!, routePrefix }],
	} as CollectionRoutingConfig
}

describe('collection settings publication classification', () => {
	it('distinguishes an existing prefix move and captures both document revisions', () => {
		expect(classify(input)).toEqual({
			ok: true,
			value: {
				kind: 'prefix-change',
				collection: 'journal',
				documentId: 'journal-settings',
				publishedRevision: 'live-settings',
				draftRevision: 'draft-settings',
				prefixOwnership: 'editable',
				oldPrefix: '/journal',
				newPrefix: '/blog',
			},
		})
	})
	it('classifies a name-only edit without inventing a URL move', () => {
		expect(
			classify({
				...input,
				draft: {
					...draft,
					prefix: { _type: 'slug', current: '/journal' },
					displayName: 'Articles',
				},
			}),
		).toMatchObject({
			ok: true,
			value: { kind: 'unchanged-prefix', prefix: '/journal' },
		})
	})
	it('classifies the first editable settings publication as URL activation', () => {
		expect(classify({ ...input, published: null })).toEqual({
			ok: true,
			value: {
				kind: 'first-publication',
				collection: 'journal',
				documentId: 'journal-settings',
				publishedRevision: null,
				draftRevision: 'draft-settings',
				prefixOwnership: 'editable',
				prefix: '/blog',
				activatesUrls: true,
			},
		})
	})
	it('does not treat a configured default as an existing live prefix or missing draft value', () => {
		const configured = createCollectionSettingsPublicationClassifier(
			withPrefix({ mode: 'default', value: '/suggested' }),
		)
		expect(configured.classify({ ...input, published: null })).toMatchObject({
			ok: true,
			value: {
				kind: 'first-publication',
				prefix: '/blog',
				activatesUrls: true,
			},
		})
		expect(
			configured.classify({
				...input,
				published: null,
				draft: { ...draft, prefix: undefined },
			}),
		).toEqual({ ok: false, reason: 'invalid-prefix', version: 'draft' })
	})
	it.each(['/news', { mode: 'locked' as const, value: '/news' }])(
		'uses the effective locked prefix for existing and first settings publication (%j)',
		(routePrefix) => {
			const configured = createCollectionSettingsPublicationClassifier(
				withPrefix(routePrefix),
			)
			expect(configured.classify(input)).toMatchObject({
				ok: true,
				value: {
					kind: 'unchanged-prefix',
					prefix: '/news',
					prefixOwnership: 'locked',
				},
			})
			expect(configured.classify({ ...input, published: null })).toMatchObject({
				ok: true,
				value: {
					kind: 'first-publication',
					prefix: '/news',
					activatesUrls: false,
				},
			})
		},
	)
	it('does not require stale stored prefixes to match the effective locked configuration', () => {
		const configured = createCollectionSettingsPublicationClassifier(
			withPrefix('/news'),
		)
		expect(
			configured.classify({ ...input, draft: { ...draft, prefix: undefined } }),
		).toMatchObject({
			ok: true,
			value: { kind: 'unchanged-prefix', prefix: '/news' },
		})
		// This classification does not authorize changes to read-only fields.
	})
	it('can classify one new collection while another still has no settings document', () => {
		const configured = createCollectionSettingsPublicationClassifier({
			...configuration,
			collections: [
				...configuration.collections!,
				{
					name: 'products',
					settingsDocumentId: 'product-settings',
					index: { schemaType: 'page', pathname: '/products' },
					items: [{ schemaType: 'product', slugField: 'slug.current' }],
				},
			],
		})
		expect(configured.classify({ ...input, published: null })).toMatchObject({
			ok: true,
			value: {
				kind: 'first-publication',
				activatesUrls: true,
				prefix: '/blog',
			},
		})
	})
	it('does not claim that a classification has checked other collection collisions', () => {
		const configured = createCollectionSettingsPublicationClassifier({
			...configuration,
			collections: [
				...configuration.collections!,
				{
					name: 'products',
					routePrefix: '/blog',
					index: { schemaType: 'page', pathname: '/products' },
					items: [{ schemaType: 'product', slugField: 'slug.current' }],
				},
			],
		})
		expect(configured.classify(input)).toMatchObject({
			ok: true,
			value: { kind: 'prefix-change', newPrefix: '/blog' },
		})
	})
	it.each([
		{},
		{ draft },
		{ published },
		{ published: undefined, draft },
		{ published, draft: undefined },
	])(
		'requires explicit evidence for both document versions (%j)',
		(documents) => {
			expect(classify({ collection: 'journal', ...documents })).toEqual({
				ok: false,
				reason: 'incomplete-evidence',
			})
		},
	)
	it('requires an actual draft to classify publishing', () => {
		expect(classify({ ...input, draft: null })).toEqual({
			ok: false,
			reason: 'missing-draft',
		})
	})
	it.each([null, [], 'journal', {}, { collection: 42 }])(
		'rejects malformed input (%j)',
		(value) => {
			expect(classify(value)).toEqual({ ok: false, reason: 'invalid-input' })
		},
	)
	it('rejects unregistered and configuration-only collections', () => {
		expect(classify({ ...input, collection: 'missing' })).toEqual({
			ok: false,
			reason: 'unknown-collection',
		})
		const configured = createCollectionSettingsPublicationClassifier({
			...configuration,
			collections: [
				{
					name: 'journal',
					routePrefix: '/journal',
					index: { schemaType: 'page', pathname: '/insights' },
					items: [{ schemaType: 'post', slugField: 'slug.current' }],
				},
			],
		})
		expect(configured.classify(input)).toEqual({
			ok: false,
			reason: 'settings-not-configured',
		})
	})
	it.each(['published', 'draft'] as const)(
		'rejects wrong identity, malformed data, and release identities in the %s slot',
		(version) => {
			for (const [patch, reason] of [
				[{ _id: 'unrelated-settings' }, 'wrong-settings-identity'],
				[{ _originalId: 'another-settings' }, 'wrong-settings-identity'],
				[{ _type: 'differentType' }, 'invalid-settings'],
				[{ collection: 'products' }, 'invalid-settings'],
				[{ _rev: ' ' }, 'invalid-settings'],
				[
					{ _id: 'versions.release-a.journal-settings' },
					'release-version-unsupported',
				],
			] as const) {
				expect(
					classify({ ...input, [version]: { ...input[version], ...patch } }),
				).toEqual({ ok: false, reason, version })
			}
			for (const malformed of [false, [], 'not-a-document'])
				expect(classify({ ...input, [version]: malformed })).toEqual({
					ok: false,
					reason: 'invalid-settings',
					version,
				})
		},
	)
	it('does not collapse draft identities into the published slot', () => {
		expect(classify({ ...input, published: draft })).toEqual({
			ok: false,
			reason: 'wrong-settings-identity',
			version: 'published',
		})
	})
	it.each([
		'/',
		'/journal/',
		'/journal//posts',
		'journal',
		'https://example.com',
	])(
		'rejects a noncanonical editable prefix instead of silently normalizing it (%s)',
		(prefix) => {
			expect(
				classify({
					...input,
					draft: { ...draft, prefix: { _type: 'slug', current: prefix } },
				}),
			).toEqual({ ok: false, reason: 'invalid-prefix', version: 'draft' })
		},
	)
	it('rejects malformed stored slug objects and does not call them first publication', () => {
		for (const prefix of ['/journal', { current: '/journal' }, null]) {
			expect(
				classify({ ...input, published: { ...published, prefix } }),
			).toEqual({
				ok: false,
				reason: 'invalid-prefix',
				version: 'published',
			})
		}
	})
	it('captures configuration, returns immutable results, and leaves inputs untouched', () => {
		const config = structuredClone(configuration)
		const configured = createCollectionSettingsPublicationClassifier(config)
		Object.assign(config.collections![0]!, {
			routePrefix: '/changed-by-caller',
		})
		const before = structuredClone(input)
		const result = configured.classify(input)
		expect(result).toMatchObject({ ok: true, value: { kind: 'prefix-change' } })
		if (!result.ok) throw new Error('Expected classification')
		expect(Object.isFrozen(result.value)).toBe(true)
		expect(input).toEqual(before)
	})
	it('uses shared registration checks before producing a classifier', () => {
		expect(() =>
			createCollectionSettingsPublicationClassifier(withPrefix('/bad/')),
		).toThrow()
	})
})
