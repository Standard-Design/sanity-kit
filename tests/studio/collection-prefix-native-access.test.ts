import { evaluate, parse } from 'groq-js'
import { createCollectionPrefixReviewer } from '../../src/studio/collections/prefix-review.js'
import { createClient, type ClientConfig } from '@sanity/client'
import { describe, expect, it, vi } from 'vitest'
import {
	createNativeCollectionPrefixReadAccess,
	checkCollectionPrefixReceiptReadAccess,
} from '../../src/studio/collections/prefix-native-access.js'
import { createCollectionPrefixReadRequirements } from '../../src/studio/collections/prefix-access.js'
import {
	checkDocumentTypeReadAccess,
	checkRoutingSettingsReleaseReadAccess,
	checkUrlReadAccess,
} from '../../src/studio/url/access.js'
import {
	configuration,
	inventory,
	choice,
} from './collection-prefix-fixtures.js'

const read = (filter: string) => ({ filter, permissions: ['read'] })
const request = {
	projectId: 'proof',
	dataset: 'development',
	requirements: createCollectionPrefixReadRequirements(configuration),
}
const scopedGrants = [
	read('_type in ["page", "post", "sanityKitRedirect"]'),
	read('_id in ["journal-settings", "drafts.journal-settings"]'),
	read('_id in path("versions.*.journal-settings")'),
]
function setup(grants: unknown = scopedGrants) {
	const scope = { projectId: 'proof', dataset: 'development' }
	const requestAcl = vi.fn(() => Promise.resolve(grants))
	const source = { config: () => scope, request: requestAcl }
	const client = { withConfig: vi.fn(() => source) }
	return {
		scope,
		client,
		requestAcl,
		confirm: createNativeCollectionPrefixReadAccess(client),
	}
}

describe('native collection-prefix read access', () => {
	it('accepts scoped custom grants without role names or content sampling', async () => {
		const test = setup()
		expect(await test.confirm(request)).toEqual(
			request.requirements.map(({ key }) => ({ key, status: 'granted' })),
		)
		expect(test.client.withConfig).toHaveBeenCalledWith({
			apiVersion: '2026-10-01',
			perspective: 'raw',
			useCdn: false,
			stega: false,
			maxRetries: 0,
		})
		expect(test.requestAcl).toHaveBeenCalledWith({
			url: '/projects/proof/datasets/development/acl',
			method: 'GET',
			tag: 'sanity-kit.collection-prefix-access',
			fetch: { cache: 'no-store', next: undefined },
		})
	})

	it.each(['true', '_id in path("**")'])(
		'accepts effective blanket read grants: %s',
		async (filter) => {
			expect(
				(await setup([read(filter)]).confirm(request)).every(
					(item) => item.status === 'granted',
				),
			).toBe(true)
		},
	)

	it('distinguishes absent grants from unknown filters or malformed ACL data', async () => {
		expect(
			(await setup([]).confirm(request)).every(
				(item) => item.status === 'missing',
			),
		).toBe(true)
		for (const grants of [
			null,
			{},
			[read('owner == identity()')],
			[{ filter: 'true', permissions: [42] }],
		]) {
			expect(
				(await setup(grants).confirm(request)).every(
					(item) => item.status === 'unverified',
				),
			).toBe(true)
		}
	})

	it('requires all three versions and marks a definitely missing version as missing', async () => {
		const grants = [read('!(_id in path("versions.**"))')]
		const decisions = await setup(grants).confirm(request)
		expect(decisions).toContainEqual({
			key: 'versions:post',
			status: 'missing',
		})
		expect(decisions).toContainEqual({
			key: 'settings:exact',
			status: 'granted',
		})
		expect(decisions).toContainEqual({
			key: 'settings:releases',
			status: 'missing',
		})
	})

	it('does not mistake a type-only settings grant for malformed-identity coverage', async () => {
		const decisions = await setup([
			read(
				'_type in ["page", "post", "sanityKitRedirect", "sanityKitCollectionRoute"]',
			),
		]).confirm(request)
		expect(decisions).toContainEqual({
			key: 'settings:exact',
			status: 'unverified',
		})
		expect(decisions).toContainEqual({
			key: 'settings:releases',
			status: 'unverified',
		})
	})

	it('does not prove every release from a grant for one named release', async () => {
		const decisions = await setup([
			...scopedGrants.slice(0, 2),
			read('_id in path("versions.spring.journal-settings")'),
		]).confirm(request)
		expect(decisions).toContainEqual({
			key: 'settings:releases',
			status: 'unverified',
		})
	})

	it('fetches grants again and notices revoked permissions', async () => {
		const test = setup()
		await test.confirm(request)
		test.requestAcl.mockResolvedValue([])
		expect(
			(await test.confirm(request)).every((item) => item.status === 'missing'),
		).toBe(true)
		expect(test.requestAcl).toHaveBeenCalledTimes(2)
	})

	it('cannot reuse access proof for another project, dataset, or changed source configuration', async () => {
		const test = setup()
		for (const altered of [
			{ ...request, projectId: 'other' },
			{ ...request, dataset: 'other' },
		]) {
			expect(
				(await test.confirm(altered)).every(
					(item) => item.status === 'unverified',
				),
			).toBe(true)
		}
		test.scope.dataset = 'other'
		expect(
			(await test.confirm(request)).every(
				(item) => item.status === 'unverified',
			),
		).toBe(true)
		expect(test.requestAcl).not.toHaveBeenCalled()
	})

	it('propagates connection failures without inventing a permission denial', async () => {
		const test = setup()
		test.requestAcl.mockRejectedValue(new Error('connection failed'))
		await expect(test.confirm(request)).rejects.toThrow('connection failed')
	})

	it('honors abort before and after an ACL response', async () => {
		const test = setup()
		const already = AbortSignal.abort()
		await expect(test.confirm(request, already)).rejects.toMatchObject({
			name: 'AbortError',
		})
		expect(test.requestAcl).not.toHaveBeenCalled()
		const controller = new AbortController()
		test.requestAcl.mockImplementationOnce(() => {
			controller.abort()
			return Promise.resolve(scopedGrants)
		})
		await expect(
			test.confirm(request, controller.signal),
		).rejects.toMatchObject({ name: 'AbortError' })
	})

	it('uses the real SDK ACL transport with no-store instead of inherited caching', async () => {
		const fetch = vi.fn((_input: unknown, _init?: RequestInit) => {
			void _input
			void _init
			return Promise.resolve(Response.json(scopedGrants))
		})
		const client = createClient({
			projectId: 'proof',
			dataset: 'development',
			apiVersion: '2025-01-01',
			useCdn: true,
			fetch: {
				cache: 'force-cache',
				next: { revalidate: 3600 },
			} as unknown as NonNullable<ClientConfig['fetch']>,
			resolveFetch: () => fetch,
		})
		const confirm = createNativeCollectionPrefixReadAccess(client)
		expect(
			(await confirm(request)).every((item) => item.status === 'granted'),
		).toBe(true)
		expect(fetch).toHaveBeenCalledOnce()
		expect(String(fetch.mock.calls[0]![0])).toContain(
			'/v2026-10-01/projects/proof/datasets/development/acl',
		)
		expect(fetch.mock.calls[0]![1]).toMatchObject({ cache: 'no-store' })
		expect(client.config().apiVersion).toBe('2025-01-01')
	})
})

describe('shared version-scope grant interpretation', () => {
	it('combines distinct version grants in the same way as URL editing', () => {
		const grants = [
			read(
				'_type == "page" && !(_id in path("drafts.**")) && !(_id in path("versions.**"))',
			),
			read('_type == "page" && _id in path("drafts.**")'),
			read('_type == "page" && _id in path("versions.**")'),
		]
		expect(checkDocumentTypeReadAccess('page', grants)).toEqual({
			ok: true,
			issues: [],
		})
		expect(
			checkUrlReadAccess(
				{ pages: configuration.pages },
				[...grants, read('_id == "sanityKit.folders"')],
				'edit',
			),
		).toEqual({ ok: true, issues: [] })
	})

	it.each([
		['true', true],
		['_id in path("**")', true],
		['_id in path("versions.**")', true],
		['_id in path("versions.*.journal-settings")', true],
		['_id in path("versions.*.other-settings")', false],
		['_id in path("drafts.**")', false],
		['_id in path("versions.release-a.journal-settings")', false],
		['_type == "sanityKitCollectionRoute"', false],
		[
			'_id in path("versions.*.journal-settings") && _type == "sanityKitCollectionRoute"',
			false,
		],
	] as const)('checks settings release coverage for %s', (filter, expected) => {
		expect(
			checkRoutingSettingsReleaseReadAccess(
				['journal-settings'],
				[read(filter)],
			).ok,
		).toBe(expected)
	})

	it('retains uncertainty when another grant may allow the missing scope', () => {
		const checked = checkRoutingSettingsReleaseReadAccess(
			['journal-settings'],
			[read('_id in path("drafts.**")'), read('owner == identity()')],
		)
		expect(checked.issues).toEqual([
			expect.objectContaining({ status: 'unverified' }),
		])
	})

	it('does not let a release-of-ID grant cover all page release versions', () => {
		const checked = checkDocumentTypeReadAccess('page', [
			read('_id in path("versions.*.journal-settings")'),
		])
		expect(checked.ok).toBe(false)
		expect(checked.issues).toContainEqual(
			expect.objectContaining({ key: 'page:releases', status: 'unverified' }),
		)
	})
})

describe('native access connected to the prefix reviewer', () => {
	it('rechecks native ACL before/after inventories and returns specific requirement failures', async () => {
		const input = inventory()
		const rows = [...input.settings, ...input.documents, ...input.redirects]
		const requestAcl = vi.fn((): Promise<unknown> =>
			Promise.resolve(scopedGrants),
		)
		const fetch = vi.fn(
			async (query: string, params: Record<string, unknown>) =>
				(
					await evaluate(parse(query), { dataset: rows, params })
				).get() as Promise<unknown>,
		)
		const source = {
			config: () => ({ projectId: 'proof', dataset: 'development' }),
			request: requestAcl,
			fetch,
		}
		const client = { withConfig: () => source }
		const reviewer = createCollectionPrefixReviewer(configuration, client, {
			confirmReadAccess: createNativeCollectionPrefixReadAccess(client),
		})
		const result = await reviewer.review(choice)
		expect(result.status).toBe('ready')
		if (result.status !== 'ready')
			throw new Error('Review unexpectedly blocked')
		expect(requestAcl).toHaveBeenCalledTimes(2)
		expect(await reviewer.recheck(result.review)).toEqual({ status: 'current' })
		expect(requestAcl).toHaveBeenCalledTimes(4)
		requestAcl.mockResolvedValue(scopedGrants.slice(0, 2))
		expect(await reviewer.recheck(result.review)).toMatchObject({
			status: 'blocked',
			reason: 'unknown-read-access',
			accessIssues: [{ key: 'settings:releases', status: 'unverified' }],
		})
		expect(fetch).toHaveBeenCalledTimes(2)
		requestAcl.mockRejectedValue(new Error('offline'))
		expect(await reviewer.review(choice)).toEqual({
			status: 'blocked',
			reason: 'request-failed',
		})
	})
})

const receiptId =
	'sanityKit.collectionPrefixPublication.00000000-0000-4000-8000-000000000001'
describe('exact collection-prefix receipt read access', () => {
	it('requires published and draft identities independent of receipt type', async () => {
		const test = setup([read(`_id in ["${receiptId}", "drafts.${receiptId}"]`)])
		expect(
			await checkCollectionPrefixReceiptReadAccess(test.client, receiptId),
		).toEqual({ ok: true, issues: [] })
		test.requestAcl.mockResolvedValue([read(`_id == "${receiptId}"`)])
		expect(
			await checkCollectionPrefixReceiptReadAccess(test.client, receiptId),
		).toMatchObject({
			ok: false,
			issues: [
				{
					key: `collection-prefix-receipt:drafts.${receiptId}`,
					status: 'missing',
				},
			],
		})
	})

	it('does not accept type grants as proof of missing receipt identities', async () => {
		const test = setup([
			read('_type == "sanityKitCollectionPrefixPublication"'),
		])
		const result = await checkCollectionPrefixReceiptReadAccess(
			test.client,
			receiptId,
		)
		expect(result.ok).toBe(false)
		expect(result.issues).toHaveLength(2)
		expect(result.issues.every((issue) => issue.status === 'unverified')).toBe(
			true,
		)
	})

	it('rejects unexpected receipt IDs and supports abort without an ACL request', async () => {
		const test = setup()
		await expect(
			checkCollectionPrefixReceiptReadAccess(test.client, 'other'),
		).rejects.toThrow('generated receipt ID')
		await expect(
			checkCollectionPrefixReceiptReadAccess(
				test.client,
				receiptId,
				AbortSignal.abort(),
			),
		).rejects.toMatchObject({ name: 'AbortError' })
		expect(test.requestAcl).not.toHaveBeenCalled()
	})
})
