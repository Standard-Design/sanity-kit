import { describe, expect, it } from 'vitest'
import { createCollectionSettingsActivationPlanner } from '../../src/studio/collections/settings-activation-plan.js'
import {
	COLLECTION_PREFIX_LIMITS,
	type CollectionPrefixInventory,
} from '../../src/studio/collections/prefix-plan.js'
import { REDIRECT_MAX_RECORDS } from '../../src/redirect/snapshot.js'
import {
	createCollectionRouting,
	type CollectionRoutingConfig,
} from '../../src/url/settings/resolve.js'
import {
	configuration,
	page,
	post,
	redirect,
	setting,
} from './collection-prefix-fixtures.js'

const choice = { collection: 'journal', draftRevision: 'draft-settings' }
const firstSettings = () =>
	setting('drafts.journal-settings', '/blog', 'draft-settings')
const inventory = (): CollectionPrefixInventory => ({
	perspective: 'raw',
	complete: true,
	readAccess: 'all-required-versions',
	settings: [firstSettings()],
	documents: [
		post(),
		post('drafts.post-1', 'draft-title'),
		page('index', '/insights'),
	],
	redirects: [],
})
const planner = createCollectionSettingsActivationPlanner(configuration)
const plan = (patch: Partial<CollectionPrefixInventory> = {}) =>
	planner.plan(choice, { ...inventory(), ...patch })
const productCollection = {
	name: 'products',
	settingsDocumentId: 'product-settings',
	index: { schemaType: 'page', pathname: '/products' },
	items: [{ schemaType: 'product', slugField: 'slug.current' }],
}
const withProducts: CollectionRoutingConfig = {
	...configuration,
	collections: [...configuration.collections!, productCollection],
}
const product = (id = 'product-1') => ({ ...post(id), _type: 'product' })

describe('first collection settings URL activation planning', () => {
	it('lists newly live and draft URLs without changing content, listing pages, or redirects', () => {
		const input = inventory()
		const before = structuredClone(input)
		const result = planner.plan(choice, input)
		expect(result).toMatchObject({
			ok: true,
			value: {
				collection: 'journal',
				documentId: 'journal-settings',
				draftRevision: 'draft-settings',
				prefix: '/blog',
				liveUrls: [
					{ id: 'post-1', pathname: '/blog/alpha', title: 'First post' },
				],
				draftUrls: [{ id: 'drafts.post-1', pathname: '/blog/draft-title' }],
				redirects: { creates: [], updates: [] },
				absentSettingsIds: ['journal-settings'],
				inactiveCollectionsBefore: ['journal'],
			},
		})
		if (!result.ok) throw new Error(JSON.stringify(result))
		expect(result.value.liveUrls).toHaveLength(1)
		expect(result.value.reviewVersions).toContainEqual({
			id: 'index',
			revision: 'revision-index',
		})
		expect(Object.isFrozen(result.value.liveUrls[0])).toBe(true)
		expect(input).toEqual(before)
	})
	it('can activate an empty collection and retains missing-slug drafts as drafts without URLs', () => {
		expect(plan({ documents: [] })).toMatchObject({
			ok: true,
			value: { liveUrls: [], draftUrls: [] },
		})
		expect(plan({ documents: [post('drafts.post-1', '')] })).toMatchObject({
			ok: true,
			value: {
				liveUrls: [],
				draftUrls: [{ id: 'drafts.post-1', pathname: null }],
			},
		})
	})
	it('does not require absent unrelated collection settings or use their configured defaults', () => {
		const routes = {
			...withProducts,
			collections: [
				configuration.collections![0]!,
				{
					...productCollection,
					routePrefix: { mode: 'default' as const, value: '/blog' },
				},
			],
		}
		const input = {
			...inventory(),
			documents: [...inventory().documents, product()],
		}
		const result = createCollectionSettingsActivationPlanner(routes).plan(
			choice,
			input,
		)
		expect(result).toMatchObject({
			ok: true,
			value: {
				inactiveCollectionsBefore: ['journal', 'products'],
				absentSettingsIds: [
					'drafts.product-settings',
					'journal-settings',
					'product-settings',
				],
			},
		})
		// This review-only exception never makes the frontend resolver invent routes.
		expect(
			createCollectionRouting(routes).resolve(
				{
					status: 'available',
					perspective: 'raw',
					coverage: 'published-and-drafts',
					complete: true,
					documents: input.settings,
				},
				'published',
			),
		).toMatchObject({ ok: false, reason: 'settings-missing' })
	})
	it.each(['product-settings', 'drafts.product-settings'])(
		'reserves a loaded other collection prefix even when it comes from %s',
		(id) => {
			const result = createCollectionSettingsActivationPlanner(
				withProducts,
			).plan(choice, {
				...inventory(),
				settings: [
					firstSettings(),
					setting(id, '/blog', 'product-rev', 'products'),
				],
			})
			expect(result).toMatchObject({ ok: false, reason: 'routing-conflict' })
		},
	)
	it('checks published and draft prefix spaces together when another collection has a planned move', () => {
		const result = createCollectionSettingsActivationPlanner(withProducts).plan(
			choice,
			{
				...inventory(),
				settings: [
					firstSettings(),
					setting('product-settings', '/shop', 'product-live', 'products'),
					setting(
						'drafts.product-settings',
						'/blog/nested',
						'product-draft',
						'products',
					),
				],
				documents: [
					...inventory().documents,
					product(),
					product('drafts.product-1'),
				],
			},
		)
		expect(result).toMatchObject({
			ok: false,
			reason: 'routing-conflict',
			detail: 'drafts:routing-conflict',
		})
	})
	it('validates unrelated loaded drafts instead of treating malformed settings as absent', () => {
		const result = createCollectionSettingsActivationPlanner(withProducts).plan(
			choice,
			{
				...inventory(),
				settings: [
					firstSettings(),
					{
						...setting('drafts.product-settings', '/shop', 'p', 'products'),
						prefix: null,
					},
				],
			},
		)
		expect(result).toMatchObject({
			ok: false,
			reason: 'settings-invalid',
			collection: 'products',
		})
	})
	it.each(['other-page', 'drafts.other-page', 'versions.release-a.other-page'])(
		'refuses a newly activated URL already occupied by %s',
		(id) => {
			expect(
				plan({
					documents: [...inventory().documents, page(id, '/blog/alpha')],
				}),
			).toMatchObject({
				ok: false,
				reason: 'url-collision',
				pathname: '/blog/alpha',
				documentId: id,
			})
		},
	)
	it('checks draft-only item URLs against existing ordinary pages', () => {
		expect(
			plan({
				documents: [
					post('drafts.post-1', 'draft-only'),
					page('page-1', '/blog/draft-only'),
				],
			}),
		).toMatchObject({
			ok: false,
			reason: 'url-collision',
			pathname: '/blog/draft-only',
		})
	})
	it('allows published and draft versions of the same item to share a URL', () => {
		expect(plan({ documents: [post(), post('drafts.post-1')] })).toMatchObject({
			ok: true,
		})
	})
	it('refuses two distinct items that would get the same URL', () => {
		expect(plan({ documents: [post(), post('post-2')] })).toMatchObject({
			ok: false,
			reason: 'url-collision',
			pathname: '/blog/alpha',
		})
	})
	it.each(['/account', '/account/posts', '/reserved'])(
		'refuses an app-reserved prefix %s',
		(prefix) => {
			expect(
				plan({
					settings: [
						{ ...firstSettings(), prefix: { _type: 'slug', current: prefix } },
					],
				}),
			).toMatchObject({
				ok: false,
				reason: 'reserved-prefix',
				pathname: prefix,
			})
		},
	)
	it('checks reservations on complete item URLs and respects segment boundaries', () => {
		const blocked = createCollectionSettingsActivationPlanner({
			...configuration,
			excludePaths: ['/blog/alpha'],
		})
		expect(blocked.plan(choice, inventory())).toMatchObject({
			ok: false,
			reason: 'invalid-url',
			documentId: 'post-1',
			detail: 'disallowed-path',
		})
		expect(
			plan({
				settings: [
					{
						...firstSettings(),
						prefix: { _type: 'slug', current: '/accounting' },
					},
				],
			}),
		).toMatchObject({ ok: true })
	})
	it('blocks an active redirect source but does not rewrite an existing redirect destination', () => {
		expect(
			plan({
				redirects: [redirect('redirect-1', '/blog/alpha', '/elsewhere')],
			}),
		).toMatchObject({
			ok: false,
			reason: 'redirect-conflict',
			redirect: { reason: 'target-is-redirect', recordId: 'redirect-1' },
		})
		expect(
			plan({ redirects: [redirect('alias', '/old-alpha', '/blog/alpha')] }),
		).toMatchObject({
			ok: true,
			value: { redirects: { creates: [], updates: [] } },
		})
	})
	it('allows an inactive redirect record at a new page URL', () => {
		expect(
			plan({
				redirects: [
					{
						...redirect('retired', '/blog/alpha', '/elsewhere'),
						enabled: false,
					},
				],
			}),
		).toMatchObject({ ok: true })
	})
	it('blocks a pending redirect draft or release that touches the new URL', () => {
		for (const id of ['drafts.redirect-1', 'versions.launch.redirect-1'])
			expect(
				plan({ redirects: [redirect(id, '/blog/alpha', '/elsewhere')] }),
			).toMatchObject({
				ok: false,
				reason: 'redirect-conflict',
				redirect: { reason: 'pending-redirect-change', recordId: id },
			})
	})
	it('leaves unrelated redirect drafts alone', () => {
		expect(
			plan({
				redirects: [
					redirect('drafts.unrelated-alias', '/old-index', '/insights'),
				],
			}),
		).toMatchObject({
			ok: true,
			value: { redirects: { creates: [], updates: [] } },
		})
	})
	it('refuses malformed active redirect data instead of skipping it', () => {
		expect(plan({ redirects: [{ ...redirect(), status: 500 }] })).toMatchObject(
			{
				ok: false,
				reason: 'redirect-conflict',
				redirect: {
					reason: 'invalid-before-snapshot',
					snapshotReason: 'unsupported-status',
				},
			},
		)
	})
	it('blocks affected item releases and settings releases without discarding them', () => {
		expect(
			plan({
				documents: [...inventory().documents, post('versions.launch.post-1')],
			}),
		).toMatchObject({
			ok: false,
			reason: 'release-version',
			documentId: 'versions.launch.post-1',
		})
		expect(
			plan({
				settings: [
					firstSettings(),
					setting('versions.launch.journal-settings'),
				],
			}),
		).toMatchObject({
			ok: false,
			reason: 'release-version',
			documentId: 'versions.launch.journal-settings',
		})
	})
	it('does not treat an existing prefix change or locked prefix as first activation', () => {
		expect(plan({ settings: [setting(), firstSettings()] })).toMatchObject({
			ok: false,
			reason: 'not-first-activation',
		})
		const locked = createCollectionSettingsActivationPlanner({
			...configuration,
			collections: [
				{ ...configuration.collections![0]!, routePrefix: '/journal' },
			],
		})
		expect(locked.plan(choice, inventory())).toMatchObject({
			ok: false,
			reason: 'not-first-activation',
		})
	})
	it('requires the reviewed draft revision and an actual valid settings draft', () => {
		expect(
			planner.plan({ ...choice, draftRevision: 'old' }, inventory()),
		).toMatchObject({ ok: false, reason: 'review-stale' })
		expect(plan({ settings: [] })).toMatchObject({
			ok: false,
			reason: 'settings-invalid',
			classificationFailure: { reason: 'missing-draft' },
		})
		expect(
			plan({ settings: [{ ...firstSettings(), _type: 'wrong' }] }),
		).toMatchObject({ ok: false, reason: 'settings-invalid' })
	})
	it.each([
		{ complete: false },
		{ readAccess: 'unknown' },
		{ perspective: 'published' },
		{ settings: undefined },
		{ documents: undefined },
		{ redirects: undefined },
	])('refuses incomplete or unverified inventory (%j)', (patch) => {
		expect(
			planner.plan(choice, {
				...inventory(),
				...patch,
			} as CollectionPrefixInventory),
		).toMatchObject({ ok: false, reason: 'incomplete-inventory' })
	})
	it('refuses duplicate identities, unregistered types, incorrect raw identities and schema mismatches', () => {
		for (const documents of [
			[post(), post()],
			[{ ...post(), _type: 'unregistered' }],
			[{ ...post(), _originalId: 'another-id' }],
			[post(), page('drafts.post-1', '/unrelated')],
		])
			expect(plan({ documents })).toMatchObject({
				ok: false,
				reason: 'invalid-inventory',
			})
		expect(
			plan({ settings: [firstSettings(), setting('unregistered-settings')] }),
		).toMatchObject({ ok: false, reason: 'invalid-inventory' })
	})
	it('refuses invalid item slugs rather than normalizing them', () => {
		expect(plan({ documents: [post('post-1', 'nested/slug')] })).toMatchObject({
			ok: false,
			reason: 'invalid-url',
			documentId: 'post-1',
		})
	})
	it('bounds counts, complete inventory bytes, and affected versions', () => {
		expect(
			plan({
				documents: Array(COLLECTION_PREFIX_LIMITS.pageVersions + 1).fill(null),
			}),
		).toMatchObject({ ok: false, reason: 'limit-exceeded' })
		expect(
			plan({
				settings: Array(COLLECTION_PREFIX_LIMITS.settingsVersions + 1).fill(
					null,
				),
			}),
		).toMatchObject({ ok: false, reason: 'limit-exceeded' })
		expect(
			plan({ redirects: Array(REDIRECT_MAX_RECORDS + 1).fill(null) }),
		).toMatchObject({ ok: false, reason: 'limit-exceeded' })
		expect(
			plan({
				documents: [
					{
						...post(),
						title: 'x'.repeat(COLLECTION_PREFIX_LIMITS.inventoryBytes),
					},
				],
			}),
		).toMatchObject({ ok: false, reason: 'limit-exceeded' })
		expect(
			plan({
				documents: Array.from(
					{ length: COLLECTION_PREFIX_LIMITS.affectedVersions + 1 },
					(_, index) => post(`post-${index}`, `slug-${index}`),
				),
			}),
		).toMatchObject({ ok: false, reason: 'limit-exceeded' })
	})
	it('exposes required read coverage and keeps configuration captured', () => {
		expect(planner.readRequirements).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ key: 'versions:post' }),
				expect.objectContaining({ key: 'versions:sanityKitRedirect' }),
				expect.objectContaining({
					key: 'settings:exact',
					ids: ['drafts.journal-settings', 'journal-settings'],
				}),
			]),
		)
		const config = structuredClone(configuration)
		const captured = createCollectionSettingsActivationPlanner(config)
		Object.assign(config.collections![0]!, { routePrefix: '/later' })
		expect(captured.plan(choice, inventory())).toMatchObject({
			ok: true,
			value: { prefix: '/blog' },
		})
	})
})
