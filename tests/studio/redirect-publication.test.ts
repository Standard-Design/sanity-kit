import { evaluate, parse } from 'groq-js'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import type { Mutation } from '@sanity/client'
import type { PagesClient } from '../../src/studio/pages/data-source.js'
import { createRedirectPublicationController } from '../../src/studio/redirects/publication.js'
const routes = {
	pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
	reservedPathPrefixes: ['/account'],
}
type Row = Record<string, unknown>
function setup(extra: Row[] = [], published = true) {
	const id = crypto.randomUUID()
	const rule: Row = {
		_id: id,
		_type: 'sanityKitRedirect',
		_rev: 'live',
		_createdAt: '2026-01-01T00:00:00Z',
		source: '/old',
		destination: '/before',
		status: 301,
		enabled: true,
		origin: 'manual',
	}
	const draft: Row = {
		...rule,
		_id: `drafts.${id}`,
		_rev: 'draft',
		destination: '/after',
		customMetadata: { keep: 'me' },
	}
	const rows: Row[] = [...(published ? [rule] : []), draft, ...extra]
	let grants: unknown = [
		{ filter: 'true', permissions: ['read', 'create', 'update', 'delete'] },
	]
	let failure: undefined | 'before' | 'after' | number
	let beforeWrite: (() => void) | undefined
	const fetch = vi.fn(
		async (query: string, params: Record<string, unknown>): Promise<unknown> =>
			(await evaluate(parse(query), { dataset: rows, params })).get(),
	)
	const getDocument = vi.fn((key: string) =>
		Promise.resolve(structuredClone(rows.find((row) => row._id === key))),
	)
	const mutate = vi.fn(async (mutations: Mutation[]) => {
		await Promise.resolve()
		beforeWrite?.()
		if (typeof failure === 'number')
			throw Object.assign(new Error('Rejected'), { statusCode: failure })
		if (failure === 'before') throw new Error('Lost response')
		const copy = structuredClone(rows)
		for (const mutation of mutations) {
			if ('patch' in mutation && 'id' in mutation.patch) {
				const id = mutation.patch.id
				const index = copy.findIndex((row) => row._id === id)
				if (index < 0 || copy[index]!._rev !== mutation.patch.ifRevisionID)
					throw Object.assign(new Error('Stale'), { statusCode: 409 })
				Object.assign(copy[index]!, mutation.patch.set)
			} else if ('create' in mutation) {
				if (copy.some((row) => row._id === mutation.create._id))
					throw Object.assign(new Error('Exists'), { statusCode: 409 })
				copy.push({ ...mutation.create })
			} else if ('createOrReplace' in mutation) {
				const index = copy.findIndex(
					(row) => row._id === mutation.createOrReplace._id,
				)
				if (index < 0) copy.push({ ...mutation.createOrReplace })
				else copy[index] = { ...mutation.createOrReplace }
			} else if ('delete' in mutation && 'id' in mutation.delete) {
				const id = mutation.delete.id
				const index = copy.findIndex((row) => row._id === id)
				if (index >= 0) copy.splice(index, 1)
			}
		}
		rows.splice(0, rows.length, ...copy)
		if (failure === 'after') throw new Error('Lost response')
		return {}
	})
	const source = {
		config: () => ({ projectId: 'proof', dataset: 'development' }),
		withConfig: vi.fn(() => source),
		fetch,
		request: vi.fn((options: { uri?: string; url?: string }) =>
			options.uri?.includes('/data/doc/')
				? getDocument(decodeURIComponent(options.uri.split('/').at(-1)!)).then(
						(document) => ({ documents: document ? [document] : [] }),
					)
				: Promise.resolve(grants),
		),
		getDocument,
		mutate,
	}
	const controller = createRedirectPublicationController(
		routes,
		source as unknown as PagesClient,
	)
	const request = {
		documentId: id,
		draftRevision: 'draft',
		publishedRevision: published ? 'live' : null,
	}
	const ready = async () => {
		const result = await controller.review(request)
		expect(result.status).toBe('ready')
		if (result.status !== 'ready') throw new Error(JSON.stringify(result))
		return result.review
	}
	return {
		id,
		rows,
		draft,
		controller,
		request,
		ready,
		mutate,
		source,
		setGrants: (value: unknown) => {
			grants = value
		},
		setFailure: (value: typeof failure) => {
			failure = value
		},
		setBeforeWrite: (value: () => void) => {
			beforeWrite = value
		},
	}
}
beforeEach(() => {
	const storage = new Map<string, string>()
	vi.stubGlobal('sessionStorage', {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => {
			storage.set(key, value)
		},
		removeItem: (key: string) => {
			storage.delete(key)
		},
	})
})
afterEach(() => vi.unstubAllGlobals())
describe('guarded redirect publishing', () => {
	it('publishes the complete reviewed draft, preserves custom fields, and deletes only its draft', async () => {
		const test = setup()
		const review = await test.ready()
		expect(
			await test.controller.publish(review, { isCurrent: () => true }),
		).toEqual({ status: 'published' })
		expect(test.rows.find((row) => row._id === test.id)).toMatchObject({
			destination: '/after',
			customMetadata: { keep: 'me' },
			_createdAt: '2026-01-01T00:00:00Z',
		})
		expect(test.rows.some((row) => row._id === `drafts.${test.id}`)).toBe(false)
		expect(test.mutate.mock.calls[0]?.[0]).toEqual(
			expect.arrayContaining([
				{
					patch: {
						id: test.id,
						ifRevisionID: 'live',
						set: { _type: 'sanityKitRedirect' },
					},
				},
			]),
		)
	})
	it('uses strict create for a first publish', async () => {
		const test = setup([], false)
		expect(
			await test.controller.publish(await test.ready(), {
				isCurrent: () => true,
			}),
		).toEqual({ status: 'published' })
		expect(
			test.mutate.mock.calls[0]?.[0].some(
				(mutation) => 'create' in mutation && mutation.create._id === test.id,
			),
		).toBe(true)
	})
	it('rejects a newly created live version atomically after the last query', async () => {
		const test = setup([], false),
			review = await test.ready()
		test.setBeforeWrite(() =>
			test.rows.push({
				...test.draft,
				_id: test.id,
				_rev: 'concurrent',
				destination: '/keep',
			}),
		)
		expect(
			await test.controller.publish(review, { isCurrent: () => true }),
		).toMatchObject({ status: 'blocked', reason: 'review-stale' })
		expect(test.rows.find((row) => row._id === test.id)?.destination).toBe(
			'/keep',
		)
		expect(test.rows.some((row) => row._id === `drafts.${test.id}`)).toBe(true)
		expect(
			test.rows.some((row) => row._type === 'sanityKitRedirectPublication'),
		).toBe(false)
	})
	it('retires a redirect by publishing enabled=false without deleting its history record', async () => {
		const test = setup()
		test.draft.enabled = false
		expect(
			await test.controller.publish(await test.ready(), {
				isCurrent: () => true,
			}),
		).toEqual({ status: 'published' })
		expect(test.rows.find((row) => row._id === test.id)?.enabled).toBe(false)
	})
	it('blocks a source used by a draft page', async () => {
		const test = setup([
			{
				_id: 'drafts.page',
				_type: 'page',
				_rev: 'p',
				pathname: { current: '/old' },
			},
		])
		expect(await test.controller.review(test.request)).toMatchObject({
			status: 'blocked',
			diagnostic: { reason: 'occupied-source' },
		})
		expect(test.mutate).not.toHaveBeenCalled()
	})
	it('blocks a reserved subtree source', async () => {
		const test = setup()
		test.draft.source = '/account/profile'
		expect(await test.controller.review(test.request)).toMatchObject({
			status: 'blocked',
			diagnostic: { reason: 'reserved-source' },
		})
	})
	it('blocks redirects into another active redirect', async () => {
		const test = setup([
			{
				_id: 'other',
				_type: 'sanityKitRedirect',
				_rev: 'o',
				source: '/after',
				destination: '/final',
				status: 301,
				enabled: true,
			},
		])
		expect(await test.controller.review(test.request)).toMatchObject({
			status: 'blocked',
			diagnostic: { reason: 'redirect-chain' },
		})
	})
	it('requires provable read access before querying documents', async () => {
		const test = setup()
		test.setGrants([
			{ filter: '_type == "sanityKitRedirect"', permissions: ['read'] },
		])
		expect(await test.controller.review(test.request)).toMatchObject({
			status: 'blocked',
			reason: 'unknown-read-access',
		})
		expect(test.source.fetch).not.toHaveBeenCalled()
	})
	it('blocks a release version of the candidate', async () => {
		const test = setup()
		test.rows.push({ ...test.draft, _id: `versions.release.${test.id}` })
		expect(await test.controller.review(test.request)).toMatchObject({
			status: 'blocked',
			reason: 'release-version',
		})
	})
	it('rechecks changed routing evidence before writing', async () => {
		const test = setup(),
			review = await test.ready()
		test.rows.push({
			_id: 'page',
			_type: 'page',
			_rev: 'p',
			pathname: { current: '/new-page' },
		})
		expect(
			await test.controller.publish(review, { isCurrent: () => true }),
		).toMatchObject({ status: 'blocked', reason: 'review-stale' })
		expect(test.mutate).not.toHaveBeenCalled()
	})
	it('rejects forged review objects and stale Studio state', async () => {
		const test = setup(),
			review = await test.ready()
		expect(
			await test.controller.publish({ ...review }, { isCurrent: () => true }),
		).toMatchObject({ status: 'blocked', reason: 'invalid-review' })
		expect(
			await test.controller.publish(review, { isCurrent: () => false }),
		).toMatchObject({ status: 'blocked', reason: 'review-stale' })
		expect(test.mutate).not.toHaveBeenCalled()
	})
	it('protects newer draft edits made after the fresh review', async () => {
		const test = setup(),
			review = await test.ready()
		test.setBeforeWrite(() => {
			test.draft._rev = 'new-draft'
			test.draft.destination = '/new-edit'
		})
		expect(
			await test.controller.publish(review, { isCurrent: () => true }),
		).toMatchObject({ status: 'blocked', reason: 'review-stale' })
		expect(test.rows.find((row) => row._id === test.id)?.destination).toBe(
			'/before',
		)
	})
	it('confirms a committed write after losing its response using the atomic receipt', async () => {
		const test = setup()
		test.setFailure('after')
		expect(
			await test.controller.publish(await test.ready(), {
				isCurrent: () => true,
			}),
		).toEqual({ status: 'published' })
		expect(test.controller.getPending(test.id)).toBe(null)
	})
	it('keeps an unconfirmed attempt pending across controller replacement and never resends it', async () => {
		const test = setup()
		test.setFailure('before')
		expect(
			await test.controller.publish(await test.ready(), {
				isCurrent: () => true,
			}),
		).toEqual({ status: 'unknown' })
		const replacement = createRedirectPublicationController(
			routes,
			test.source as unknown as PagesClient,
		)
		expect(replacement.getPending(test.id)).toMatchObject({
			documentId: test.id,
		})
		expect(await replacement.reconcile(test.id)).toEqual({ status: 'unknown' })
		expect(await replacement.review(test.request)).toMatchObject({
			status: 'blocked',
			reason: 'outcome-unknown',
		})
		expect(test.mutate).toHaveBeenCalledTimes(1)
	})
	it('allows a fresh review after a definite rejection', async () => {
		const test = setup()
		test.setFailure(403)
		expect(
			await test.controller.publish(await test.ready(), {
				isCurrent: () => true,
			}),
		).toMatchObject({ status: 'blocked', reason: 'publish-rejected' })
		expect(test.controller.getPending(test.id)).toBe(null)
		expect((await test.controller.review(test.request)).status).toBe('ready')
	})
	it('bounds the actual request including custom draft fields', async () => {
		const test = setup()
		Object.assign(test.draft, { largeCustomField: 'x'.repeat(1_048_576) })
		expect(
			await test.controller.publish(await test.ready(), {
				isCurrent: () => true,
			}),
		).toMatchObject({
			status: 'blocked',
			reason: 'request-limit',
			limit: { unit: 'bytes' },
		})
		expect(test.mutate).not.toHaveBeenCalled()
	})
})

describe('redirect mutation transport and recovery', () => {
	it('blocks writes when session recovery cannot be saved', async () => {
		const test = setup(),
			review = await test.ready()
		vi.stubGlobal('sessionStorage', {
			getItem: () => null,
			setItem: () => {
				throw new Error('Full')
			},
		})
		expect(
			await test.controller.publish(review, { isCurrent: () => true }),
		).toMatchObject({ status: 'blocked', reason: 'recovery-unavailable' })
		expect(test.mutate).not.toHaveBeenCalled()
	})
	it('recovers the pending attempt from session storage after module memory is lost, including long paths', async () => {
		const test = setup()
		test.draft.destination = '/' + 'a'.repeat(9000)
		test.setFailure('before')
		expect(
			await test.controller.publish(await test.ready(), {
				isCurrent: () => true,
			}),
		).toEqual({ status: 'unknown' })
		vi.resetModules()
		const { createRedirectPublicationController: restoredFactory } =
			await import('../../src/studio/redirects/publication.js')
		const restored = restoredFactory(
			routes,
			test.source as unknown as PagesClient,
		)
		expect(restored.getPending(test.id)?.after.destination).toHaveLength(9001)
		expect(await restored.reconcile(test.id)).toEqual({ status: 'unknown' })
		expect(await restored.review(test.request)).toMatchObject({
			status: 'blocked',
			reason: 'outcome-unknown',
		})
		expect(test.mutate).toHaveBeenCalledTimes(1)
	})
	it('uses the SDK raw, non-CDN reads and one non-retried mutation request with the exact guarded transaction', async () => {
		const { createClient } = await import('@sanity/client')
		const requests: { url: string; init: RequestInit }[] = []
		const id = crypto.randomUUID(),
			draft = {
				_id: `drafts.${id}`,
				_type: 'sanityKitRedirect',
				_rev: 'draft',
				source: '/old',
				destination: '/new',
				enabled: true,
				status: 301,
				origin: 'manual',
			}
		const sdk = createClient({
			projectId: 'proof',
			dataset: 'development',
			apiVersion: '2026-10-01',
			useCdn: true,
			maxRetries: 5,
			resolveFetch: () => async (input, init) => {
				await Promise.resolve()
				const url = String(input)
				requests.push({ url, init: init ?? {} })
				let data: unknown
				if (url.includes('/acl'))
					data = [
						{
							filter: 'true',
							permissions: ['read', 'create', 'update', 'delete'],
						},
					]
				else if (url.includes('/data/query/')) {
					const query =
						new URL(url).searchParams.get('query') ??
						(JSON.parse(init?.body as string) as { query: string }).query
					data = {
						result: query.includes('"registry"')
							? { registry: null, documents: [] }
							: [draft],
					}
				} else if (url.includes('/data/doc/'))
					data = { documents: url.includes(`drafts.${id}`) ? [draft] : [] }
				else if (url.includes('/data/mutate/'))
					return new Response(
						JSON.stringify({ error: { description: 'Temporary failure' } }),
						{ status: 503, headers: { 'content-type': 'application/json' } },
					)
				else throw new Error('Unexpected endpoint: ' + url)
				return new Response(JSON.stringify(data), {
					headers: { 'content-type': 'application/json' },
				})
			},
		})
		const controller = createRedirectPublicationController(
			routes,
			sdk as unknown as PagesClient,
		)
		const result = await controller.review({
			documentId: id,
			draftRevision: 'draft',
			publishedRevision: null,
		})
		expect(result.status).toBe('ready')
		if (result.status !== 'ready') throw new Error(JSON.stringify(result))
		expect(
			await controller.publish(result.review, { isCurrent: () => true }),
		).toEqual({ status: 'unknown' })
		const writes = requests.filter((request) =>
			request.url.includes('/data/mutate/'),
		)
		expect(writes).toHaveLength(1)
		const payload = JSON.parse(writes[0]!.init.body as string) as {
			mutations: Mutation[]
			transactionId: string
		}
		expect(payload.mutations).toEqual(
			expect.arrayContaining([
				{
					patch: {
						id: `drafts.${id}`,
						ifRevisionID: 'draft',
						set: { _type: 'sanityKitRedirect' },
					},
				},
				{ delete: { id: `drafts.${id}` } },
			]),
		)
		expect(
			payload.mutations.some(
				(mutation) => 'create' in mutation && mutation.create._id === id,
			),
		).toBe(true)
		expect(payload.transactionId).toMatch(/^[a-f0-9-]{36}$/u)
		expect(requests.every((request) => !request.url.includes('apicdn'))).toBe(
			true,
		)
		expect(
			requests
				.filter((request) => request.url.includes('/data/query/'))
				.every(
					(request) =>
						new URL(request.url).searchParams.get('perspective') === 'raw',
				),
		).toBe(true)
		expect(
			requests
				.filter(
					(request) =>
						request.url.includes('/data/query/') ||
						request.url.includes('/acl') ||
						request.url.includes('/data/doc/'),
				)
				.every((request) => request.init.cache === 'no-store'),
		).toBe(true)
	})
})

it('uses native publish reference-strengthening behavior in custom fields', async () => {
	const test = setup()
	Object.assign(test.draft, {
		custom: [
			{
				_type: 'reference',
				_ref: 'page',
				_weak: true,
				_strengthenOnPublish: { type: 'page' },
			},
			{
				nested: {
					_type: 'reference',
					_ref: 'optional',
					_weak: true,
					_strengthenOnPublish: { type: 'page', weak: true },
				},
			},
		],
	})
	expect(
		await test.controller.publish(await test.ready(), {
			isCurrent: () => true,
		}),
	).toEqual({ status: 'published' })
	expect(test.rows.find((row) => row._id === test.id)?.custom).toEqual([
		{ _type: 'reference', _ref: 'page' },
		{ nested: { _type: 'reference', _ref: 'optional', _weak: true } },
	])
})
