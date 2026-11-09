import { describe, it, expect } from 'vitest'
import {
	COLLECTION_PREFIX_LIMITS,
	createCollectionPrefixPlanner,
	type CollectionPrefixInventory,
} from '../../src/studio/collections/prefix-plan.js'
import {
	configuration,
	choice,
	inventory,
	setting,
	post,
	page,
	redirect,
} from './collection-prefix-fixtures.js'
const planner = createCollectionPrefixPlanner(configuration)
const plan = (patch: Partial<CollectionPrefixInventory> = {}) =>
	planner.plan(choice, { ...inventory(), ...patch })
describe('collection-prefix planning', () => {
	it('moves live URLs, preserves slugs and independent index URLs, and retargets existing aliases', () => {
		const input = inventory(),
			original = structuredClone(input)
		const result = planner.plan(choice, input)
		expect(result.ok).toBe(true)
		if (!result.ok) throw new Error(JSON.stringify(result))
		expect(result.value.settings).toMatchObject({
			documentId: 'journal-settings',
			oldPrefix: '/journal',
			newPrefix: '/blog',
		})
		expect(result.value.liveChanges).toEqual([
			{
				id: 'post-1',
				revision: 'revision-post-1',
				schemaType: 'post',
				title: 'First post',
				oldPathname: '/journal/alpha',
				newPathname: '/blog/alpha',
			},
		])
		expect(result.value.draftUrls).toEqual([
			{ id: 'drafts.post-1', pathname: '/blog/draft-title' },
		])
		expect(result.value.redirects.creates).toMatchObject([
			{ source: '/journal/alpha', destination: '/blog/alpha', status: 301 },
		])
		expect(result.value.redirects.updates).toMatchObject([
			{
				id: 'alias',
				source: '/old-alpha',
				oldDestination: '/journal/alpha',
				newDestination: '/blog/alpha',
			},
		])
		expect(result.value.reviewVersions).toEqual(
			expect.arrayContaining([{ id: 'index', revision: 'revision-index' }]),
		)
		expect(input).toEqual(original)
		expect(Object.isFrozen(result.value.liveChanges[0])).toBe(true)
	})
	it('keeps an ordinary index at the old prefix when collection items move', () => {
		const config = {
			...configuration,
			collections: [
				{
					...configuration.collections![0]!,
					index: { schemaType: 'page', pathname: '/journal' },
				},
			],
		}
		const input = {
			...inventory(),
			documents: [post(), page('index', '/journal')],
		}
		const result = createCollectionPrefixPlanner(config).plan(choice, input)
		expect(result).toMatchObject({
			ok: true,
			value: {
				liveChanges: [
					{
						id: 'post-1',
						oldPathname: '/journal/alpha',
						newPathname: '/blog/alpha',
					},
				],
			},
		})
		if (!result.ok) throw new Error(JSON.stringify(result))
		expect(result.value.liveChanges).toHaveLength(1)
		expect(input.documents[1]).toMatchObject({
			pathname: { current: '/journal' },
		})
	})
	it('refuses document versions whose schema types disagree', () => {
		expect(
			plan({ documents: [post(), page('drafts.post-1', '/elsewhere')] }),
		).toMatchObject({
			ok: false,
			reason: 'invalid-inventory',
			documentId: 'drafts.post-1',
		})
	})
	it('updates existing aliases even when new redirects are declined', () => {
		const result = planner.plan(
			{ ...choice, createRedirects: false },
			inventory(),
		)
		expect(result).toMatchObject({
			ok: true,
			value: {
				redirects: {
					creates: [],
					updates: [{ id: 'alias', newDestination: '/blog/alpha' }],
				},
			},
		})
	})
	it('handles repeated prefix changes without introducing redirect chains', () => {
		expect(
			plan({
				settings: [
					setting('journal-settings', '/blog'),
					setting('drafts.journal-settings', '/news', 'draft-settings'),
				],
				redirects: [
					redirect('original', '/journal/alpha', '/blog/alpha'),
					redirect('alias', '/old-alpha', '/blog/alpha'),
				],
			}),
		).toMatchObject({
			ok: true,
			value: {
				redirects: {
					creates: [{ source: '/blog/alpha', destination: '/news/alpha' }],
					updates: [
						{ newDestination: '/news/alpha' },
						{ newDestination: '/news/alpha' },
					],
				},
			},
		})
	})
	it.each(['page-2', 'drafts.page-2', 'versions.release-a.page-2'])(
		'blocks a proposed URL occupied by %s',
		(id) => {
			expect(
				plan({
					documents: [...inventory().documents, page(id, '/blog/alpha')],
				}),
			).toMatchObject({
				ok: false,
				reason: 'url-collision',
				pathname: '/blog/alpha',
			})
		},
	)
	it('checks changed draft item slugs without publishing their content', () => {
		expect(
			plan({
				documents: [
					...inventory().documents,
					page('drafts.other', '/blog/draft-title'),
				],
			}),
		).toMatchObject({
			ok: false,
			reason: 'url-collision',
			pathname: '/blog/draft-title',
		})
	})
	it('does not assume a second collection draft has already vacated its live prefix', () => {
		const config = {
			...configuration,
			collections: [
				...configuration.collections!,
				{
					name: 'news',
					settingsDocumentId: 'news-settings',
					index: { schemaType: 'page', pathname: '/news-index' },
					items: [{ schemaType: 'newsItem', slugField: 'slug.current' }],
				},
			],
		}
		const input = {
			...inventory(),
			settings: [
				setting(),
				setting('drafts.journal-settings', '/news', 'draft-settings'),
				setting('news-settings', '/news', 'news-live', 'news'),
				setting('drafts.news-settings', '/elsewhere', 'news-draft', 'news'),
			],
		}
		expect(
			createCollectionPrefixPlanner(config).plan(choice, input),
		).toMatchObject({ ok: false, reason: 'routing-conflict' })
	})
	it.each(['versions.release-a.post-1', 'versions.release-a.new-post'])(
		'defers release-aware item changes for %s',
		(id) => {
			expect(
				plan({ documents: [...inventory().documents, post(id)] }),
			).toMatchObject({ ok: false, reason: 'release-version', documentId: id })
		},
	)
	it('blocks settings release versions even if their type was written incorrectly', () => {
		const id = 'versions.release-a.journal-settings'
		expect(
			plan({
				settings: [
					...inventory().settings,
					{ ...setting(id, '/future'), _type: 'unexpected' },
				],
			}),
		).toMatchObject({ ok: false, reason: 'release-version', documentId: id })
	})
	it.each(['drafts.alias', 'versions.release-a.alias'])(
		'refuses redirect work with planned changes in %s even on opt-out',
		(id) => {
			expect(
				planner.plan(
					{ ...choice, createRedirects: false },
					{ ...inventory(), redirects: [redirect(), redirect(id)] },
				),
			).toMatchObject({
				ok: false,
				reason: 'redirect-conflict',
				redirect: { reason: 'pending-redirect-change', recordId: id },
			})
		},
	)
	it('refuses an existing redirect at a new live or draft URL', () => {
		expect(
			plan({
				redirects: [
					redirect(),
					redirect('conflict', '/blog/draft-title', '/elsewhere'),
				],
			}),
		).toMatchObject({
			ok: false,
			reason: 'redirect-conflict',
			redirect: { reason: 'target-is-redirect', recordId: 'conflict' },
		})
	})
	it('rejects invalid redirect graphs instead of silently omitting them', () => {
		expect(
			plan({ redirects: [redirect(), redirect('loop', '/self', '/self')] }),
		).toMatchObject({
			ok: false,
			reason: 'redirect-conflict',
			redirect: { reason: 'invalid-before-snapshot' },
		})
	})
	it('does not synthesize a live prefix from a default for first publishing', () => {
		expect(
			plan({
				settings: [
					setting('drafts.journal-settings', '/blog', 'draft-settings'),
				],
			}),
		).toEqual({ ok: false, reason: 'first-publication-unsupported' })
	})
	it('requires a current target settings draft and both reviewed revisions', () => {
		expect(plan({ settings: [setting()] })).toEqual({
			ok: false,
			reason: 'missing-draft',
		})
		expect(
			planner.plan({ ...choice, draftRevision: 'stale' }, inventory()),
		).toEqual({ ok: false, reason: 'review-stale' })
	})
	it('rejects code-owned prefixes and same-prefix settings edits', () => {
		expect(
			createCollectionPrefixPlanner({
				...configuration,
				collections: [
					{ ...configuration.collections![0]!, routePrefix: '/journal' },
				],
			}).plan(choice, inventory()),
		).toEqual({ ok: false, reason: 'locked-prefix' })
		expect(
			plan({
				settings: [
					setting(),
					setting('drafts.journal-settings', '/journal', 'draft-settings'),
				],
			}),
		).toEqual({ ok: false, reason: 'unchanged-prefix' })
	})
	it('respects app-owned prefixes even when a collection is empty', () => {
		expect(
			plan({
				documents: [],
				redirects: [],
				settings: [
					setting(),
					setting('drafts.journal-settings', '/account', 'draft-settings'),
				],
			}),
		).toMatchObject({
			ok: false,
			reason: 'reserved-prefix',
			pathname: '/account',
		})
	})
	it('never cleans malformed stored slugs or paths during review', () => {
		expect(plan({ documents: [post('post-1', 'nested/slug')] })).toMatchObject({
			ok: false,
			reason: 'invalid-url',
			documentId: 'post-1',
		})
		expect(
			plan({
				documents: [...inventory().documents, page('bad', '/about//team')],
			}),
		).toMatchObject({ ok: false, reason: 'invalid-url', documentId: 'bad' })
	})
	it('allows incomplete drafts with no slug without inventing URLs or redirects', () => {
		expect(
			plan({ documents: [post('drafts.empty', null)], redirects: [] }),
		).toMatchObject({
			ok: true,
			value: {
				liveChanges: [],
				draftUrls: [{ id: 'drafts.empty', pathname: null }],
				redirects: { creates: [], updates: [] },
			},
		})
	})
	it.each([
		{ complete: false },
		{ readAccess: 'unknown' as const },
		{ perspective: 'drafts' as never },
	])('requires complete raw version evidence %o', (patch) => {
		expect(plan(patch)).toEqual({ ok: false, reason: 'incomplete-inventory' })
	})
	it('rejects duplicate or merged identities', () => {
		expect(plan({ documents: [post(), post()] })).toEqual({
			ok: false,
			reason: 'invalid-inventory',
		})
		expect(
			plan({ documents: [{ ...post(), _originalId: 'drafts.post-1' }] }),
		).toEqual({ ok: false, reason: 'invalid-inventory' })
	})
	it('bounds the affected versions separately from the complete inventory', () => {
		expect(
			plan({
				documents: Array.from(
					{ length: COLLECTION_PREFIX_LIMITS.affectedVersions + 1 },
					(_, i) => post(`item-${i}`, `slug-${i}`),
				),
				redirects: [],
			}),
		).toMatchObject({ ok: false, reason: 'limit-exceeded' })
	})
	it('counts all inventory versions and review bytes, including unchanged pages', () => {
		expect(
			plan({
				documents: Array.from(
					{ length: COLLECTION_PREFIX_LIMITS.pageVersions + 1 },
					(_, i) => page(`p-${i}`, `/p-${i}`),
				),
			}),
		).toMatchObject({ ok: false, reason: 'limit-exceeded' })
		expect(
			plan({
				documents: [
					post(),
					{
						...page('large', '/outside'),
						_rev: 'x'.repeat(COLLECTION_PREFIX_LIMITS.reviewBytes),
					},
				],
			}),
		).toMatchObject({ ok: false, reason: 'limit-exceeded' })
	})
})
