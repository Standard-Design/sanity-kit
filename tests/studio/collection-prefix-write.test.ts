import * as pendingStore from '../../src/studio/collections/prefix-pending.js'
import {
	readPendingCollectionPrefix,
	rememberPendingCollectionPrefix,
	settlePendingCollectionPrefix,
} from '../../src/studio/collections/prefix-pending.js'
import { evaluate, parse } from 'groq-js'
import {
	createCollectionPublicationAttempts,
	COLLECTION_COMPLETED_ATTEMPT_LIMIT,
} from '../../src/studio/collections/prefix-attempts.js'
import { describe, it, expect, vi } from 'vitest'
import {
	createCollectionPrefixController,
	type CollectionPrefixRequest,
	type CollectionPrefixWriteAccessRequest,
	type CollectionPrefixWriteAccessAnswer,
	type CollectionPrefixPublishReview,
} from '../../src/studio/collections/prefix-write.js'
import type { CollectionPrefixReadAccessRequest } from '../../src/studio/collections/prefix-review.js'
import {
	configuration,
	choice,
	inventory,
	setting,
	post,
	page,
	redirect,
} from './collection-prefix-fixtures.js'
let sequence = 0
const record = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === 'object' && !Array.isArray(value)
function setup() {
	const input = inventory()
	let rows = structuredClone([
		...input.settings,
		...input.documents,
		...input.redirects,
	]) as Record<string, unknown>[]
	const scope = { projectId: `writeproof${++sequence}`, dataset: 'development' }
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
		(
			request: CollectionPrefixWriteAccessRequest,
		): Promise<CollectionPrefixWriteAccessAnswer> =>
			Promise.resolve({
				receiptRead: 'granted',
				targets: request.targets.map(({ key }) => ({ key, status: 'granted' })),
			}),
	)
	let outcome: 'ok' | 'lost-after' | 'lost-before' | 'bad-response' = 'ok'
	let beforeWrite: (() => void) | undefined
	const request = vi.fn(
		async (options: CollectionPrefixRequest): Promise<unknown> => {
			await Promise.resolve()
			if (options.method !== 'POST') {
				const ids = options.url
					.split('/')
					.at(-1)!
					.split(',')
					.map(decodeURIComponent)
				return {
					documents: rows.filter((row) => ids.includes(String(row._id))),
				}
			}
			beforeWrite?.()
			if (outcome === 'lost-before') throw new Error('Network lost')
			// Model the Actions batch against a private copy: a failed later guard
			// commits nothing, including redirects created earlier in the request.
			const next = structuredClone(rows)
			const fail = () => {
				throw Object.assign(new Error('Revision conflict'), { statusCode: 409 })
			}
			const actions: unknown[] = [...options.body!.actions]
			for (const action of actions) {
				if (!record(action)) throw new Error('Invalid action')
				const live = next.find((row) => row._id === action.publishedId)
				if (action.actionType === 'sanity.action.document.version.create') {
					if (
						!live ||
						live._rev !== action.ifBaseRevisionId ||
						next.some((row) => row._id === action.versionId)
					)
						fail()
					next.push({ ...live, _id: action.versionId, _rev: 'copied' })
				} else if (action.actionType === 'sanity.action.document.edit') {
					const draft = next.find((row) => row._id === action.draftId)
					if (!draft || !record(action.patch) || !record(action.patch.set))
						fail()
					Object.assign(draft!, (action.patch as { set: object }).set)
				} else if (action.actionType === 'sanity.action.document.create') {
					const attributes = action.attributes
					if (!record(attributes)) throw new Error('Invalid create')
					if (next.some((row) => row._id === attributes._id)) fail()
					next.push({
						...(action.attributes as Record<string, unknown>),
						_rev: 'created',
					})
				} else if (action.actionType === 'sanity.action.document.publish') {
					const draft = next.find((row) => row._id === action.draftId)
					if (
						!draft ||
						(action.ifDraftRevisionId &&
							draft._rev !== action.ifDraftRevisionId) ||
						(action.ifPublishedRevisionId &&
							live?._rev !== action.ifPublishedRevisionId)
					)
						fail()
					const publish = {
						...draft,
						_id: action.publishedId,
						_rev: 'published',
					}
					for (let index = next.length - 1; index >= 0; index--)
						if (
							next[index]!._id === action.draftId ||
							next[index]!._id === action.publishedId
						)
							next.splice(index, 1)
					next.push(publish)
				} else throw new Error('Unexpected action')
			}
			rows = next
			if (outcome === 'lost-after') throw new Error('Lost server response')
			return outcome === 'bad-response'
				? {}
				: { transactionId: options.body!.transactionId }
		},
	)
	const source = {
		config: () => scope,
		fetch: vi.fn(
			async (query: string, params: Record<string, unknown>) =>
				(
					await evaluate(parse(query), { dataset: rows, params })
				).get() as Promise<unknown>,
		),
		request,
	}
	const client = { withConfig: vi.fn(() => source) }
	const options = {
		configuration,
		confirmReadAccess,
		authorize,
		recoveryStorage: storage,
	}
	const create = () => createCollectionPrefixController(options, client)
	const controller = create()
	return {
		controller,
		create,
		client,
		options,
		source,
		saved,
		storage,
		authorize,
		confirmReadAccess,
		request,
		get rows() {
			return rows
		},
		setOutcome: (value: typeof outcome) => {
			outcome = value
		},
		setBeforeWrite: (value: () => void) => {
			beforeWrite = value
		},
		writes: () =>
			request.mock.calls.filter(([options]) => options.method === 'POST'),
	}
}
async function ready(
	test: ReturnType<typeof setup>,
	createRedirects = true,
): Promise<CollectionPrefixPublishReview> {
	const result = await test.controller.review({ ...choice, createRedirects })
	expect(result.status).toBe('ready')
	if (result.status !== 'ready') throw new Error(JSON.stringify(result))
	return result.review
}
const current = { isCurrent: () => true }

describe('collection-prefix guarded write', () => {
	it('publishes the full reviewed settings draft with exact redirects, without changing any item or index', async () => {
		const t = setup()
		t.rows.find((row) => row._id === 'drafts.journal-settings')!.displayName =
			'Articles'
		t.rows.find((row) => row._id === 'alias')!.custom = { keep: true }
		const untouched = structuredClone(
			t.rows.filter((row) => row._type === 'post' || row._type === 'page'),
		)
		const review = await ready(t)
		expect(review.settings.draft.displayName).toBe('Articles')
		expect(Object.isFrozen(review.settings.draft)).toBe(true)
		expect(await t.controller.publish(review, current)).toEqual({
			status: 'published',
			operationId: review.operationId,
		})
		expect(
			t.rows.filter((row) => row._type === 'post' || row._type === 'page'),
		).toEqual(untouched)
		expect(t.rows.find((row) => row._id === 'journal-settings')).toMatchObject({
			displayName: 'Articles',
			prefix: { current: '/blog' },
		})
		expect(t.rows.some((row) => row._id === 'drafts.journal-settings')).toBe(
			false,
		)
		expect(t.rows.find((row) => row._id === 'alias')).toMatchObject({
			source: '/old-alpha',
			destination: '/blog/alpha',
			custom: { keep: true },
		})
		expect(t.rows.find((row) => row.source === '/journal/alpha')).toMatchObject(
			{ destination: '/blog/alpha' },
		)
		const actions = t.writes()[0]![0].body!.actions
		expect(
			actions.filter(
				(a) => 'publishedId' in a && String(a.publishedId).includes('post-'),
			),
		).toEqual([])
		expect(t.writes()[0]![0]).toMatchObject({
			maxRetries: 0,
			fetch: { cache: 'no-store' },
		})
		expect(t.authorize).toHaveBeenCalledTimes(2)
		expect(t.controller.getPending()).toBeNull()
		expect(t.saved.size).toBe(0)
	})
	it('retargets existing aliases even when new redirects are declined', async () => {
		const t = setup(),
			review = await ready(t, false)
		expect((await t.controller.publish(review, current)).status).toBe(
			'published',
		)
		expect(t.rows.filter((row) => row._type === 'sanityKitRedirect')).toEqual([
			expect.objectContaining({ _id: 'alias', destination: '/blog/alpha' }),
		])
	})
	it.each(['missing', 'unverified', 'protected'] as const)(
		'blocks %s write/schema access before dispatch',
		async (status) => {
			const t = setup(),
				review = await ready(t)
			t.authorize.mockImplementation((request) =>
				Promise.resolve({
					receiptRead: 'granted',
					targets: request.targets.map(({ key }) => ({ key, status })),
				}),
			)
			expect(await t.controller.publish(review, current)).toMatchObject({
				status: 'blocked',
				reason: `write-access-${status}`,
			})
			expect(t.writes()).toHaveLength(0)
		},
	)
	it.each(['empty', 'duplicate', 'receipt'] as const)(
		'does not accept %s permission answers',
		async (mode) => {
			const t = setup()
			t.authorize.mockImplementation((request) =>
				Promise.resolve({
					receiptRead: mode === 'receipt' ? 'unverified' : 'granted',
					targets:
						mode === 'empty'
							? []
							: request.targets.map(({ key }) => ({
									key: mode === 'duplicate' ? request.targets[0]!.key : key,
									status: 'granted' as const,
								})),
				}),
			)
			expect((await t.controller.review(choice)).status).toBe('blocked')
			expect(t.writes()).toHaveLength(0)
		},
	)
	it.each(['page', 'settings', 'redirect', 'release'] as const)(
		'rechecks %s inventory after review',
		async (kind) => {
			const t = setup(),
				review = await ready(t)
			if (kind === 'page') t.rows.push(page('new-conflict', '/blog/alpha'))
			if (kind === 'settings')
				t.rows.find((row) => row._id === 'drafts.journal-settings')!._rev =
					'changed'
			if (kind === 'redirect')
				t.rows.find((row) => row._id === 'alias')!._rev = 'changed'
			if (kind === 'release') t.rows.push(post('versions.scheduled.post-1'))
			expect((await t.controller.publish(review, current)).status).toBe(
				'blocked',
			)
			expect(t.writes()).toHaveLength(0)
		},
	)
	it('rejects copied and foreign reviews', async () => {
		const t = setup(),
			review = await ready(t)
		expect(await t.controller.publish({ ...review }, current)).toMatchObject({
			reason: 'invalid-review',
		})
		expect(await t.create().publish(review, current)).toMatchObject({
			reason: 'invalid-review',
		})
	})
	it('rejects settings changed between projected review and full document load', async () => {
		const t = setup()
		const original = t.source.fetch.getMockImplementation()!
		t.source.fetch.mockImplementation(async (...args) => {
			const result = await original(...args)
			t.rows.find((row) => row._id === 'drafts.journal-settings')!._rev =
				'later'
			return result
		})
		expect(await t.controller.review(choice)).toMatchObject({
			reason: 'review-stale',
		})
	})
	it.each(['settings', 'alias', 'alias-draft'] as const)(
		'atomically rejects a late %s revision/identity race',
		async (kind) => {
			const t = setup(),
				review = await ready(t)
			t.setBeforeWrite(() => {
				if (kind === 'settings')
					t.rows.find((row) => row._id === 'drafts.journal-settings')!._rev =
						'later'
				if (kind === 'alias')
					t.rows.find((row) => row._id === 'alias')!._rev = 'later'
				if (kind === 'alias-draft')
					t.rows.push({
						...t.rows.find((row) => row._id === 'alias'),
						_id: 'drafts.alias',
						_rev: 'later',
						destination: '/editor-planned',
					})
			})
			expect(await t.controller.publish(review, current)).toMatchObject({
				status: 'rejected',
				reason: 'conflict',
			})
			expect(
				t.rows.find((row) => row._id === 'journal-settings'),
			).toMatchObject({ prefix: { current: '/journal' } })
			expect(t.rows.find((row) => row._id === 'alias')).toMatchObject({
				destination: '/journal/alpha',
			})
			expect(t.rows.some((row) => row.source === '/journal/alpha')).toBe(false)
			expect(t.controller.getPending()).toBeNull()
		},
	)
	it.each(['cancel', 'stale', 'throw'] as const)(
		'does not send after %s',
		async (mode) => {
			const t = setup(),
				review = await ready(t),
				abort = new AbortController()
			if (mode === 'cancel') abort.abort()
			expect(
				(
					await t.controller.publish(review, {
						signal: abort.signal,
						isCurrent: () => {
							if (mode === 'throw') throw new Error('unmounted')
							return false
						},
					})
				).status,
			).toBe('blocked')
			expect(t.writes()).toHaveLength(0)
		},
	)
	it('checks cancellation after asynchronous authorization', async () => {
		const t = setup(),
			review = await ready(t),
			abort = new AbortController()
		const original = t.authorize.getMockImplementation()!
		t.authorize.mockImplementation(async (request) => {
			const result = await original(request)
			abort.abort()
			return result
		})
		expect(
			await t.controller.publish(review, { ...current, signal: abort.signal }),
		).toMatchObject({ reason: 'aborted' })
		expect(t.writes()).toHaveLength(0)
	})
	it('requires durable recovery storage before sending', async () => {
		const t = setup(),
			review = await ready(t)
		t.storage.setItem.mockImplementation(() => {
			throw new Error('Storage full')
		})
		expect(await t.controller.publish(review, current)).toMatchObject({
			reason: 'recovery-unavailable',
		})
		expect(t.writes()).toHaveLength(0)
	})
	it.each(['lost-after', 'bad-response'] as const)(
		'confirms %s using the exact durable receipt',
		async (outcome) => {
			const t = setup(),
				review = await ready(t)
			t.setOutcome(outcome)
			expect(await t.controller.publish(review, current)).toMatchObject({
				status: 'published',
			})
			expect(t.writes()).toHaveLength(1)
			expect(t.saved.size).toBe(0)
		},
	)
	it('keeps a missing receipt uncertain and blocks resubmission across mounted controllers', async () => {
		const t = setup(),
			review = await ready(t),
			other = t.create()
		t.setOutcome('lost-before')
		expect(await t.controller.publish(review, current)).toMatchObject({
			status: 'unknown',
		})
		expect(await other.reconcile()).toMatchObject({ status: 'unknown' })
		expect(await other.review(choice)).toMatchObject({
			reason: 'outcome-unknown',
		})
		expect(await t.controller.publish(review, current)).toMatchObject({
			reason: 'outcome-unknown',
		})
		expect(t.writes()).toHaveLength(1)
	})
	it('recovers across a fresh module instance only when the exact receipt appears', async () => {
		const t = setup(),
			review = await ready(t)
		t.setOutcome('lost-before')
		await t.controller.publish(review, current)
		const receipt = t.controller.getPending()!
		vi.resetModules()
		const { createCollectionPrefixController: fresh } =
			await import('../../src/studio/collections/prefix-write.js')
		const restored = fresh(t.options, t.client)
		expect(restored.getPending()).toEqual(receipt)
		t.rows.push({ ...receipt, evidence: 'wrong evidence' })
		expect((await restored.reconcile()).status).toBe('unknown')
		t.rows.find((row) => row._id === receipt._id)!.evidence = receipt.evidence
		expect(await restored.reconcile()).toEqual({
			status: 'published',
			operationId: review.operationId,
		})
		expect(t.writes()).toHaveLength(1)
	})
	it('blocks corrupt saved recovery instead of overwriting it', async () => {
		const t = setup(),
			review = await ready(t)
		t.saved.set(
			`sanity-kit.collection-prefix:${JSON.stringify([t.source.config().projectId, 'development'])}`,
			'{invalid',
		)
		expect(await t.controller.publish(review, current)).toMatchObject({
			reason: 'recovery-invalid',
		})
		expect(t.writes()).toHaveLength(0)
	})
	it('still blocks initial and same-prefix settings publication', async () => {
		const t = setup()
		t.rows.splice(
			t.rows.findIndex((row) => row._id === 'journal-settings'),
			1,
		)
		expect(await t.controller.review(choice)).toMatchObject({
			reason: 'first-publication-unsupported',
		})
		t.rows.push(setting())
		t.rows.find((row) => row._id === 'drafts.journal-settings')!.prefix = {
			_type: 'slug',
			current: '/journal',
		}
		expect(await t.controller.review(choice)).toMatchObject({
			reason: 'unchanged-prefix',
		})
	})
	it('bounds complete settings documents separately from projected review data', async () => {
		const t = setup()
		t.rows.find((row) => row._id === 'drafts.journal-settings')!.large =
			'x'.repeat(1_048_576)
		expect(await t.controller.review(choice)).toMatchObject({
			reason: 'settings-size-limit',
		})
		expect(t.writes()).toHaveLength(0)
	})
	it('measures the fully serialized action batch rather than only the plan', async () => {
		const t = setup()
		t.rows.find((row) => row._id === 'post-1')!.title = '\\'.repeat(246500)
		for (let index = 0; index < 98; index++)
			t.rows.push(redirect(`a${index}`, `/a${index}`))
		const result = await t.controller.review(choice)
		expect(result.status === 'blocked' ? result.reason : 'ready').toBe(
			'request-size-limit',
		)
		expect(t.writes()).toHaveLength(0)
	})
	it('captures the redirect choice before asynchronous reads', async () => {
		const t = setup(),
			mutable = { ...choice }
		const pending = t.controller.review(mutable)
		mutable.createRedirects = false
		const result = await pending
		expect(result.status).toBe('ready')
		if (result.status !== 'ready') throw new Error('Expected review')
		expect(result.review.createRedirects).toBe(true)
		expect(result.review.plan.redirects.creates).toHaveLength(1)
	})
	it('does not double-dispatch when two mounted controllers hold valid reviews', async () => {
		const t = setup(),
			first = await ready(t),
			secondController = t.create()
		const second = await secondController.review(choice)
		if (second.status !== 'ready') throw new Error('Expected review')
		let finish!: () => void, sent!: () => void
		const gate = new Promise<void>((resolve) => {
			finish = resolve
		})
		const started = new Promise<void>((resolve) => {
			sent = resolve
		})
		const original = t.request.getMockImplementation()!
		t.request.mockImplementation(async (request) => {
			if (request.method === 'POST') {
				sent()
				await gate
			}
			return original(request)
		})
		const publishing = t.controller.publish(first, current)
		await started
		expect(
			await secondController.publish(second.review, current),
		).toMatchObject({ reason: 'outcome-unknown' })
		finish()
		expect((await publishing).status).toBe('published')
		expect(t.writes()).toHaveLength(1)
	})
	it('reconciles the attempted operation rather than a newer dataset pending receipt', async () => {
		const t = setup(),
			review = await ready(t)
		t.setOutcome('lost-before')
		await t.controller.publish(review, current)
		const scope = t.source.config()
		const first = readPendingCollectionPrefix(scope, t.storage)!
		settlePendingCollectionPrefix(
			scope,
			first,
			{ status: 'published', operationId: review.operationId },
			t.storage,
		)
		const operationId = crypto.randomUUID()
		const receipt = {
			...first.receipt,
			_id: `sanityKit.collectionPrefixPublication.${operationId}`,
			operationId,
		}
		rememberPendingCollectionPrefix(scope, { receipt }, t.storage)
		expect(t.controller.getPending()?.operationId).toBe(operationId)
		expect(await t.controller.reconcile(review.operationId)).toEqual({
			status: 'published',
			operationId: review.operationId,
		})
		expect(
			readPendingCollectionPrefix(scope, t.storage)?.receipt.operationId,
		).toBe(operationId)
		expect(await t.controller.reconcile('unknown-operation')).toMatchObject({
			reason: 'no-pending-publish',
		})
	})
	it('compacts settled receipt evidence, bounds history, and never evicts unresolved evidence', async () => {
		const t = setup(),
			review = await ready(t)
		t.setOutcome('lost-before')
		await t.controller.publish(review, current)
		const pending = readPendingCollectionPrefix(t.source.config(), t.storage)!
		const history = createCollectionPublicationAttempts()
		history.remember(pending)
		expect(history.get(review.operationId)).toBe(pending)
		const firstCompleted = crypto.randomUUID()
		for (let i = 0; i <= COLLECTION_COMPLETED_ATTEMPT_LIMIT; i++) {
			const operationId = i === 0 ? firstCompleted : crypto.randomUUID()
			const completed = {
				receipt: {
					...pending.receipt,
					operationId,
					evidence: 'large review'.repeat(1000),
				},
				result: { status: 'published' as const, operationId },
			}
			history.remember(completed)
			expect(history.get(operationId)).toEqual({
				receiptType: pending.receipt._type,
				result: { status: 'published', operationId },
			})
		}
		expect(history.get(firstCompleted)).toBeUndefined()
		expect(history.get(review.operationId)).toBe(pending)
		pending.result = { status: 'published', operationId: review.operationId }
		expect(history.get(review.operationId)).toEqual({
			receiptType: pending.receipt._type,
			result: pending.result,
		})
		history.remember({ receipt: pending.receipt })
		expect(history.get(review.operationId)).toEqual({
			receiptType: pending.receipt._type,
			result: pending.result,
		})
	})
	it('keeps only bounded completed prefix outcomes without repeating receipt reads', async () => {
		const t = setup(),
			review = await ready(t)
		t.setOutcome('lost-before')
		await t.controller.publish(review, current)
		const scope = t.source.config(),
			original = readPendingCollectionPrefix(scope, t.storage)!
		settlePendingCollectionPrefix(
			scope,
			original,
			{ status: 'published', operationId: review.operationId },
			t.storage,
		)
		t.controller.getPending()
		let latest = review.operationId
		for (let i = 0; i < COLLECTION_COMPLETED_ATTEMPT_LIMIT; i++) {
			latest = crypto.randomUUID()
			const next = {
				receipt: {
					...original.receipt,
					_id: `sanityKit.collectionPrefixPublication.${latest}`,
					operationId: latest,
				},
			}
			rememberPendingCollectionPrefix(scope, next, t.storage)
			t.controller.getPending()
			settlePendingCollectionPrefix(
				scope,
				next,
				{ status: 'published', operationId: latest },
				t.storage,
			)
			t.controller.getPending()
		}
		const reads = t.request.mock.calls.length
		expect(await t.controller.reconcile(latest)).toEqual({
			status: 'published',
			operationId: latest,
		})
		expect(await t.controller.reconcile(review.operationId)).toMatchObject({
			reason: 'no-pending-publish',
		})
		expect(t.request.mock.calls).toHaveLength(reads)
	})
	it('keeps a failed recovery read unknown after the write was sent', async () => {
		const t = setup()
		const review = await ready(t)
		const pendingRead = vi.spyOn(pendingStore, 'readPendingCollectionPrefix')
		try {
			t.setOutcome('lost-before')
			t.setBeforeWrite(() => {
				pendingRead.mockImplementationOnce(() => {
					throw Error('Corrupt recovery')
				})
			})
			expect(await t.controller.publish(review, current)).toEqual({
				status: 'unknown',
				operationId: review.operationId,
			})
			expect(t.writes()).toHaveLength(1)
		} finally {
			pendingRead.mockRestore()
		}
	})
})
