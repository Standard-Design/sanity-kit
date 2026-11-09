import { evaluate, parse } from 'groq-js'
import { describe, it, expect, vi } from 'vitest'
import {
	createCollectionPrefixReviewer,
	type CollectionPrefixReadAccessRequest,
} from '../../src/studio/collections/prefix-review.js'
import {
	createCollectionPrefixReadRequirements,
	verifyCollectionPrefixReadAccess,
	type CollectionPrefixAccessDecision,
} from '../../src/studio/collections/prefix-access.js'
import {
	configuration,
	choice,
	inventory,
	setting,
	post,
	page,
} from './collection-prefix-fixtures.js'
function setup() {
	const input = inventory()
	const rows = structuredClone([
		...input.settings,
		...input.documents,
		...input.redirects,
	]) as Record<string, unknown>[]
	let accessHook:
		| ((
				call: number,
				requirements: CollectionPrefixReadAccessRequest,
		  ) => readonly CollectionPrefixAccessDecision[])
		| undefined
	let reads = 0
	const confirmReadAccess = vi.fn(
		(request: CollectionPrefixReadAccessRequest) =>
			Promise.resolve(
				accessHook
					? accessHook(++reads, request)
					: request.requirements.map(({ key }) => ({
							key,
							status: 'granted' as const,
						})),
			),
	)
	const fetch = vi.fn(
		async (
			query: string,
			params: Record<string, unknown>,
			_options?: unknown,
		) => {
			void _options
			return (
				await evaluate(parse(query), { dataset: rows, params })
			).get() as Promise<unknown>
		},
	)
	const source = {
		config: () => ({ projectId: 'proof', dataset: 'development' }),
		fetch,
	}
	const client = { withConfig: vi.fn(() => source) }
	return {
		rows,
		fetch,
		client,
		confirmReadAccess,
		setAccessHook: (hook: typeof accessHook) => {
			accessHook = hook
		},
		reviewer: createCollectionPrefixReviewer(configuration, client, {
			confirmReadAccess,
		}),
	}
}
describe('collection-prefix read access contract', () => {
	const requirements = createCollectionPrefixReadRequirements(configuration)
	const grants = requirements.map(({ key }) => ({
		key,
		status: 'granted' as const,
	}))
	it('distinguishes inventories from exact settings and unrestricted release-identity coverage', () => {
		expect(requirements).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: 'type-versions',
					schemaType: 'post',
					versions: ['published', 'drafts', 'releases'],
				}),
				expect.objectContaining({
					kind: 'type-versions',
					schemaType: 'sanityKitRedirect',
					versions: ['published', 'drafts', 'releases'],
				}),
				expect.objectContaining({
					kind: 'exact-identities',
					ids: ['drafts.journal-settings', 'journal-settings'],
					regardlessOfType: true,
				}),
				expect.objectContaining({
					kind: 'settings-release-identities',
					publishedIds: ['journal-settings'],
					regardlessOfType: true,
				}),
			]),
		)
	})
	it.each([
		undefined,
		[],
		[grants[0]],
		grants.filter((item) => item.key !== 'settings:releases'),
		[...grants, grants[0]],
		true,
	])(
		'does not interpret incomplete/duplicate/malformed access answers as permission: %o',
		(answer) => {
			expect(verifyCollectionPrefixReadAccess(requirements, answer).ok).toBe(
				false,
			)
		},
	)
	it('reports missing access separately from unverified access', () => {
		const result = verifyCollectionPrefixReadAccess(
			requirements,
			grants.map((item) =>
				item.key === 'settings:releases'
					? { ...item, status: 'missing' }
					: item,
			),
		)
		expect(result).toMatchObject({
			ok: false,
			issues: [{ key: 'settings:releases', status: 'missing' }],
		})
		expect(verifyCollectionPrefixReadAccess(requirements, grants)).toEqual({
			ok: true,
			issues: [],
		})
	})
})
describe('read-only collection-prefix reviewer', () => {
	it('reads projected raw inventories without cache, confirms access twice, and never writes', async () => {
		const test = setup()
		const result = await test.reviewer.review(choice)
		if (result.status !== 'ready') throw new Error(JSON.stringify(result))
		expect(result.review).toMatchObject({
			projectId: 'proof',
			dataset: 'development',
			plan: {
				liveChanges: [
					{ oldPathname: '/journal/alpha', newPathname: '/blog/alpha' },
				],
			},
		})
		expect(test.confirmReadAccess).toHaveBeenCalledTimes(2)
		expect(test.client.withConfig).toHaveBeenCalledWith(
			expect.objectContaining({
				perspective: 'raw',
				useCdn: false,
				stega: false,
				maxRetries: 0,
			}),
		)
		expect(test.fetch.mock.calls[0]).toHaveLength(3)
		expect(test.fetch.mock.calls[0]?.[2]).toMatchObject({
			perspective: 'raw',
			cache: 'no-store',
			next: undefined,
			stega: false,
			useCdn: false,
		})
		expect(test.fetch.mock.calls[0]?.[0]).not.toContain('body')
		expect(await test.reviewer.recheck(result.review)).toEqual({
			status: 'current',
		})
		expect(Object.keys(test.reviewer)).toEqual(['review', 'recheck'])
	})
	it('refuses to query without explicit proof of all requested scopes', async () => {
		const test = setup()
		test.setAccessHook(() => [])
		expect(await test.reviewer.review(choice)).toMatchObject({
			status: 'blocked',
			reason: 'unknown-read-access',
		})
		expect(test.fetch).not.toHaveBeenCalled()
	})
	it('does not accept settings-release visibility inferred from the rows it happened to see', async () => {
		const test = setup()
		test.setAccessHook((_call, request) =>
			request.requirements
				.filter((item) => item.key !== 'settings:releases')
				.map(({ key }) => ({ key, status: 'granted' })),
		)
		expect(await test.reviewer.review(choice)).toMatchObject({
			status: 'blocked',
			reason: 'unknown-read-access',
			accessIssues: [{ key: 'settings:releases', status: 'unverified' }],
		})
		expect(test.fetch).not.toHaveBeenCalled()
	})
	it('refuses a review if access is lost after its inventory query', async () => {
		const test = setup()
		test.setAccessHook((call, request) =>
			call === 1
				? request.requirements.map(({ key }) => ({ key, status: 'granted' }))
				: [],
		)
		expect(await test.reviewer.review(choice)).toMatchObject({
			status: 'blocked',
			reason: 'unknown-read-access',
		})
		expect(test.fetch).toHaveBeenCalledOnce()
	})
	it('does not treat failed queries or invalid envelopes as empty inventories', async () => {
		const test = setup()
		test.fetch.mockRejectedValueOnce(new Error('network'))
		expect(await test.reviewer.review(choice)).toEqual({
			status: 'blocked',
			reason: 'request-failed',
		})
		test.fetch.mockResolvedValueOnce({ settings: [], documents: [] })
		expect(await test.reviewer.review(choice)).toEqual({
			status: 'blocked',
			reason: 'invalid-response',
		})
	})
	it('returns explicit first-publication unsupported without a published setting', async () => {
		const test = setup()
		test.rows.splice(
			test.rows.findIndex((row) => row._id === 'journal-settings'),
			1,
		)
		expect(await test.reviewer.review(choice)).toMatchObject({
			status: 'blocked',
			reason: 'first-publication-unsupported',
		})
	})
	it('finds malformed settings release types by identity instead of hiding them behind a type filter', async () => {
		const test = setup()
		test.rows.push({
			...setting('versions.launch.journal-settings'),
			_type: 'wrongType',
		})
		expect(await test.reviewer.review(choice)).toMatchObject({
			status: 'blocked',
			reason: 'release-version',
			planFailure: { documentId: 'versions.launch.journal-settings' },
		})
	})
	it.each(['draft', 'release'])(
		'rejects a new %s version discovered while rechecking',
		async (version) => {
			const test = setup()
			const result = await test.reviewer.review(choice)
			if (result.status !== 'ready') throw new Error(JSON.stringify(result))
			test.rows.push(
				version === 'draft'
					? page('drafts.new', '/blog/alpha')
					: post('versions.release-a.post-1'),
			)
			expect(await test.reviewer.recheck(result.review)).toMatchObject({
				status: 'blocked',
				reason: version === 'draft' ? 'url-collision' : 'release-version',
			})
		},
	)
	it('invalidates unchanged dependencies when a reviewed revision changes', async () => {
		const test = setup()
		const result = await test.reviewer.review(choice)
		if (result.status !== 'ready') throw new Error(JSON.stringify(result))
		test.rows.find((row) => row._id === 'index')!._rev = 'new-index-revision'
		expect(await test.reviewer.recheck(result.review)).toEqual({
			status: 'blocked',
			reason: 'review-stale',
		})
	})
	it('does not accept reconstructed or another service instance’s reviews', async () => {
		const test = setup()
		const result = await test.reviewer.review(choice)
		if (result.status !== 'ready') throw new Error(JSON.stringify(result))
		expect(await test.reviewer.recheck(structuredClone(result.review))).toEqual(
			{ status: 'blocked', reason: 'invalid-review' },
		)
		expect(await setup().reviewer.recheck(result.review)).toEqual({
			status: 'blocked',
			reason: 'invalid-review',
		})
	})
	it('discards late data after cancellation even if an adapter ignores the signal', async () => {
		const test = setup()
		const controller = new AbortController()
		test.setAccessHook((_call, request) => {
			controller.abort()
			return request.requirements.map(({ key }) => ({ key, status: 'granted' }))
		})
		expect(await test.reviewer.review(choice, controller.signal)).toEqual({
			status: 'blocked',
			reason: 'aborted',
		})
		expect(test.fetch).not.toHaveBeenCalled()
	})
})
