import * as pendingStore from '../../src/studio/collections/prefix-pending.js'
import { evaluate, parse } from 'groq-js'
import { describe, it, expect, vi } from 'vitest'
import {
	createCollectionSettingsPublicationController,
	type CollectionSettingsPublicationRequest,
} from '../../src/studio/collections/settings-publication-write.js'
import {
	createCollectionPrefixController,
	type CollectionPrefixWriteAccessRequest,
	type CollectionPrefixWriteAccessAnswer,
} from '../../src/studio/collections/prefix-write.js'
import {
	rememberPendingCollectionPrefix,
	readPendingCollectionPrefix,
	settlePendingCollectionPrefix,
} from '../../src/studio/collections/prefix-pending.js'
import type { CollectionPrefixReadAccessRequest } from '../../src/studio/collections/prefix-review.js'
import {
	configuration,
	setting,
	post,
	page,
} from './collection-prefix-fixtures.js'
let sequence = 0
function setup(mode: 'first' | 'unchanged' | 'locked' = 'first') {
	const config = structuredClone({
		...configuration,
		collections: configuration.collections!.map((collection) =>
			mode === 'locked'
				? {
						...collection,
						routePrefix: { mode: 'locked' as const, value: '/journal' },
					}
				: collection,
		),
	})
	let rows: Record<string, unknown>[] = [
		setting('drafts.journal-settings', '/journal', 'draft-settings'),
		post(),
	]
	if (mode === 'unchanged') rows.push(setting())
	const scope = {
		projectId: `settingswrite${++sequence}`,
		dataset: 'development',
	}
	const saved = new Map<string, string>()
	const storage = {
		getItem: vi.fn((key: string) => saved.get(key) ?? null),
		setItem: vi.fn((key: string, value: string) => {
			saved.set(key, value)
		}),
		removeItem: vi.fn((key: string) => {
			saved.delete(key)
		}),
	}
	const confirmReadAccess = vi.fn(
		(request: CollectionPrefixReadAccessRequest) =>
			Promise.resolve(
				request.requirements.map(({ key }) => ({
					key,
					status: 'granted' as const,
				})),
			),
	)
	const authorize = vi.fn(
		async (
			request: CollectionPrefixWriteAccessRequest,
		): Promise<CollectionPrefixWriteAccessAnswer> => {
			await Promise.resolve()
			return {
				receiptRead: 'granted' as const,
				targets: request.targets.map(({ key }) => ({
					key,
					status: 'granted' as const,
				})),
			}
		},
	)
	let beforeWrite: (() => void) | undefined
	let outcome: 'ok' | 'lost-after' | 'lost-before' | 'bad-response' = 'ok'
	const request = vi.fn(
		async (options: CollectionSettingsPublicationRequest): Promise<unknown> => {
			await Promise.resolve()
			if (options.method !== 'POST') {
				const ids = options.url
					.split('/')
					.at(-1)!
					.split(',')
					.map(decodeURIComponent)
				return {
					documents: structuredClone(
						rows.filter((row) => ids.includes(String(row._id))),
					),
				}
			}
			beforeWrite?.()
			if (outcome === 'lost-before') throw Error('Network lost')
			const next = structuredClone(rows)
			const fail = () => {
				throw Object.assign(Error('Conflict'), { statusCode: 409 })
			}
			const body = options.body!
			if ('mutations' in body) {
				for (const mutation of body.mutations) {
					if ('patch' in mutation) {
						const patch = mutation.patch as {
							id: string
							ifRevisionID: string
							set: Record<string, unknown>
						}
						const existing = next.find((row) => row._id === patch.id)
						if (!existing || existing._rev !== patch.ifRevisionID) fail()
						Object.assign(existing!, patch.set)
					} else if ('create' in mutation) {
						if (next.some((row) => row._id === mutation.create._id)) fail()
						next.push({ ...mutation.create, _rev: 'created' })
					} else if ('delete' in mutation) {
						const index = next.findIndex(
							(row) => row._id === (mutation.delete as { id: string }).id,
						)
						if (index >= 0) next.splice(index, 1)
					} else throw Error('Unexpected mutation')
				}
			} else {
				for (const action of body.actions) {
					if (action.actionType === 'sanity.action.document.create') {
						if (next.some((row) => row._id === action.attributes._id)) fail()
						next.push({ ...action.attributes, _rev: 'created' })
					} else if (action.actionType === 'sanity.action.document.publish') {
						const draft = next.find((row) => row._id === action.draftId)
						const live = next.find((row) => row._id === action.publishedId)
						if (
							!draft ||
							(action.ifDraftRevisionId &&
								draft._rev !== action.ifDraftRevisionId) ||
							(action.ifPublishedRevisionId &&
								live?._rev !== action.ifPublishedRevisionId)
						)
							fail()
						const index = next.findIndex(
							(row) => row._id === action.publishedId,
						)
						if (index >= 0) next.splice(index, 1)
						next.push({ ...draft!, _id: action.publishedId, _rev: 'published' })
						next.splice(
							next.findIndex((row) => row._id === action.draftId),
							1,
						)
					} else throw Error('Unexpected action')
				}
			}
			rows = next
			if (outcome === 'lost-after') throw Error('Network lost')
			return outcome === 'bad-response'
				? {}
				: { transactionId: body.transactionId }
		},
	)
	const fetch = vi.fn(
		async (
			query: string,
			params: Record<string, unknown>,
		): Promise<unknown> => {
			const result = await evaluate(parse(query), {
				dataset: structuredClone(rows),
				params,
			})
			return result.get()
		},
	)
	const client = {
		withConfig: vi.fn(() => ({ config: () => scope, fetch, request })),
	}
	const options = {
		configuration: config,
		confirmReadAccess,
		authorize,
		recoveryStorage: storage,
	}
	const make = () =>
		createCollectionSettingsPublicationController(options, client)
	const controller = make()
	const choice = { collection: 'journal', draftRevision: 'draft-settings' }
	async function ready() {
		const result = await controller.review(choice)
		expect(result.status).toBe('ready')
		if (result.status !== 'ready') throw Error(result.reason)
		return result.review
	}
	return {
		config,
		scope,
		saved,
		storage,
		confirmReadAccess,
		authorize,
		request,
		fetch,
		client,
		options,
		controller,
		choice,
		make,
		ready,
		get rows() {
			return rows
		},
		set rows(value) {
			rows = value
		},
		set beforeWrite(value: (() => void) | undefined) {
			beforeWrite = value
		},
		set outcome(value: typeof outcome) {
			outcome = value
		},
	}
}
const dispatches = (s: ReturnType<typeof setup>) =>
	s.request.mock.calls.filter(([request]) => request.method === 'POST')
describe('collection settings publication writer', () => {
	it('atomically activates first settings without changing items or creating redirects', async () => {
		const s = setup()
		s.rows[0]!.custom = { nested: ['preserved'] }
		const originalItem = structuredClone(s.rows[1])
		const review = await s.ready()
		expect(review.classification).toMatchObject({
			kind: 'first-publication',
			activatesUrls: true,
		})
		expect(review.activation?.plan).toBeDefined()
		expect(
			await s.controller.publish(review, { isCurrent: () => true }),
		).toMatchObject({ status: 'published' })
		expect(s.rows.find((row) => row._id === 'journal-settings')).toMatchObject({
			custom: { nested: ['preserved'] },
		})
		expect(
			s.rows.find((row) => row._id === 'drafts.journal-settings'),
		).toBeUndefined()
		expect(s.rows.find((row) => row._id === 'post-1')).toEqual(originalItem)
		expect(s.rows.filter((row) => row._type === 'sanityKitRedirect')).toEqual(
			[],
		)
		expect(dispatches(s)[0]![0].url).toContain('/data/mutate/')
		expect(s.controller.getPending()).toBeNull()
	})
	it('uses guarded Actions to publish same-prefix metadata and the complete draft', async () => {
		const s = setup('unchanged')
		s.rows[0]!.displayName = 'Articles'
		s.rows[0]!.custom = 'kept'
		const review = await s.ready()
		expect(review.activation).toBeUndefined()
		expect(s.fetch).not.toHaveBeenCalled()
		expect(
			await s.controller.publish(review, { isCurrent: () => true }),
		).toMatchObject({ status: 'published' })
		const body = dispatches(s)[0]![0].body!
		expect('actions' in body && body.actions[0]).toMatchObject({
			ifPublishedRevisionId: 'live-settings',
			ifDraftRevisionId: 'draft-settings',
		})
		expect(s.rows.find((row) => row._id === 'journal-settings')).toMatchObject({
			displayName: 'Articles',
			custom: 'kept',
		})
	})
	it('does not activate code-locked URLs on initial metadata publishing', async () => {
		const s = setup('locked')
		const review = await s.ready()
		expect(review.classification).toMatchObject({
			kind: 'first-publication',
			activatesUrls: false,
			prefixOwnership: 'locked',
		})
		expect(s.fetch).not.toHaveBeenCalled()
		expect(
			await s.controller.publish(review, { isCurrent: () => true }),
		).toMatchObject({ status: 'published' })
	})
	it('matches native initial publishing of nested custom references', async () => {
		const s = setup()
		s.rows[0]!.custom = {
			values: [
				{
					_type: 'reference',
					_ref: 'a',
					_weak: true,
					_strengthenOnPublish: {},
				},
				{
					_type: 'reference',
					_ref: 'b',
					_weak: true,
					_strengthenOnPublish: { weak: true },
				},
				{ _type: 'reference', _ref: 'c', _weak: true },
			],
		}
		await s.controller.publish(await s.ready(), { isCurrent: () => true })
		expect(
			s.rows.find((row) => row._id === 'journal-settings')!.custom,
		).toEqual({
			values: [
				{ _type: 'reference', _ref: 'a' },
				{ _type: 'reference', _ref: 'b', _weak: true },
				{ _type: 'reference', _ref: 'c', _weak: true },
			],
		})
	})
	it('routes an actual prefix move to the existing review instead', async () => {
		const s = setup('unchanged')
		s.rows[0]!.prefix = { _type: 'slug', current: '/blog' }
		expect(await s.controller.review(s.choice)).toMatchObject({
			status: 'blocked',
			reason: 'prefix-review-required',
		})
		expect(dispatches(s)).toHaveLength(0)
	})
	it('blocks collisions on first activation', async () => {
		const s = setup()
		s.rows.push(page('conflict', '/journal/alpha'))
		expect(await s.controller.review(s.choice)).toMatchObject({
			status: 'blocked',
		})
		expect(s.authorize).not.toHaveBeenCalled()
	})
	it('rechecks activation when a new conflicting page appears', async () => {
		const s = setup()
		const review = await s.ready()
		s.rows.push(page('conflict', '/journal/alpha'))
		expect(
			await s.controller.publish(review, { isCurrent: () => true }),
		).toMatchObject({ status: 'blocked' })
		expect(dispatches(s)).toHaveLength(0)
	})
	it.each(['draft', 'published'] as const)(
		'rejects changed %s revision before dispatch',
		async (version) => {
			const s = setup('unchanged')
			const review = await s.ready()
			s.rows.find(
				(row) =>
					row._id ===
					(version === 'draft'
						? 'drafts.journal-settings'
						: 'journal-settings'),
			)!._rev = 'changed'
			expect(
				await s.controller.publish(review, { isCurrent: () => true }),
			).toMatchObject({ status: 'blocked' })
			expect(dispatches(s)).toHaveLength(0)
		},
	)
	it('atomically rejects a concurrent first publication', async () => {
		const s = setup()
		const review = await s.ready()
		s.beforeWrite = () => {
			s.rows.push(setting('journal-settings', '/other', 'concurrent'))
		}
		expect(
			await s.controller.publish(review, { isCurrent: () => true }),
		).toMatchObject({ status: 'rejected', reason: 'conflict' })
		expect(s.rows.find((row) => row._id === 'journal-settings')!._rev).toBe(
			'concurrent',
		)
		expect(s.rows.some((row) => row._id === 'drafts.journal-settings')).toBe(
			true,
		)
		expect(
			s.rows.some(
				(row) => row._type === 'sanityKitCollectionSettingsPublication',
			),
		).toBe(false)
	})
	it.each(['first', 'unchanged'] as const)(
		'guards draft changes after review for %s publish',
		async (mode) => {
			const s = setup(mode)
			const review = await s.ready()
			s.beforeWrite = () => {
				s.rows[0]!._rev = 'concurrent'
			}
			expect(
				await s.controller.publish(review, { isCurrent: () => true }),
			).toMatchObject({ status: 'rejected', reason: 'conflict' })
			expect(
				s.rows.some(
					(row) => row._type === 'sanityKitCollectionSettingsPublication',
				),
			).toBe(false)
		},
	)
	it('guards concurrent changes to existing live settings', async () => {
		const s = setup('unchanged')
		const review = await s.ready()
		s.beforeWrite = () => {
			s.rows.find((row) => row._id === 'journal-settings')!._rev = 'concurrent'
		}
		expect(
			await s.controller.publish(review, { isCurrent: () => true }),
		).toMatchObject({ status: 'rejected', reason: 'conflict' })
	})
	it('does not interpret unreadable published settings as absent', async () => {
		const s = setup()
		s.confirmReadAccess.mockResolvedValue([])
		expect(await s.controller.review(s.choice)).toMatchObject({
			status: 'blocked',
			reason: 'read-access-unverified',
		})
		expect(s.request).not.toHaveBeenCalled()
	})
	it('checks access again after reading settings', async () => {
		const s = setup('unchanged')
		s.confirmReadAccess
			.mockResolvedValueOnce([{ key: 'settings:exact', status: 'granted' }])
			.mockResolvedValueOnce([])
		expect(await s.controller.review(s.choice)).toMatchObject({
			status: 'blocked',
			reason: 'read-access-unverified',
		})
	})
	it('requires a fresh write authorization before dispatch', async () => {
		const s = setup()
		const review = await s.ready()
		s.authorize.mockImplementationOnce((request) =>
			Promise.resolve({
				receiptRead: 'granted',
				targets: request.targets.map(({ key }) => ({
					key,
					status: 'missing',
				})),
			}),
		)
		expect(
			await s.controller.publish(review, { isCurrent: () => true }),
		).toMatchObject({ status: 'blocked', reason: 'write-access-missing' })
		expect(dispatches(s)).toHaveLength(0)
	})
	it("refuses copied or another instance's reviews", async () => {
		const s = setup()
		const review = await s.ready()
		expect(
			await s.make().publish(review, { isCurrent: () => true }),
		).toMatchObject({ reason: 'invalid-review' })
		expect(
			await s.controller.publish({ ...review }, { isCurrent: () => true }),
		).toMatchObject({ reason: 'invalid-review' })
	})
	it('cancels before dispatch and refuses a stale UI choice', async () => {
		const s = setup()
		const review = await s.ready()
		const abort = new AbortController()
		abort.abort()
		expect(
			await s.controller.publish(review, {
				isCurrent: () => true,
				signal: abort.signal,
			}),
		).toMatchObject({ reason: 'aborted' })
		expect(
			await s.controller.publish(review, { isCurrent: () => false }),
		).toMatchObject({ reason: 'review-stale' })
		expect(dispatches(s)).toHaveLength(0)
	})
	it('confirms a lost successful response using the exact receipt', async () => {
		const s = setup()
		const review = await s.ready()
		s.outcome = 'lost-after'
		expect(
			await s.controller.publish(review, { isCurrent: () => true }),
		).toMatchObject({ status: 'published' })
		expect(dispatches(s)).toHaveLength(1)
	})
	it('retains unknown outcomes across controllers and never resubmits', async () => {
		const s = setup()
		const review = await s.ready()
		s.outcome = 'lost-before'
		expect(
			await s.controller.publish(review, { isCurrent: () => true }),
		).toMatchObject({ status: 'unknown' })
		const reopened = s.make()
		expect(reopened.getPending()?._type).toBe(
			'sanityKitCollectionSettingsPublication',
		)
		expect(await reopened.reconcile()).toMatchObject({ status: 'unknown' })
		expect(await reopened.review(s.choice)).toMatchObject({
			reason: 'outcome-unknown',
		})
		expect(dispatches(s)).toHaveLength(1)
	})
	it('blocks prefix controller and refuses wrong-kind recovery', async () => {
		const s = setup()
		s.outcome = 'lost-before'
		await s.controller.publish(await s.ready(), { isCurrent: () => true })
		const prefix = createCollectionPrefixController(s.options, s.client)
		expect(prefix.getPending()?._type).toBe(
			'sanityKitCollectionSettingsPublication',
		)
		expect(await prefix.reconcile()).toMatchObject({
			reason: 'other-publication-pending',
		})
	})
	it('blocks on an old-format pending prefix receipt and preserves recovery data', async () => {
		const s = setup()
		const operationId = crypto.randomUUID()
		const receipt = {
			_id: `sanityKit.collectionPrefixPublication.${operationId}`,
			_type: 'sanityKitCollectionPrefixPublication' as const,
			operationId,
			oldPrefix: '/journal',
			newPrefix: '/blog',
			createRedirects: true,
			evidence: '{}',
		}
		rememberPendingCollectionPrefix(s.scope, { receipt }, s.storage)
		expect(await s.controller.review(s.choice)).toMatchObject({
			reason: 'outcome-unknown',
		})
		expect(await s.controller.reconcile()).toMatchObject({
			reason: 'other-publication-pending',
		})
		expect(readPendingCollectionPrefix(s.scope, s.storage)?.receipt).toEqual(
			receipt,
		)
	})
	it('requires reload-safe receipt storage before dispatch', async () => {
		const s = setup()
		const review = await s.ready()
		s.storage.setItem.mockImplementation(() => {
			throw Error('Unavailable')
		})
		expect(
			await s.controller.publish(review, { isCurrent: () => true }),
		).toMatchObject({ reason: 'recovery-unavailable' })
		expect(dispatches(s)).toHaveLength(0)
	})
	it('rejects malformed settings evidence and missing drafts', async () => {
		const s = setup()
		s.rows[0]!.collection = 'wrong'
		expect(await s.controller.review(s.choice)).toMatchObject({
			reason: 'invalid-settings',
		})
		s.rows = []
		expect(await s.controller.review(s.choice)).toMatchObject({
			reason: 'missing-draft',
		})
	})
	it('does not let a release draft be passed as an ordinary settings draft', async () => {
		const s = setup()
		s.rows.push(setting('versions.release.journal-settings'))
		expect(await s.controller.review(s.choice)).toMatchObject({
			status: 'blocked',
		})
	})
	it('rejects malformed receipt records loaded from storage', async () => {
		const s = setup()
		s.saved.set(
			`sanity-kit.collection-prefix:${JSON.stringify([s.scope.projectId, s.scope.dataset])}`,
			JSON.stringify({
				_type: 'sanityKitCollectionSettingsPublication',
				prefix: '/journal',
			}),
		)
		expect(await s.controller.review(s.choice)).toMatchObject({
			reason: 'recovery-invalid',
		})
	})
	it('keeps settlement tied to the attempted operation when a newer one becomes pending', async () => {
		const s = setup()
		s.outcome = 'lost-before'
		const review = await s.ready()
		await s.controller.publish(review, { isCurrent: () => true })
		const first = readPendingCollectionPrefix(s.scope, s.storage)!
		settlePendingCollectionPrefix(
			s.scope,
			first,
			{ status: 'published', operationId: review.operationId },
			s.storage,
		)
		const operationId = crypto.randomUUID()
		const receipt = {
			...first.receipt,
			_id: `sanityKit.collectionSettingsPublication.${operationId}`,
			operationId,
		}
		rememberPendingCollectionPrefix(s.scope, { receipt }, s.storage)
		expect(s.controller.getPending()?.operationId).toBe(operationId)
		expect(await s.controller.reconcile(review.operationId)).toEqual({
			status: 'published',
			operationId: review.operationId,
		})
		expect(
			readPendingCollectionPrefix(s.scope, s.storage)?.receipt.operationId,
		).toBe(operationId)
		expect(await s.controller.reconcile('unknown-operation')).toMatchObject({
			reason: 'no-pending-publish',
		})
	})
	it('bounds completed settings recovery history while keeping the newest exact outcome', async () => {
		const s = setup()
		s.outcome = 'lost-before'
		const review = await s.ready()
		await s.controller.publish(review, { isCurrent: () => true })
		const original = readPendingCollectionPrefix(s.scope, s.storage)!
		settlePendingCollectionPrefix(
			s.scope,
			original,
			{ status: 'published', operationId: review.operationId },
			s.storage,
		)
		s.controller.getPending()
		let latest = review.operationId
		for (let i = 0; i < COLLECTION_COMPLETED_ATTEMPT_LIMIT; i++) {
			latest = crypto.randomUUID()
			const next = {
				receipt: {
					...original.receipt,
					_id: `sanityKit.collectionSettingsPublication.${latest}`,
					operationId: latest,
				},
			}
			rememberPendingCollectionPrefix(s.scope, next, s.storage)
			s.controller.getPending()
			settlePendingCollectionPrefix(
				s.scope,
				next,
				{ status: 'published', operationId: latest },
				s.storage,
			)
			s.controller.getPending()
		}
		expect(await s.controller.reconcile(latest)).toEqual({
			status: 'published',
			operationId: latest,
		})
		expect(await s.controller.reconcile()).toEqual({
			status: 'published',
			operationId: latest,
		})
		expect(await s.controller.reconcile(review.operationId)).toMatchObject({
			reason: 'no-pending-publish',
		})
	})
	it('loads a settings-only receipt from serialized recovery storage', async () => {
		const s = setup()
		const operationId = crypto.randomUUID()
		const receipt = {
			_id: `sanityKit.collectionSettingsPublication.${operationId}`,
			_type: 'sanityKitCollectionSettingsPublication',
			operationId,
			documentId: 'journal-settings',
			collection: 'journal',
			draftRevision: 'draft-settings',
			publishedRevision: null,
			prefix: '/journal',
			activatesUrls: true,
			evidence: '{}',
		}
		s.saved.set(
			`sanity-kit.collection-prefix:${JSON.stringify([s.scope.projectId, s.scope.dataset])}`,
			JSON.stringify(receipt),
		)
		s.rows.push(receipt)
		expect(s.controller.getPending()).toEqual(receipt)
		expect(await s.controller.reconcile(operationId)).toEqual({
			status: 'published',
			operationId,
		})
	})
	it('allows same-prefix metadata publishing with an independent release version', async () => {
		const s = setup('unchanged')
		s.rows.push(setting('versions.release.journal-settings'))
		expect(
			await s.controller.publish(await s.ready(), { isCurrent: () => true }),
		).toMatchObject({ status: 'published' })
		expect(
			s.rows.some((row) => row._id === 'versions.release.journal-settings'),
		).toBe(true)
	})
	it('keeps a failed recovery read unknown after the write was sent', async () => {
		const s = setup()
		const review = await s.ready()
		const pendingRead = vi.spyOn(pendingStore, 'readPendingCollectionPrefix')
		try {
			s.outcome = 'lost-before'
			s.beforeWrite = () => {
				pendingRead.mockImplementationOnce(() => {
					throw Error('Corrupt recovery')
				})
			}
			expect(
				await s.controller.publish(review, { isCurrent: () => true }),
			).toEqual({ status: 'unknown', operationId: review.operationId })
			expect(dispatches(s)).toHaveLength(1)
		} finally {
			pendingRead.mockRestore()
		}
	})

	it.each(['/journal/', '/journal//posts', '/' + 'x'.repeat(2048), '/'])(
		'rejects a noncanonical recovered settings prefix %s',
		async (prefix) => {
			const s = setup()
			const operationId = crypto.randomUUID()
			const receipt = {
				_id: `sanityKit.collectionSettingsPublication.${operationId}`,
				_type: 'sanityKitCollectionSettingsPublication',
				operationId,
				documentId: 'journal-settings',
				collection: 'journal',
				draftRevision: 'draft-settings',
				publishedRevision: null,
				prefix,
				activatesUrls: true,
				evidence: '{}',
			}
			s.saved.set(
				`sanity-kit.collection-prefix:${JSON.stringify([s.scope.projectId, s.scope.dataset])}`,
				JSON.stringify(receipt),
			)
			expect(await s.controller.review(s.choice)).toMatchObject({
				reason: 'recovery-invalid',
			})
		},
	)
})
import { COLLECTION_COMPLETED_ATTEMPT_LIMIT } from '../../src/studio/collections/prefix-attempts.js'
