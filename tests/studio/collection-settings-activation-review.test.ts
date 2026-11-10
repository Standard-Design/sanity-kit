import { evaluate, parse } from 'groq-js'
import { describe, expect, it, vi } from 'vitest'
import {
	createCollectionSettingsActivationReviewer,
	type CollectionSettingsActivationReview,
} from '../../src/studio/collections/settings-activation-review.js'
import type { CollectionPrefixReadAccessRequest } from '../../src/studio/collections/prefix-review.js'
import type { CollectionPrefixAccessDecision } from '../../src/studio/collections/prefix-access.js'
import { COLLECTION_PREFIX_LIMITS } from '../../src/studio/collections/prefix-plan.js'
import { REDIRECT_MAX_RECORDS } from '../../src/redirect/snapshot.js'
import type { CollectionRoutingConfig } from '../../src/url/settings/resolve.js'
import {
	configuration,
	page,
	post,
	redirect,
	setting,
} from './collection-prefix-fixtures.js'

const choice = { collection: 'journal', draftRevision: 'draft-settings' }
const withProducts: CollectionRoutingConfig = {
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
}

function setup(config: CollectionRoutingConfig = configuration) {
	const rows: Record<string, unknown>[] = [
		setting('drafts.journal-settings', '/blog', 'draft-settings'),
		post(),
		page('index', '/insights'),
	]
	const confirmReadAccess = vi.fn(
		(
			request: CollectionPrefixReadAccessRequest,
			signal?: AbortSignal,
		): Promise<readonly CollectionPrefixAccessDecision[]> => {
			void signal
			return Promise.resolve(
				request.requirements.map(({ key }) => ({
					key,
					status: 'granted' as const,
				})),
			)
		},
	)
	const fetch = vi.fn(
		async (
			query: string,
			params: Record<string, unknown>,
			options?: unknown,
		): Promise<unknown> => {
			void options
			return (
				await evaluate(parse(query), { dataset: rows, params })
			).get() as Promise<unknown>
		},
	)
	const client = {
		withConfig: vi.fn(() => ({
			config: () => ({ projectId: 'proof', dataset: 'development' }),
			fetch,
		})),
	}
	const reviewer = createCollectionSettingsActivationReviewer(config, client, {
		confirmReadAccess,
	})
	return { rows, fetch, confirmReadAccess, client, reviewer }
}

async function ready(test: ReturnType<typeof setup>) {
	const result = await test.reviewer.review(choice)
	if (result.status !== 'ready') throw new Error(JSON.stringify(result))
	return result.review
}

describe('collection settings activation read and recheck', () => {
	it('loads bounded raw evidence without cache or retry and verifies access on both sides', async () => {
		const test = setup()
		const review = await ready(test)
		expect(review).toMatchObject({
			projectId: 'proof',
			dataset: 'development',
			plan: {
				liveUrls: [{ id: 'post-1', pathname: '/blog/alpha' }],
				absentSettingsIds: ['journal-settings'],
				redirects: { creates: [], updates: [] },
			},
		})
		expect(test.confirmReadAccess).toHaveBeenCalledTimes(2)
		expect(test.client.withConfig).toHaveBeenCalledWith({
			apiVersion: '2026-10-01',
			perspective: 'raw',
			useCdn: false,
			stega: false,
			maxRetries: 0,
		})
		expect(test.fetch.mock.calls[0]![2]).toMatchObject({
			perspective: 'raw',
			useCdn: false,
			stega: false,
			filterResponse: true,
			cache: 'no-store',
			next: undefined,
		})
		expect(test.fetch.mock.calls[0]![0]).not.toContain('body')
		expect(Object.keys(test.reviewer)).toEqual(['review', 'recheck'])
		expect(Object.isFrozen(review)).toBe(true)
		expect(Object.isFrozen(review.plan)).toBe(true)
		expect(await test.reviewer.recheck(review)).toEqual({ status: 'current' })
		expect(test.fetch).toHaveBeenCalledTimes(2)
		expect(test.confirmReadAccess).toHaveBeenCalledTimes(4)
	})
	it.each(['missing', 'unverified', 'partial'] as const)(
		'does not query when access evidence is %s',
		async (status) => {
			const test = setup()
			test.confirmReadAccess.mockImplementation((request) =>
				Promise.resolve(
					status === 'partial'
						? []
						: request.requirements.map(({ key }) => ({ key, status })),
				),
			)
			const result = await test.reviewer.review(choice)
			expect(result).toMatchObject({
				status: 'blocked',
				reason: 'unknown-read-access',
			})
			if (result.status !== 'blocked') throw new Error('Expected access block')
			expect(result.accessIssues).toContainEqual(
				expect.objectContaining({
					status: status === 'partial' ? 'unverified' : status,
				}),
			)
			expect(test.fetch).not.toHaveBeenCalled()
		},
	)
	it('does not trust filtered settings absence when exact identity or release access was omitted', async () => {
		const test = setup()
		test.confirmReadAccess.mockImplementation((request) =>
			Promise.resolve(
				request.requirements
					.filter(
						({ key }) =>
							key !== 'settings:exact' && key !== 'settings:releases',
					)
					.map(({ key }) => ({ key, status: 'granted' as const })),
			),
		)
		expect(await test.reviewer.review(choice)).toMatchObject({
			status: 'blocked',
			reason: 'unknown-read-access',
			accessIssues: [
				expect.objectContaining({ key: 'settings:exact' }),
				expect.objectContaining({ key: 'settings:releases' }),
			],
		})
		expect(test.fetch).not.toHaveBeenCalled()
	})
	it('rejects access lost between the inventory read and accepting the review', async () => {
		const test = setup()
		test.confirmReadAccess
			.mockImplementationOnce((request) =>
				Promise.resolve(
					request.requirements.map(({ key }) => ({
						key,
						status: 'granted' as const,
					})),
				),
			)
			.mockResolvedValue([])
		expect(await test.reviewer.review(choice)).toMatchObject({
			status: 'blocked',
			reason: 'unknown-read-access',
		})
		expect(test.fetch).toHaveBeenCalledOnce()
	})
	it('rechecks permission scopes instead of retaining earlier access', async () => {
		const test = setup()
		const review = await ready(test)
		test.confirmReadAccess.mockResolvedValue([])
		expect(await test.reviewer.recheck(review)).toMatchObject({
			status: 'blocked',
			reason: 'unknown-read-access',
		})
		expect(test.fetch).toHaveBeenCalledOnce()
	})
	it.each([
		null,
		{ settings: [], documents: [] },
		{ settings: [], documents: 'not-an-array', redirects: [] },
		{
			settings: [],
			documents: [{ _type: 'post', value: 'alpha' }],
			redirects: [],
		},
		{
			settings: [],
			documents: [{ _type: 'unregistered', value: 'alpha', title: 'Post' }],
			redirects: [],
		},
	])('rejects malformed query results (%j)', async (response) => {
		const test = setup()
		test.fetch.mockResolvedValueOnce(response)
		expect(await test.reviewer.review(choice)).toEqual({
			status: 'blocked',
			reason: 'invalid-response',
		})
	})
	it('does not turn a failed query into an empty successful activation', async () => {
		const test = setup()
		test.fetch.mockRejectedValueOnce(new Error('Connection lost'))
		expect(await test.reviewer.review(choice)).toEqual({
			status: 'blocked',
			reason: 'request-failed',
		})
	})
	it.each(['settings', 'documents', 'redirects'] as const)(
		'detects query truncation in %s using the extra returned row',
		async (kind) => {
			const test = setup()
			if (kind === 'settings')
				test.rows.push(
					...Array.from(
						{ length: COLLECTION_PREFIX_LIMITS.settingsVersions },
						(_, index) => setting(`versions.release-${index}.journal-settings`),
					),
				)
			if (kind === 'documents')
				test.rows.push(
					...Array.from(
						{ length: COLLECTION_PREFIX_LIMITS.pageVersions },
						(_, index) => page(`page-${index}`, `/page-${index}`),
					),
				)
			if (kind === 'redirects')
				test.rows.push(
					...Array.from({ length: REDIRECT_MAX_RECORDS + 1 }, (_, index) => ({
						...redirect(`redirect-${index}`, `/old-${index}`, '/insights'),
						enabled: false,
					})),
				)
			expect(await test.reviewer.review(choice)).toEqual({
				status: 'blocked',
				reason: 'limit-exceeded',
			})
			expect(test.fetch).toHaveBeenCalledOnce()
		},
	)
	it('bounds projected byte size before interpreting the returned document fields', async () => {
		const test = setup()
		test.rows[1]!.title = 'x'.repeat(COLLECTION_PREFIX_LIMITS.inventoryBytes)
		expect(await test.reviewer.review(choice)).toEqual({
			status: 'blocked',
			reason: 'limit-exceeded',
		})
	})
	it('reads wrong-type settings and releases by identity instead of hiding them', async () => {
		for (const id of ['journal-settings', 'versions.launch.journal-settings']) {
			const test = setup()
			test.rows.push({ ...setting(id), _type: 'wrongType' })
			expect(await test.reviewer.review(choice)).toMatchObject({
				status: 'blocked',
				reason: id.startsWith('versions.')
					? 'release-version'
					: 'settings-invalid',
			})
		}
	})
	it('reconstructs configured nested URL/title fields without reading full documents', async () => {
		const config: CollectionRoutingConfig = {
			...configuration,
			collections: [
				{
					...configuration.collections![0]!,
					items: [
						{
							schemaType: 'post',
							slugField: 'routing.slug.current',
							titleField: 'content.heading',
						},
					],
				},
			],
		}
		const test = setup(config)
		test.rows[1] = {
			...post(),
			routing: { slug: { current: 'nested-field' } },
			content: { heading: 'Nested title' },
		}
		expect((await ready(test)).plan.liveUrls).toMatchObject([
			{ pathname: '/blog/nested-field', title: 'Nested title' },
		])
	})
	it.each([
		'item',
		'page',
		'redirect',
		'settings-draft',
		'settings-published',
	] as const)(
		'invalidates newly appeared %s identities even without a collision',
		async (kind) => {
			const test = setup(withProducts)
			const review = await ready(test)
			if (kind === 'item') test.rows.push(post('post-2', 'beta'))
			if (kind === 'page') test.rows.push(page('page-2', '/new-page'))
			if (kind === 'redirect')
				test.rows.push(redirect('new-alias', '/old-index', '/insights'))
			if (kind === 'settings-draft')
				test.rows.push(
					setting('drafts.product-settings', '/shop', 'p-draft', 'products'),
				)
			if (kind === 'settings-published')
				test.rows.push(
					setting('product-settings', '/shop', 'p-live', 'products'),
				)
			expect(await test.reviewer.recheck(review)).toEqual({
				status: 'blocked',
				reason: 'review-stale',
			})
		},
	)
	it('rejects a target setting published after the review rather than activating it again', async () => {
		const test = setup()
		const review = await ready(test)
		test.rows.push(setting('journal-settings', '/blog'))
		expect(await test.reviewer.recheck(review)).toMatchObject({
			status: 'blocked',
			reason: 'not-first-activation',
		})
	})
	it.each(['revision', 'removed'] as const)(
		'invalidates a %s dependency even when the target URLs stay the same',
		async (kind) => {
			const test = setup()
			const review = await ready(test)
			const index = test.rows.findIndex((row) => row._id === 'index')
			if (kind === 'revision') test.rows[index]!._rev = 'changed-index'
			else test.rows.splice(index, 1)
			expect(await test.reviewer.recheck(review)).toEqual({
				status: 'blocked',
				reason: 'review-stale',
			})
		},
	)
	it.each(['collision', 'release'] as const)(
		'reports a newly discovered %s during recheck',
		async (kind) => {
			const test = setup()
			const review = await ready(test)
			test.rows.push(
				kind === 'collision'
					? page('other-page', '/blog/alpha')
					: post('versions.launch.post-1'),
			)
			expect(await test.reviewer.recheck(review)).toMatchObject({
				status: 'blocked',
				reason: kind === 'collision' ? 'url-collision' : 'release-version',
			})
		},
	)
	it('rejects copied, foreign, and fabricated reviews before loading anything', async () => {
		const test = setup()
		const review = await ready(test)
		const foreign = setup()
		for (const value of [
			structuredClone(review),
			{} as CollectionSettingsActivationReview,
		])
			expect(await test.reviewer.recheck(value)).toEqual({
				status: 'blocked',
				reason: 'invalid-review',
			})
		expect(await foreign.reviewer.recheck(review)).toEqual({
			status: 'blocked',
			reason: 'invalid-review',
		})
		expect(test.fetch).toHaveBeenCalledOnce()
		expect(foreign.fetch).not.toHaveBeenCalled()
	})
	it('captures the requested collection and revision before asynchronous access work', async () => {
		const test = setup()
		const mutableChoice = { ...choice }
		const original = test.confirmReadAccess.getMockImplementation()!
		test.confirmReadAccess.mockImplementation(async (...args) => {
			mutableChoice.collection = 'different'
			mutableChoice.draftRevision = 'different'
			return original(...args)
		})
		expect(await test.reviewer.review(mutableChoice)).toMatchObject({
			status: 'ready',
			review: {
				plan: { collection: 'journal', draftRevision: 'draft-settings' },
			},
		})
	})
	it.each(['before', 'access-before', 'fetch', 'access-after'] as const)(
		'discards cancelled work at %s even when adapters ignore the signal',
		async (stage) => {
			const test = setup()
			const abort = new AbortController()
			if (stage === 'before') abort.abort()
			const accessOriginal = test.confirmReadAccess.getMockImplementation()!
			let count = 0
			test.confirmReadAccess.mockImplementation(async (...args) => {
				count += 1
				if (
					(stage === 'access-before' && count === 1) ||
					(stage === 'access-after' && count === 2)
				)
					abort.abort()
				return accessOriginal(...args)
			})
			if (stage === 'fetch') {
				const fetchOriginal = test.fetch.getMockImplementation()!
				test.fetch.mockImplementation(async (...args) => {
					const response = await fetchOriginal(...args)
					abort.abort()
					return response
				})
			}
			expect(await test.reviewer.review(choice, abort.signal)).toEqual({
				status: 'blocked',
				reason: 'aborted',
			})
			if (stage === 'before' || stage === 'access-before')
				expect(test.fetch).not.toHaveBeenCalled()
			else
				expect(test.fetch.mock.calls[0]![2]).toMatchObject({
					signal: abort.signal,
				})
		},
	)
	it('supports cancellation during recheck without treating it as current', async () => {
		const test = setup()
		const review = await ready(test)
		const abort = new AbortController()
		abort.abort()
		expect(await test.reviewer.recheck(review, abort.signal)).toEqual({
			status: 'blocked',
			reason: 'aborted',
		})
		expect(test.fetch).toHaveBeenCalledOnce()
	})
})
