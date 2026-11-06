import { evaluate, parse } from 'groq-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Action } from '@sanity/client'
import type { PagesClient } from '../../src/studio/pages/data-source.js'
import { createUrlPublicationController } from '../../src/studio/url/publication.js'
import {
	forgetPendingPublication,
	readPendingPublication,
	rememberPendingPublication,
} from '../../src/studio/url/publication-pending.js'

const routes = {
	pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
	excludePaths: ['/api', '/preview'],
}
const page = (_id: string, current: string, _rev: string) => ({
	_id,
	_type: 'page',
	_rev,
	pathname: { current },
	title: _id.startsWith('drafts.') ? 'Reviewed draft title' : 'Live title',
})
const rule = (extra: Record<string, unknown> = {}) => ({
	_id: 'redirect-1',
	_type: 'sanityKitRedirect',
	_rev: 'redirect-rev',
	source: '/historic',
	destination: '/other',
	status: 301,
	enabled: true,
	origin: 'manual',
	...extra,
})
const requested = {
	documentId: 'page-1',
	publishedRevision: 'published-rev',
	draftRevision: 'draft-rev',
}
const currentChoice = { createRedirect: true, isCurrent: () => true }

type Row = Record<string, unknown>
function transport(
	extra: Row[] = [],
	config = { projectId: 'proof', dataset: 'development' },
) {
	const dataset: Row[] = [
		page('page-1', '/old', 'published-rev'),
		page('drafts.page-1', '/new', 'draft-rev'),
		...extra,
	]
	let grants: unknown = [
		{ filter: 'true', permissions: ['read', 'create', 'update'] },
	]
	let queryHook: ((query: string) => Promise<void> | void) | undefined
	let responseHook: ((query: string, result: unknown) => unknown) | undefined
	let actionHook: (() => Promise<void> | void) | undefined
	let actionFailure: 'before' | 'after' | number | undefined
	let receiptUnavailable = false
	let receiptOverride: Row | undefined
	const fetch = vi.fn(
		async (query: string, params: Record<string, unknown>) => {
			await queryHook?.(query)
			const result: unknown = await (
				await evaluate(parse(query), { dataset, params })
			).get()
			return responseHook ? responseHook(query, result) : result
		},
	)
	const request = vi.fn(() => Promise.resolve(grants))
	const getDocument = vi.fn((id: string) => {
		if (receiptUnavailable) throw new Error('Doc API unavailable')
		return Promise.resolve(
			receiptOverride ?? structuredClone(dataset.find((row) => row._id === id)),
		)
	})
	const action = vi.fn(async (actions: Action[]) => {
		await actionHook?.()
		if (typeof actionFailure === 'number')
			throw Object.assign(new Error('Rejected'), { statusCode: actionFailure })
		if (actionFailure === 'before')
			throw new Error('Disconnected before response')
		// Simulate the documented ordered, all-or-nothing Actions API batch. The
		// real endpoint—not this code—is responsible for executing these semantics.
		const staged = structuredClone(dataset)
		for (const action of actions) {
			if (
				action.actionType === 'sanity.action.document.version.create' &&
				'baseId' in action
			) {
				const base = staged.find((row) => row._id === action.baseId)
				if (
					!base ||
					staged.some((row) => row._id === action.versionId) ||
					(action.ifBaseRevisionId && base._rev !== action.ifBaseRevisionId)
				)
					throw Object.assign(new Error('Version conflict'), {
						statusCode: 409,
					})
				staged.push({
					...structuredClone(base),
					_id: action.versionId,
					_rev: 'copied-draft',
				})
			} else if (action.actionType === 'sanity.action.document.edit') {
				const draft = staged.find((row) => row._id === action.draftId)
				if (!draft)
					throw new Error('Expected explicit draft creation before edit')
				Object.assign(draft, action.patch.set)
				draft._rev = 'edited-draft'
			} else if (action.actionType === 'sanity.action.document.create') {
				if (
					staged.some(
						(row) =>
							row._id === action.publishedId ||
							row._id === action.attributes._id,
					)
				)
					throw Object.assign(new Error('Conflict'), { statusCode: 409 })
				staged.push({ ...action.attributes, _rev: 'created-draft' })
			} else if (action.actionType === 'sanity.action.document.publish') {
				const draft = staged.find((row) => row._id === action.draftId)
				const published = staged.find((row) => row._id === action.publishedId)
				if (
					!draft ||
					(action.ifDraftRevisionId &&
						draft._rev !== action.ifDraftRevisionId) ||
					(action.ifPublishedRevisionId &&
						published?._rev !== action.ifPublishedRevisionId)
				)
					throw Object.assign(new Error('Conflict'), { statusCode: 409 })
				const next = { ...draft, _id: action.publishedId, _rev: 'committed' }
				const remaining = staged.filter(
					(row) => row._id !== action.draftId && row._id !== action.publishedId,
				)
				staged.splice(0, staged.length, ...remaining, next)
			} else throw new Error('Unexpected action')
		}
		dataset.splice(0, dataset.length, ...staged)
		if (actionFailure === 'after') throw new Error('Response lost after commit')
		return { transactionId: 'committed' }
	})
	const source = {
		fetch,
		request,
		getDocument,
		action,
		config: () => config,
	}
	const withConfig = vi.fn((): PagesClient => client)
	const client = { ...source, withConfig } as unknown as PagesClient
	return {
		client,
		dataset,
		fetch,
		request,
		getDocument,
		action,
		withConfig,
		controller: createUrlPublicationController(routes, client),
		grants(value: unknown) {
			grants = value
		},
		onQuery(value: typeof queryHook) {
			queryHook = value
		},
		onResponse(value: typeof responseHook) {
			responseHook = value
		},
		onAction(value: typeof actionHook) {
			actionHook = value
		},
		failAction(value: typeof actionFailure) {
			actionFailure = value
		},
		hideReceipt(value = true) {
			receiptUnavailable = value
		},
		setReceipt(value: Row) {
			receiptOverride = value
		},
	}
}
async function reviewed(io: ReturnType<typeof transport>) {
	const result = await io.controller.review(requested)
	expect(result, 'publication review').toMatchObject({ status: 'ready' })
	if (result.status !== 'ready') throw new Error(result.reason)
	return result.review
}

beforeEach(() => {
	const saved = new Map<string, string>()
	vi.stubGlobal('sessionStorage', {
		getItem: (key: string) => saved.get(key) ?? null,
		setItem: (key: string, value: string) => saved.set(key, value),
		removeItem: (key: string) => saved.delete(key),
	})
})
afterEach(() => {
	forgetPendingPublication({
		projectId: 'proof',
		dataset: 'development',
		documentId: 'page-1',
	})
	vi.unstubAllGlobals()
})

describe('URL publication service', () => {
	it.each([undefined, 400, 409])(
		'preserves a definite result for a remounted reader while the original request finishes (%s)',
		async (status) => {
			const io = transport()
			let finish!: () => void
			io.onAction(
				() =>
					new Promise<void>((resolve) => {
						finish = resolve
					}),
			)
			if (status) io.failAction(status)
			const value = await reviewed(io)
			const publishing = io.controller.publish(value, currentChoice)
			await vi.waitFor(() => expect(io.action).toHaveBeenCalledOnce())
			const restored = createUrlPublicationController(routes, io.client)
			expect(restored.getPending('page-1')).toMatchObject(value)
			finish()
			const result = await publishing
			expect(result).toEqual(
				status
					? {
							status: 'blocked',
							reason: status === 409 ? 'review-stale' : 'publication-rejected',
						}
					: { status: 'published' },
			)
			expect(io.controller.getPending('page-1')).toBeNull()
			expect(await restored.reconcile('page-1')).toEqual(result)
			expect(await restored.reconcile('page-1')).toEqual({
				status: 'blocked',
				reason: 'no-pending-publication',
			})
			expect(io.action).toHaveBeenCalledOnce()
		},
	)

	it('does not clear a newer pending operation when checking a captured older receipt', async () => {
		const io = transport()
		io.failAction('after')
		io.hideReceipt()
		await io.controller.publish(await reviewed(io), currentChoice)
		const restored = createUrlPublicationController(routes, io.client)
		restored.getPending('page-1')
		const scope = {
			projectId: 'proof',
			dataset: 'development',
			documentId: 'page-1',
		}
		const older = readPendingPublication(scope)!
		const operationId = crypto.randomUUID()
		const newer = {
			...older,
			receipt: {
				...older.receipt,
				operationId,
				_id: `sanityKit.urlPublication.${operationId}`,
			},
		}
		rememberPendingPublication(scope, newer)
		io.hideReceipt(false)
		expect(await restored.reconcile('page-1')).toEqual({ status: 'published' })
		expect(readPendingPublication(scope)).toBe(newer)
		expect(io.action).toHaveBeenCalledOnce()
	})

	it('resumes an uncertain operation after controller recreation without another write', async () => {
		const io = transport()
		const value = await reviewed(io)
		io.failAction('after')
		io.hideReceipt()
		await io.controller.publish(value, currentChoice)
		const restored = createUrlPublicationController(routes, io.client)
		expect(restored.getPending('page-1')).toEqual({
			...value,
			createRedirect: true,
		})
		expect(await restored.review(requested)).toEqual({
			status: 'blocked',
			reason: 'outcome-unknown',
		})
		expect(await restored.publish(value, currentChoice)).toEqual({
			status: 'blocked',
			reason: 'outcome-unknown',
		})
		io.hideReceipt(false)
		expect(await restored.reconcile('page-1')).toEqual({ status: 'published' })
		expect(restored.getPending('page-1')).toBeNull()
		expect(io.controller.getPending('page-1')).toBeNull()
		expect(io.action).toHaveBeenCalledOnce()
	})

	it('ignores a claimed completion injected into persisted recovery data', async () => {
		const io = transport()
		io.failAction('before')
		await io.controller.publish(await reviewed(io), currentChoice)
		const key = 'sanity-kit.url-publication:["proof","development","page-1"]'
		const value = JSON.parse(sessionStorage.getItem(key)!) as Record<
			string,
			unknown
		>
		value.result = { status: 'published' }
		sessionStorage.setItem(key, JSON.stringify(value))
		vi.resetModules()
		const { createUrlPublicationController: createRestored } =
			await import('../../src/studio/url/publication.js')
		const restored = createRestored(routes, io.client)
		expect(await restored.reconcile('page-1')).toEqual({
			status: 'unknown',
			reason: 'publication-outcome-unknown',
		})
		expect(io.action).toHaveBeenCalledOnce()
	})

	it('restores a pending operation from session storage after a module reload', async () => {
		const io = transport()
		const value = await reviewed(io)
		io.failAction('after')
		io.hideReceipt()
		await io.controller.publish(value, currentChoice)
		vi.resetModules()
		const { createUrlPublicationController: createRestored } =
			await import('../../src/studio/url/publication.js')
		const restored = createRestored(routes, io.client)
		expect(restored.getPending('page-1')).toEqual({
			...value,
			createRedirect: true,
		})
		io.hideReceipt(false)
		expect(await restored.reconcile('page-1')).toEqual({ status: 'published' })
		expect(restored.getPending('page-1')).toBeNull()
		expect(io.action).toHaveBeenCalledOnce()
	})

	it('keeps pending recovery isolated by project, dataset, and document', async () => {
		const io = transport()
		io.failAction('before')
		await io.controller.publish(await reviewed(io), currentChoice)
		expect(io.controller.getPending('page-2')).toBeNull()
		for (const config of [
			{ projectId: 'other', dataset: 'development' },
			{ projectId: 'proof', dataset: 'other' },
		]) {
			const other = transport([], config)
			expect(other.controller.getPending('page-1')).toBeNull()
			expect((await other.controller.review(requested)).status).toBe('ready')
		}
	})

	it('retains navigation recovery when session storage is unavailable', async () => {
		vi.stubGlobal('sessionStorage', {
			getItem: () => {
				throw new Error('Storage disabled')
			},
			setItem: () => {
				throw new Error('Storage disabled')
			},
			removeItem: () => {
				throw new Error('Storage disabled')
			},
		})
		const io = transport()
		const value = await reviewed(io)
		io.failAction('after')
		io.hideReceipt()
		await io.controller.publish(value, currentChoice)
		const restored = createUrlPublicationController(routes, io.client)
		expect(restored.getPending('page-1')).toEqual({
			...value,
			createRedirect: true,
		})
		io.hideReceipt(false)
		expect(await restored.reconcile('page-1')).toEqual({ status: 'published' })
		expect(io.action).toHaveBeenCalledOnce()
	})

	it('restores the choice to skip a new redirect', async () => {
		const io = transport()
		io.failAction('before')
		await io.controller.publish(await reviewed(io), {
			...currentChoice,
			createRedirect: false,
		})
		expect(
			createUrlPublicationController(routes, io.client).getPending('page-1')
				?.createRedirect,
		).toBe(false)
	})

	it('fails closed when a saved operation cannot be read', async () => {
		sessionStorage.setItem(
			'sanity-kit.url-publication:["proof","development","page-1"]',
			'{invalid',
		)
		const io = transport()
		expect(() => io.controller.getPending('page-1')).toThrow()
		expect(await io.controller.reconcile('page-1')).toEqual({
			status: 'unknown',
			reason: 'publication-outcome-unknown',
		})
		expect(io.action).not.toHaveBeenCalled()
	})

	it.each(['operationId', 'draftRevision', 'redirectUpdates', 'review'])(
		'refuses a damaged saved %s instead of confirming another operation',
		async (field) => {
			const io = transport()
			io.failAction('before')
			await io.controller.publish(await reviewed(io), currentChoice)
			const key = 'sanity-kit.url-publication:["proof","development","page-1"]'
			const value = JSON.parse(sessionStorage.getItem(key)!) as {
				receipt: Record<string, unknown>
				review: Record<string, unknown>
			}
			if (field === 'review') value.review.affectedRedirects = [{}]
			else
				value.receipt[field] = field === 'redirectUpdates' ? '[{}]' : 'changed'
			sessionStorage.setItem(key, JSON.stringify(value))
			vi.resetModules()
			const { createUrlPublicationController: createRestored } =
				await import('../../src/studio/url/publication.js')
			const restored = createRestored(routes, io.client)
			expect(() => restored.getPending('page-1')).toThrow()
			expect(await restored.reconcile('page-1')).toEqual({
				status: 'unknown',
				reason: 'publication-outcome-unknown',
			})
			expect(io.action).toHaveBeenCalledOnce()
		},
	)

	it('clears pending recovery after a definite server rejection', async () => {
		const io = transport()
		io.failAction(409)
		await io.controller.publish(await reviewed(io), currentChoice)
		expect(
			createUrlPublicationController(routes, io.client).getPending('page-1'),
		).toBeNull()
	})

	it('reads raw complete evidence and reviews without writing', async () => {
		const io = transport()
		const result = await reviewed(io)
		expect(result).toEqual({
			...requested,
			oldPathname: '/old',
			newPathname: '/new',
			affectedRedirects: [],
		})
		expect(Object.isFrozen(result)).toBe(true)
		expect(io.action).not.toHaveBeenCalled()
		expect(io.withConfig).toHaveBeenCalledWith(
			expect.objectContaining({
				perspective: 'raw',
				useCdn: false,
				stega: false,
				maxRetries: 0,
			}),
		)
		expect(io.request).toHaveBeenCalledWith(
			expect.objectContaining({
				url: '/projects/proof/datasets/development/acl',
				fetch: { cache: 'no-store', next: undefined },
			}),
		)
		for (const call of io.fetch.mock.calls) {
			expect(call[0]).toBeTruthy()
		}
	})

	it('atomically publishes the reviewed draft, redirect, and operation receipt with revision guards', async () => {
		const io = transport()
		const review = await reviewed(io)
		expect(await io.controller.publish(review, currentChoice)).toEqual({
			status: 'published',
		})
		expect(io.action).toHaveBeenCalledTimes(1)
		const actions = io.action.mock.calls[0]![0]
		expect(actions).toHaveLength(5)
		expect(actions[2]).toEqual({
			actionType: 'sanity.action.document.publish',
			publishedId: 'page-1',
			draftId: 'drafts.page-1',
			ifDraftRevisionId: 'draft-rev',
			ifPublishedRevisionId: 'published-rev',
		})
		const redirect = io.dataset.find(
			(row) => row._type === 'sanityKitRedirect',
		)!
		expect(redirect).toMatchObject({
			source: '/old',
			destination: '/new',
			status: 301,
			enabled: true,
			origin: 'url-change',
		})
		expect(String(redirect._id)).not.toContain('/old')
		expect(io.dataset.find((row) => row._id === 'page-1')).toMatchObject({
			pathname: { current: '/new' },
			title: 'Reviewed draft title',
		})
		expect(io.dataset.some((row) => row._id === 'drafts.page-1')).toBe(false)
		const receipt = io.dataset.find(
			(row) => row._type === 'sanityKitUrlPublication',
		)!
		expect(receipt).toMatchObject({
			documentId: 'page-1',
			oldPathname: '/old',
			newPathname: '/new',
			redirectId: redirect._id,
			createRedirect: true,
		})
		expect(String(receipt._id)).toBe(
			`sanityKit.urlPublication.${String(receipt.operationId)}`,
		)
		expect(await io.controller.publish(review, currentChoice)).toEqual({
			status: 'blocked',
			reason: 'invalid-review',
		})
	})

	it('publishes without a redirect when explicitly chosen', async () => {
		const io = transport()
		expect(
			await io.controller.publish(await reviewed(io), {
				...currentChoice,
				createRedirect: false,
			}),
		).toEqual({ status: 'published' })
		expect(io.action.mock.calls[0]![0]).toHaveLength(3)
		expect(
			io.dataset.filter((row) => row._type === 'sanityKitRedirect'),
		).toEqual([])
		expect(
			io.dataset.find((row) => row._type === 'sanityKitUrlPublication'),
		).toMatchObject({ createRedirect: false, redirectId: null })
	})

	it.each([
		{ grants: [] },
		{ grants: [{ filter: '_type == "page"', permissions: ['read'] }] },
		{ grants: [{ filter: 'true', permissions: ['update'] }] },
	])('refuses unproven complete visibility $grants', async ({ grants }) => {
		const io = transport()
		io.grants(grants)
		expect(await io.controller.review(requested)).toEqual({
			status: 'blocked',
			reason: 'unknown-read-access',
			accessIssues: expect.any(Array) as unknown,
		})
		expect(io.fetch).not.toHaveBeenCalled()
		expect(io.action).not.toHaveBeenCalled()
	})

	it('reviews and publishes with additive custom grants covering pages, redirects, folders, and recovery receipts', async () => {
		const io = transport()
		io.grants([
			{
				filter:
					'_type in ["page", "sanityKitRedirect"] && !(_id in path("drafts.**")) && !(_id in path("versions.**"))',
				permissions: ['read'],
			},
			{
				filter:
					'_type in ["page", "sanityKitRedirect"] && _id in path("drafts.**")',
				permissions: ['read'],
			},
			{
				filter:
					'_type in ["page", "sanityKitRedirect"] && _id in path("versions.**")',
				permissions: ['read'],
			},
			{ filter: '_id == "sanityKit.folders"', permissions: ['read'] },
			{
				filter: '_id in path("sanityKit.urlPublication.**")',
				permissions: ['read'],
			},
		])
		expect(
			await io.controller.publish(await reviewed(io), currentChoice),
		).toEqual({
			status: 'published',
		})
		expect(io.action).toHaveBeenCalledOnce()
		// These grants establish complete reads only. The real Actions API still
		// authorizes writes; the transport's action stub does not model write ACLs.
	})

	it('lists missing redirect and unverified metadata access before querying the inventory', async () => {
		const io = transport()
		io.grants([{ filter: '_type == "page"', permissions: ['read'] }])
		expect(await io.controller.review(requested)).toMatchObject({
			status: 'blocked',
			reason: 'unknown-read-access',
			accessIssues: expect.arrayContaining([
				expect.objectContaining({
					key: 'sanityKitRedirect:published',
					status: 'missing',
				}),
				expect.objectContaining({
					key: 'sanityKitRedirect:drafts',
					status: 'missing',
				}),
				expect.objectContaining({
					key: 'sanityKitRedirect:releases',
					status: 'missing',
				}),
				expect.objectContaining({
					key: 'folder-registry',
					status: 'unverified',
				}),
				expect.objectContaining({
					key: 'publication-receipts',
					status: 'unverified',
				}),
			]) as unknown,
		})
		expect(io.fetch).not.toHaveBeenCalled()
		expect(io.action).not.toHaveBeenCalled()
	})

	it('rechecks access at confirmation and refuses publication if reviewed access was revoked', async () => {
		const io = transport()
		const review = await reviewed(io)
		io.grants([])
		io.fetch.mockClear()
		expect(await io.controller.publish(review, currentChoice)).toMatchObject({
			status: 'blocked',
			reason: 'unknown-read-access',
			accessIssues: expect.arrayContaining([
				expect.objectContaining({ key: 'page:published', status: 'missing' }),
				expect.objectContaining({
					key: 'publication-receipts',
					status: 'missing',
				}),
			]) as unknown,
		})
		expect(io.request).toHaveBeenCalledTimes(2)
		expect(io.fetch).not.toHaveBeenCalled()
		expect(io.action).not.toHaveBeenCalled()
		expect(io.controller.getPending('page-1')).toBeNull()
	})

	it.each([
		'drafts.page-1',
		'versions.release.page-1',
		'-invalid',
		'bad..id',
		'bad.',
	])('refuses invalid review identity %s', async (documentId) => {
		const io = transport()
		expect(await io.controller.review({ ...requested, documentId })).toEqual({
			status: 'blocked',
			reason: 'invalid-document-id',
		})
		expect(io.request).not.toHaveBeenCalled()
	})

	it('refuses missing versions, releases, invalid paths, and unchanged URLs', async () => {
		const absent = transport()
		absent.dataset.shift()
		expect(await absent.controller.review(requested)).toEqual({
			status: 'blocked',
			reason: 'versions-changed',
		})
		const release = transport([
			page('versions.release.page-1', '/later', 'release-rev'),
		])
		expect(await release.controller.review(requested)).toEqual({
			status: 'blocked',
			reason: 'release-version',
		})
		const invalid = transport()
		invalid.dataset[1]!.pathname = { current: '/bad//path' }
		expect(await invalid.controller.review(requested)).toEqual({
			status: 'blocked',
			reason: 'invalid-url',
		})
		const same = transport()
		same.dataset[1]!.pathname = { current: '/old' }
		expect(await same.controller.review(requested)).toEqual({
			status: 'blocked',
			reason: 'url-unchanged',
		})
	})

	it.each(['other', 'drafts.other', 'versions.release.other'])(
		'detects other-page target occupancy across all versions: %s',
		async (_id) => {
			const io = transport([page(_id, '/new', 'other-rev')])
			expect(await io.controller.review(requested)).toEqual({
				status: 'blocked',
				reason: 'url-conflict',
				conflict: {
					kind: 'page',
					pathname: '/new',
					documentId: _id,
					schemaType: 'page',
					title: _id.startsWith('drafts.')
						? 'Reviewed draft title'
						: 'Live title',
				},
			})
			expect(io.action).not.toHaveBeenCalled()
		},
	)

	it('keeps the blocking document identity if its title cannot be read', async () => {
		const io = transport([page('other', '/new', 'other-rev')])
		io.dataset.find((row) => row._id === 'other')!.title = null
		const result = await io.controller.review(requested)
		expect(result).toEqual({
			status: 'blocked',
			reason: 'url-conflict',
			conflict: {
				kind: 'page',
				pathname: '/new',
				documentId: 'other',
				schemaType: 'page',
			},
		})
		expect(io.action).not.toHaveBeenCalled()
	})
	it('identifies an existing redirect that occupies the proposed URL', async () => {
		const io = transport([rule({ source: '/new', destination: '/elsewhere' })])
		expect(await io.controller.review(requested)).toEqual({
			status: 'blocked',
			reason: 'target-is-redirect',
			conflict: {
				kind: 'redirect',
				pathname: '/new',
				documentId: 'redirect-1',
				schemaType: 'sanityKitRedirect',
				destination: '/elsewhere',
			},
		})
		expect(io.action).not.toHaveBeenCalled()
	})
	it('passes shared prefix reservations to redirect review', async () => {
		const io = transport([rule({ source: '/account/legacy' })])
		const controller = createUrlPublicationController(
			{
				...routes,
				reservedPathPrefixes: ['/account'],
			},
			io.client,
		)
		expect(await controller.review(requested)).toMatchObject({
			status: 'blocked',
			redirectIssue: 'reserved-source',
			conflict: { documentId: 'redirect-1', pathname: '/account/legacy' },
		})
		expect(io.action).not.toHaveBeenCalled()
	})
	it('refuses an imported draft URL inside a reserved section', async () => {
		const io = transport()
		io.dataset[1]!.pathname = { current: '/account/settings' }
		const controller = createUrlPublicationController(
			{
				...routes,
				reservedPathPrefixes: ['/account'],
			},
			io.client,
		)
		expect(await controller.review(requested)).toMatchObject({
			status: 'blocked',
			reason: 'invalid-url',
		})
		expect(io.action).not.toHaveBeenCalled()
	})
	it('names a reserved application URL', async () => {
		const io = transport()
		const controller = createUrlPublicationController(routes, io.client, {
			reservedPaths: ['/new'],
		})
		expect(await controller.review(requested)).toEqual({
			status: 'blocked',
			reason: 'target-is-reserved',
			conflict: { kind: 'reserved', pathname: '/new' },
		})
		expect(io.action).not.toHaveBeenCalled()
	})
	it('rechecks page revisions, unrelated inventory, and local readiness before dispatch', async () => {
		const changed = transport()
		const review = await reviewed(changed)
		changed.dataset[1]!._rev = 'new-draft-rev'
		expect(await changed.controller.publish(review, currentChoice)).toEqual({
			status: 'blocked',
			reason: 'review-stale',
		})
		const inventory = transport()
		const otherReview = await reviewed(inventory)
		inventory.dataset.push(page('another', '/another', 'another-rev'))
		expect(
			await inventory.controller.publish(otherReview, currentChoice),
		).toEqual({ status: 'blocked', reason: 'review-stale' })
		const local = transport()
		expect(
			await local.controller.publish(await reviewed(local), {
				...currentChoice,
				isCurrent: () => false,
			}),
		).toEqual({ status: 'blocked', reason: 'review-stale' })
		for (const io of [changed, inventory, local])
			expect(io.action).not.toHaveBeenCalled()
	})

	it('does not trust a reconstructed or forged review object', async () => {
		const io = transport()
		const review = await reviewed(io)
		expect(await io.controller.publish({ ...review }, currentChoice)).toEqual({
			status: 'blocked',
			reason: 'invalid-review',
		})
	})

	it('rejects newly introduced conflicts and releases at confirmation', async () => {
		for (const added of [
			page('other', '/new', 'r'),
			page('versions.release.page-1', '/later', 'r'),
		]) {
			const io = transport()
			const review = await reviewed(io)
			io.dataset.push(added)
			expect((await io.controller.publish(review, currentChoice)).status).toBe(
				'blocked',
			)
			expect(io.action).not.toHaveBeenCalled()
		}
	})

	it('refuses a redirect target or pending redirect edits', async () => {
		for (const existing of [
			rule({ source: '/new' }),
			rule({ _id: 'drafts.pending', source: '/old' }),
		]) {
			const io = transport([existing])
			expect((await io.controller.review(requested)).status).toBe('blocked')
			expect(io.action).not.toHaveBeenCalled()
		}
	})

	it('rejects a malformed or overflowing redirect read and malformed page inventory', async () => {
		const redirects = transport()
		redirects.onResponse((query, response) =>
			query.includes('sanityKitRedirect') ? [{}] : response,
		)
		expect((await redirects.controller.review(requested)).status).toBe(
			'blocked',
		)
		const overflow = transport()
		overflow.onResponse((query, response) =>
			query.includes('sanityKitRedirect')
				? Array.from({ length: 1001 }, () => rule())
				: response,
		)
		expect(await overflow.controller.review(requested)).toEqual({
			status: 'blocked',
			reason: 'inventory-limit',
			limit: {
				kind: 'redirect-records',
				actual: 1001,
				maximum: 1000,
				measurement: 'at-least',
				phase: 'current',
			},
		})
		const pages = transport()
		pages.onResponse((query, response) =>
			query.includes('"documents"')
				? { registry: null, documents: [{}] }
				: response,
		)
		expect(await pages.controller.review(requested)).toEqual({
			status: 'blocked',
			reason: 'inventory-invalid-response',
		})
	})

	it('honors cancellation even when the read transport completes afterward', async () => {
		const io = transport()
		const abort = new AbortController()
		io.onQuery((query) => {
			if (query.includes('sanityKitRedirect')) abort.abort()
		})
		expect(await io.controller.review(requested, abort.signal)).toEqual({
			status: 'blocked',
			reason: 'aborted',
		})
		expect(io.action).not.toHaveBeenCalled()
	})

	it('rejects a concurrent published edit atomically, leaving no redirect or receipt', async () => {
		const io = transport()
		const review = await reviewed(io)
		io.onAction(() => {
			io.dataset[0]!._rev = 'concurrent-live-rev'
		})
		expect(await io.controller.publish(review, currentChoice)).toEqual({
			status: 'blocked',
			reason: 'review-stale',
		})
		expect(io.dataset.find((row) => row._id === 'page-1')).toMatchObject({
			pathname: { current: '/old' },
		})
		expect(
			io.dataset.some(
				(row) =>
					row._type === 'sanityKitRedirect' ||
					row._type === 'sanityKitUrlPublication',
			),
		).toBe(false)
	})

	it.each([400, 401, 403, 404])(
		'treats definite rejection %s as blocked and never automatically retries',
		async (status) => {
			const io = transport()
			io.failAction(status)
			expect(
				await io.controller.publish(await reviewed(io), currentChoice),
			).toEqual({ status: 'blocked', reason: 'publication-rejected' })
			expect(io.action).toHaveBeenCalledTimes(1)
			expect(io.getDocument).not.toHaveBeenCalled()
		},
	)

	it('reconciles a lost response using the exact committed private receipt', async () => {
		const io = transport()
		io.failAction('after')
		expect(
			await io.controller.publish(await reviewed(io), currentChoice),
		).toEqual({ status: 'published' })
		expect(io.action).toHaveBeenCalledTimes(1)
		expect(io.getDocument).toHaveBeenCalledTimes(1)
		expect(io.getDocument.mock.calls[0]![0]).toMatch(
			/^sanityKit\.urlPublication\./u,
		)
	})

	it('keeps an absent receipt uncertain and blocks all further publication without retrying', async () => {
		const io = transport()
		const review = await reviewed(io)
		io.failAction('before')
		expect(await io.controller.publish(review, currentChoice)).toEqual({
			status: 'unknown',
			reason: 'publication-outcome-unknown',
		})
		expect(await io.controller.review(requested)).toEqual({
			status: 'blocked',
			reason: 'outcome-unknown',
		})
		expect(await io.controller.publish(review, currentChoice)).toEqual({
			status: 'blocked',
			reason: 'outcome-unknown',
		})
		expect(await io.controller.reconcile()).toEqual({
			status: 'unknown',
			reason: 'publication-outcome-unknown',
		})
		expect(io.action).toHaveBeenCalledTimes(1)
	})

	it('recovers from an unavailable receipt read once the exact receipt becomes readable', async () => {
		const io = transport()
		io.failAction('after')
		io.hideReceipt()
		expect(
			await io.controller.publish(await reviewed(io), currentChoice),
		).toEqual({ status: 'unknown', reason: 'publication-outcome-unknown' })
		io.hideReceipt(false)
		expect(await io.controller.reconcile()).toEqual({ status: 'published' })
		expect(await io.controller.reconcile()).toEqual({
			status: 'blocked',
			reason: 'no-pending-publication',
		})
		expect(io.action).toHaveBeenCalledTimes(1)
	})

	it('does not accept a receipt for a different URL change', async () => {
		const io = transport()
		io.failAction('after')
		io.hideReceipt()
		await io.controller.publish(await reviewed(io), currentChoice)
		const receipt = io.dataset.find(
			(row) => row._type === 'sanityKitUrlPublication',
		)!
		io.setReceipt({ ...receipt, newPathname: '/tampered' })
		io.hideReceipt(false)
		expect(await io.controller.reconcile()).toEqual({
			status: 'unknown',
			reason: 'publication-outcome-unknown',
		})
		expect(io.action).toHaveBeenCalledTimes(1)
	})

	it('serializes publication while the action request is in flight', async () => {
		const io = transport()
		const review = await reviewed(io)
		let finish!: () => void
		let entered!: () => void
		const started = new Promise<void>((resolve) => {
			entered = resolve
		})
		io.onAction(async () => {
			entered()
			await new Promise<void>((resolve) => {
				finish = resolve
			})
		})
		const pending = io.controller.publish(review, currentChoice)
		await started
		expect((await io.controller.publish(review, currentChoice)).status).toBe(
			'blocked',
		)
		expect((await io.controller.review(requested)).status).toBe('blocked')
		finish()
		expect(await pending).toEqual({ status: 'published' })
		expect(io.action).toHaveBeenCalledTimes(1)
	})
})

describe('repeated URL publication', () => {
	it.each([true, false])(
		'reviews and retargets existing aliases with createRedirect=%s',
		async (createRedirect) => {
			const alias = rule({
				destination: '/old',
				status: 302,
				origin: 'manual',
				label: 'Keep my label',
				notes: { editor: 'Retain metadata outside the query projection' },
			})
			const io = transport([alias])
			const review = await reviewed(io)
			expect(review.affectedRedirects).toEqual([
				{
					id: 'redirect-1',
					source: '/historic',
					oldDestination: '/old',
					newDestination: '/new',
					status: 302,
				},
			])
			expect(Object.isFrozen(review.affectedRedirects)).toBe(true)
			expect(Object.isFrozen(review.affectedRedirects[0])).toBe(true)
			expect(io.action).not.toHaveBeenCalled()
			expect(
				await io.controller.publish(review, {
					...currentChoice,
					createRedirect,
				}),
			).toEqual({ status: 'published' })
			const actions = io.action.mock.calls[0]![0]
			expect(actions.slice(0, 3)).toEqual([
				{
					actionType: 'sanity.action.document.version.create',
					publishedId: 'redirect-1',
					baseId: 'redirect-1',
					versionId: 'drafts.redirect-1',
					ifBaseRevisionId: 'redirect-rev',
				},
				{
					actionType: 'sanity.action.document.edit',
					publishedId: 'redirect-1',
					draftId: 'drafts.redirect-1',
					patch: { set: { destination: '/new' } },
				},
				{
					actionType: 'sanity.action.document.publish',
					publishedId: 'redirect-1',
					draftId: 'drafts.redirect-1',
					ifPublishedRevisionId: 'redirect-rev',
				},
			])
			expect(io.dataset.find((row) => row._id === 'redirect-1')).toEqual({
				...alias,
				destination: '/new',
				_rev: 'committed',
			})
			expect(
				io.dataset.filter((row) => row._type === 'sanityKitRedirect'),
			).toHaveLength(createRedirect ? 2 : 1)
			const receipt = io.dataset.find(
				(row) => row._type === 'sanityKitUrlPublication',
			)!
			expect(JSON.parse(receipt.redirectUpdates as string)).toEqual([
				{
					id: 'redirect-1',
					revision: 'redirect-rev',
					source: '/historic',
					oldDestination: '/old',
					newDestination: '/new',
					status: 302,
				},
			])
		},
	)

	it('keeps all historical sources pointing directly to the latest URL after repeated moves', async () => {
		const io = transport([rule({ destination: '/old' })])
		expect(
			await io.controller.publish(await reviewed(io), currentChoice),
		).toEqual({ status: 'published' })
		io.dataset.push(page('drafts.page-1', '/third', 'third-draft-rev'))
		const review = await io.controller.review({
			documentId: 'page-1',
			publishedRevision: 'committed',
			draftRevision: 'third-draft-rev',
		})
		expect(review.status).toBe('ready')
		if (review.status !== 'ready') throw new Error(review.reason)
		expect(
			review.review.affectedRedirects.map((row) => row.source).sort(),
		).toEqual(['/historic', '/old'])
		expect(await io.controller.publish(review.review, currentChoice)).toEqual({
			status: 'published',
		})
		const rules = io.dataset.filter((row) => row._type === 'sanityKitRedirect')
		expect(rules.map((row) => row.source).sort()).toEqual([
			'/historic',
			'/new',
			'/old',
		])
		expect(rules.every((row) => row.destination === '/third')).toBe(true)
	})

	it('leaves disabled history unchanged', async () => {
		const disabled = rule({ destination: '/old', enabled: false })
		const io = transport([disabled])
		const review = await reviewed(io)
		expect(review.affectedRedirects).toEqual([])
		expect(await io.controller.publish(review, currentChoice)).toEqual({
			status: 'published',
		})
		expect(io.dataset.find((row) => row._id === disabled._id)).toEqual(disabled)
	})

	it.each(['drafts.redirect-1', 'versions.release.redirect-1'])(
		'blocks existing alias changes with a pending version %s',
		async (_id) => {
			const io = transport([
				rule({ destination: '/old' }),
				rule({ _id, destination: '/other' }),
			])
			expect(await io.controller.review(requested)).toEqual({
				status: 'blocked',
				reason: 'pending-redirect-change',
				conflict: {
					kind: 'redirect',
					pathname: '/historic',
					documentId: _id,
					schemaType: 'sanityKitRedirect',
					destination: '/other',
				},
			})
			expect(io.action).not.toHaveBeenCalled()
		},
	)

	it('refreshes review if an alias changed after the dialog opened', async () => {
		const io = transport([rule({ destination: '/old' })])
		const review = await reviewed(io)
		io.dataset.find((row) => row._id === 'redirect-1')!._rev = 'changed-alias'
		expect(await io.controller.publish(review, currentChoice)).toEqual({
			status: 'blocked',
			reason: 'review-stale',
		})
		expect(io.action).not.toHaveBeenCalled()
	})

	it('rolls back the whole batch when an alias changes after final review', async () => {
		const io = transport([rule({ destination: '/old' })])
		const review = await reviewed(io)
		io.onAction(() => {
			io.dataset.find((row) => row._id === 'redirect-1')!._rev =
				'changed-before-dispatch'
		})
		expect(await io.controller.publish(review, currentChoice)).toEqual({
			status: 'blocked',
			reason: 'review-stale',
		})
		expect(io.dataset.find((row) => row._id === 'page-1')).toMatchObject({
			pathname: { current: '/old' },
		})
		expect(io.dataset.find((row) => row._id === 'redirect-1')).toMatchObject({
			destination: '/old',
		})
		expect(
			io.dataset.some((row) => row._type === 'sanityKitUrlPublication'),
		).toBe(false)
	})

	it('never overwrites or publishes an alias draft created after final review', async () => {
		const io = transport([rule({ destination: '/old' })])
		const review = await reviewed(io)
		const concurrent = rule({
			_id: 'drafts.redirect-1',
			destination: '/editor-proposal',
			notes: 'Unrelated unpublished changes',
		})
		io.onAction(() => {
			io.dataset.push(concurrent)
		})
		expect(await io.controller.publish(review, currentChoice)).toEqual({
			status: 'blocked',
			reason: 'review-stale',
		})
		expect(io.dataset.find((row) => row._id === 'drafts.redirect-1')).toEqual(
			concurrent,
		)
		expect(io.dataset.find((row) => row._id === 'redirect-1')).toMatchObject({
			destination: '/old',
		})
		expect(io.dataset.find((row) => row._id === 'page-1')).toMatchObject({
			pathname: { current: '/old' },
		})
	})

	it('bounds alias updates before dispatch instead of splitting a publication', async () => {
		const io = transport(
			Array.from({ length: 101 }, (_, index) =>
				rule({
					_id: `alias-${index}`,
					source: `/alias-${index}`,
					destination: '/old',
				}),
			),
		)
		expect(await io.controller.review(requested)).toEqual({
			status: 'blocked',
			reason: 'too-many-redirect-updates',
			limit: {
				kind: 'redirect-updates',
				actual: 101,
				maximum: 100,
				measurement: 'exact',
				phase: 'proposed',
			},
		})
		expect(io.action).not.toHaveBeenCalled()
	})

	it('refuses an oversized action envelope even when the redirect inventory fits', async () => {
		const io = transport(
			Array.from({ length: 100 }, (_, index) =>
				rule({
					_id: `alias-${index}`,
					source: `/alias-${index}-${'a'.repeat(4000)}`,
					destination: '/old',
				}),
			),
		)
		io.dataset[1]!.pathname = { current: `/${'n'.repeat(4000)}` }
		const review = await reviewed(io)
		expect(review.affectedRedirects).toHaveLength(100)
		const result = await io.controller.publish(review, currentChoice)
		expect(result).toMatchObject({
			status: 'blocked',
			reason: 'publication-operation-limit',
			limit: {
				kind: 'publication-bytes',
				maximum: 1_048_576,
				measurement: 'exact',
				phase: 'proposed',
			},
		})
		if (result.status !== 'blocked') throw new Error('Expected blocked result')
		expect(result.limit?.actual).toBeGreaterThan(1_048_576)
		expect(io.action).not.toHaveBeenCalled()
	})

	it('reconciles an exact receipt for alias updates after a lost response', async () => {
		const io = transport([rule({ destination: '/old' })])
		io.failAction('after')
		expect(
			await io.controller.publish(await reviewed(io), currentChoice),
		).toEqual({ status: 'published' })
		expect(io.action).toHaveBeenCalledTimes(1)
		expect(io.dataset.find((row) => row._id === 'redirect-1')).toMatchObject({
			destination: '/new',
		})
	})
})

describe('publication limit diagnostics', () => {
	it('separates a malformed inventory response from a count overflow', async () => {
		const io = transport()
		io.onResponse((query, response) =>
			query.includes('sanityKitRedirect') ? {} : response,
		)
		expect(await io.controller.review(requested)).toEqual({
			status: 'blocked',
			reason: 'redirect-inventory-invalid',
			redirectIssue: 'invalid-envelope',
		})
		expect(io.action).not.toHaveBeenCalled()
	})
	it('preserves the specific invalid rule and its readable identity', async () => {
		const io = transport([
			rule({ source: '/historic', destination: '/historic' }),
		])
		expect(await io.controller.review(requested)).toEqual({
			status: 'blocked',
			reason: 'invalid-before-snapshot',
			redirectIssue: 'self-redirect',
			conflict: {
				kind: 'redirect',
				pathname: '/historic',
				destination: '/historic',
				documentId: 'redirect-1',
				schemaType: 'sanityKitRedirect',
			},
		})
		expect(io.action).not.toHaveBeenCalled()
	})
	it('identifies all active published rules sharing a duplicate source', async () => {
		const io = transport([
			rule({ _id: 'redirect-first', destination: '/first-destination' }),
			rule({ _id: 'redirect-second', destination: '/second-destination' }),
			rule({ _id: 'redirect-third', destination: '/third-destination' }),
			rule({ _id: 'redirect-disabled', enabled: false }),
			rule({ _id: 'drafts.redirect-first' }),
			rule({ _id: 'versions.release.redirect-first' }),
			rule({ _id: 'redirect-unrelated', source: '/unrelated' }),
		])
		const before = structuredClone(io.dataset)
		expect(await io.controller.review(requested)).toEqual({
			status: 'blocked',
			reason: 'invalid-before-snapshot',
			redirectIssue: 'duplicate-source',
			conflict: {
				kind: 'redirect',
				pathname: '/historic',
				destination: '/second-destination',
				documentId: 'redirect-second',
				schemaType: 'sanityKitRedirect',
				relatedRedirects: [
					{
						documentId: 'redirect-first',
						pathname: '/historic',
						destination: '/first-destination',
					},
					{
						documentId: 'redirect-third',
						pathname: '/historic',
						destination: '/third-destination',
					},
				],
			},
		})
		expect(io.action).not.toHaveBeenCalled()
		expect(io.dataset).toEqual(before)
	})
	it.each([
		[
			{ source: 'relative/path' },
			'invalid-source',
			'Source URL',
			'relative/path',
		],
		[{ source: 42 }, 'invalid-source', 'Source URL', '42'],
		[
			{ destination: '/target?query=1' },
			'invalid-destination',
			'Destination URL',
			'/target?query=1',
		],
		[{ status: 307 }, 'unsupported-status', 'Status', '307'],
		[{ enabled: null }, 'invalid-record', 'Enabled', 'Not set'],
		[{ source: null }, 'invalid-source', 'Source URL', 'Not set'],
		[{ _rev: null }, 'invalid-record', 'Record revision', 'Not set'],
	] as const)(
		'reports field evidence for %s',
		async (extra, issue, field, value) => {
			const io = transport([rule(extra)])
			const result = await io.controller.review(requested)
			expect(result).toMatchObject({
				status: 'blocked',
				redirectIssue: issue,
				conflict: {
					documentId: 'redirect-1',
					fieldIssues: [
						{ field, value, message: expect.any(String) as unknown },
					],
				},
			})
			if (result.status !== 'blocked')
				throw new Error('Expected blocked review')
			if ('source' in extra && typeof extra.source !== 'string')
				expect(result.conflict?.pathname).toBe('Source URL unavailable')
			expect(io.action).not.toHaveBeenCalled()
		},
	)
	it.each([
		['relative', 'Start this URL path with /.'],
		[
			'/target?query=1',
			'Remove the query string beginning with ? from this URL path.',
		],
		[
			'/target#part',
			'Remove the fragment beginning with # from this URL path.',
		],
		[
			'/path//child',
			'Use one / between path segments; remove repeated slashes.',
		],
		['/path/', 'Remove the trailing / from this URL path.'],
		[
			'/path with spaces',
			'Remove spaces and other whitespace from this URL path.',
		],
		[
			'/bad%2Fsegment',
			'Remove encoded slash or backslash characters from this URL path.',
		],
		['/bad%zz', 'Correct the invalid percent encoding in this URL path.'],
	] as const)(
		'explains the specific invalid destination %s',
		async (destination, message) => {
			const io = transport([rule({ destination })])
			expect(await io.controller.review(requested)).toMatchObject({
				status: 'blocked',
				redirectIssue: 'invalid-destination',
				conflict: {
					fieldIssues: [
						{ field: 'Destination URL', value: destination, message },
					],
				},
			})
			expect(io.action).not.toHaveBeenCalled()
		},
	)
	it('identifies missing fields without serializing unsupported nested values', async () => {
		const io = transport()
		io.onResponse((query, response) =>
			query.includes('sanityKitRedirect')
				? [
						{
							_id: 'redirect-1',
							_type: 'sanityKitRedirect',
							_rev: 'r',
							enabled: true,
							destination: { secret: 'never include this' },
							status: 301,
						},
					]
				: response,
		)
		const result = await io.controller.review(requested)
		expect(result).toMatchObject({
			status: 'blocked',
			redirectIssue: 'invalid-record',
			conflict: {
				documentId: 'redirect-1',
				pathname: 'Source URL unavailable',
				fieldIssues: [
					{ field: 'Source URL', value: 'Not set' },
					{ field: 'Destination URL', value: 'Unsupported object value' },
				],
			},
		})
		expect(JSON.stringify(result)).not.toContain('never include this')
		expect(io.action).not.toHaveBeenCalled()
	})
	it('bounds malformed field text while retaining a safe redirect identity', async () => {
		const io = transport([rule({ source: 'relative'.repeat(100) })])
		const result = await io.controller.review(requested)
		if (result.status !== 'blocked') throw new Error('Expected blocked review')
		expect(result.conflict?.pathname).toHaveLength(240)
		expect(result.conflict?.fieldIssues?.[0]?.value).toHaveLength(240)
		expect(result.conflict?.documentId).toBe('redirect-1')
		expect(io.action).not.toHaveBeenCalled()
	})
	it.each([
		null,
		{},
		rule({ _id: '../private', source: null }),
		rule({ _type: 'unexpected', source: null }),
	])(
		'does not invent a clickable redirect for malformed identity %s',
		async (bad) => {
			const io = transport()
			io.onResponse((query, response) =>
				query.includes('sanityKitRedirect') ? [bad] : response,
			)
			const result = await io.controller.review(requested)
			expect(result).toMatchObject({
				status: 'blocked',
				reason: 'invalid-inventory',
			})
			expect(result).not.toHaveProperty('conflict')
			expect(io.action).not.toHaveBeenCalled()
		},
	)
	it('shows a chain in path order, including incoming branches, and its final destination', async () => {
		const io = transport([
			rule({ _id: 'a', source: '/a', destination: '/b' }),
			rule({ _id: 'c', source: '/c', destination: '/final' }),
			rule({ _id: 'b', source: '/b', destination: '/c' }),
			rule({ _id: 'z', source: '/incoming', destination: '/a' }),
			rule({
				_id: 'disabled',
				source: '/disabled',
				destination: '/a',
				enabled: false,
			}),
			rule({ _id: 'drafts.a', source: '/draft', destination: '/a' }),
			rule({
				_id: 'versions.release.a',
				source: '/release',
				destination: '/a',
			}),
			rule({ _id: 'unrelated', source: '/other', destination: '/elsewhere' }),
		])
		const result = await io.controller.review(requested)
		expect(result).toMatchObject({
			status: 'blocked',
			redirectIssue: 'redirect-chain',
			conflict: {
				documentId: 'a',
				finalDestination: '/final',
				relatedRedirects: [
					{ documentId: 'b' },
					{ documentId: 'c' },
					{ documentId: 'z' },
				],
			},
		})
		expect(io.action).not.toHaveBeenCalled()
	})
	it('shows every loop member once and does not invent a final destination', async () => {
		const io = transport([
			rule({ _id: 'a', source: '/a', destination: '/c' }),
			rule({ _id: 'b', source: '/b', destination: '/a' }),
			rule({ _id: 'c', source: '/c', destination: '/b' }),
		])
		const result = await io.controller.review(requested)
		expect(result).toMatchObject({
			status: 'blocked',
			redirectIssue: 'redirect-cycle',
			conflict: {
				documentId: 'a',
				relatedRedirects: [{ documentId: 'c' }, { documentId: 'b' }],
			},
		})
		if (result.status !== 'blocked') throw new Error('Expected blocked review')
		expect(result.conflict).not.toHaveProperty('finalDestination')
		expect(io.action).not.toHaveBeenCalled()
	})
	it('identifies the redirect using an application-reserved source', async () => {
		const io = transport([rule({ source: '/api' })])
		expect(await io.controller.review(requested)).toMatchObject({
			status: 'blocked',
			redirectIssue: 'reserved-source',
			conflict: { documentId: 'redirect-1', pathname: '/api' },
		})
		expect(io.action).not.toHaveBeenCalled()
	})
	it('lists published pages occupying a redirect source, with revision-checked titles', async () => {
		const io = transport([
			rule({ source: '/taken' }),
			{ ...page('owner-1', '/taken', 'owner-rev-1'), title: 'First owner' },
			{ ...page('owner-2', '/taken', 'owner-rev-2'), title: 'Second owner' },
			page('drafts.owner-1', '/taken', 'draft-rev-1'),
			page('versions.release.owner-1', '/taken', 'release-rev-1'),
		])
		const result = await io.controller.review(requested)
		expect(result).toMatchObject({
			status: 'blocked',
			redirectIssue: 'occupied-source',
			conflict: {
				documentId: 'redirect-1',
				relatedPages: [
					{
						documentId: 'owner-1',
						pathname: '/taken',
						schemaType: 'page',
						title: 'First owner',
					},
					{
						documentId: 'owner-2',
						pathname: '/taken',
						schemaType: 'page',
						title: 'Second owner',
					},
				],
			},
		})
		expect(
			io.fetch.mock.calls
				.filter(([query]) => query.includes('_rev == $revision'))
				.map(([, params]) => params),
		).toEqual([
			{ id: 'owner-1', revision: 'owner-rev-1' },
			{ id: 'owner-2', revision: 'owner-rev-2' },
		])
		expect(io.action).not.toHaveBeenCalled()
	})
	it('uses the resolved collection pathname and configured title field for an occupying page', async () => {
		const io = transport([
			rule({ source: '/journal/story' }),
			{
				_id: 'post-owner',
				_type: 'post',
				_rev: 'post-rev',
				slug: { current: 'story' },
				heading: 'Article owner',
			},
		])
		const controller = createUrlPublicationController(
			{
				...routes,
				collections: [
					{
						name: 'journal',
						title: 'Journal',
						index: { schemaType: 'page', pathname: '/journal' },
						routePrefix: '/journal',
						items: [
							{
								schemaType: 'post',
								slugField: 'slug.current',
								titleField: 'heading',
							},
						],
					},
				],
			},
			io.client,
		)
		expect(await controller.review(requested)).toMatchObject({
			status: 'blocked',
			redirectIssue: 'occupied-source',
			conflict: {
				pathname: '/journal/story',
				relatedPages: [
					{
						documentId: 'post-owner',
						pathname: '/journal/story',
						schemaType: 'post',
						title: 'Article owner',
					},
				],
			},
		})
		expect(io.action).not.toHaveBeenCalled()
	})
	it('omits a stale page title while keeping its reviewed ownership identity', async () => {
		const io = transport([
			rule({ source: '/taken' }),
			page('owner', '/taken', 'owner-rev'),
		])
		io.onQuery((query) => {
			if (query.includes('_rev == $revision'))
				io.dataset.find((row) => row._id === 'owner')!._rev = 'newer-rev'
		})
		const result = await io.controller.review(requested)
		expect(result).toMatchObject({
			status: 'blocked',
			redirectIssue: 'occupied-source',
			conflict: {
				relatedPages: [
					{ documentId: 'owner', pathname: '/taken', schemaType: 'page' },
				],
			},
		})
		if (result.status !== 'blocked') throw new Error('Expected blocked review')
		expect(result.conflict?.relatedPages?.[0]).not.toHaveProperty('title')
		expect(io.action).not.toHaveBeenCalled()
	})
	it('keeps occupied-source blockers if a page label cannot be loaded', async () => {
		const io = transport([
			rule({ source: '/taken' }),
			page('owner', '/taken', 'owner-rev'),
		])
		io.onQuery((query) => {
			if (query.includes('_rev == $revision'))
				throw new Error('Label unavailable')
		})
		expect(await io.controller.review(requested)).toMatchObject({
			status: 'blocked',
			redirectIssue: 'occupied-source',
			conflict: {
				relatedPages: [
					{ documentId: 'owner', pathname: '/taken', schemaType: 'page' },
				],
			},
		})
		expect(io.action).not.toHaveBeenCalled()
	})
	it('does not expose redirect diagnostics when complete read access cannot be confirmed', async () => {
		const io = transport([
			rule({ source: '/taken' }),
			page('owner', '/taken', 'owner-rev'),
		])
		io.grants([{ filter: '_type == "page"', permissions: ['read'] }])
		const result = await io.controller.review(requested)
		expect(result).toMatchObject({
			status: 'blocked',
			reason: 'unknown-read-access',
		})
		expect(result).not.toHaveProperty('conflict')
		expect(io.fetch).not.toHaveBeenCalled()
		expect(io.action).not.toHaveBeenCalled()
	})
	it('carries a bounded byte count to review without dispatching a publication', async () => {
		const io = transport([
			rule({ enabled: false, origin: 'x'.repeat(1_048_626) }),
		])
		const result = await io.controller.review(requested)
		expect(result).toMatchObject({
			status: 'blocked',
			reason: 'inventory-limit',
			limit: {
				kind: 'redirect-bytes',
				maximum: 1_048_576,
				measurement: 'at-least',
				phase: 'current',
			},
		})
		if (result.status !== 'blocked') throw new Error('Expected blocked review')
		expect(result.limit?.actual).toBeGreaterThan(1_048_576)
		expect(io.action).not.toHaveBeenCalled()
	})
})
