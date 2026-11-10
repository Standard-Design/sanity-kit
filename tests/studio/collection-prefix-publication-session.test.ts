import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	createCollectionPrefixPublicationSession,
	type CollectionPrefixNativeSnapshot,
} from '../../src/studio/collections/prefix-publication-session.js'
import type {
	createCollectionPrefixController,
	CollectionPrefixPublishReview,
	CollectionPrefixPublishResult,
} from '../../src/studio/collections/prefix-write.js'
import type { CollectionPrefixReceipt } from '../../src/studio/collections/prefix-pending.js'

type Controller = ReturnType<typeof createCollectionPrefixController>
const snapshot = (): CollectionPrefixNativeSnapshot => ({
	collection: 'journal',
	published: { _id: 'journal-settings', _rev: 'live-1' },
	draft: { _id: 'drafts.journal-settings', _rev: 'draft-1' },
	isSynced: true,
	validation: { isValidating: false, hasErrors: false, revision: 'draft-1' },
})
function review(createRedirects = true): CollectionPrefixPublishReview {
	return {
		projectId: 'test',
		dataset: 'development',
		operationId: 'operation-1',
		createRedirects,
		settings: {
			published: {
				_id: 'journal-settings',
				_rev: 'live-1',
				_type: 'sanityKitCollectionRoute',
			},
			draft: {
				_id: 'drafts.journal-settings',
				_rev: 'draft-1',
				_type: 'sanityKitCollectionRoute',
			},
		},
		plan: {
			settings: {
				collection: 'journal',
				documentId: 'journal-settings',
				publishedRevision: 'live-1',
				draftRevision: 'draft-1',
				oldPrefix: '/journal',
				newPrefix: '/blog',
			},
			liveChanges: [],
			draftUrls: [],
			redirects: { creates: [], updates: [] },
			reviewVersions: [],
			reviewBytes: 100,
		},
	}
}
const receipt: CollectionPrefixReceipt = {
	_id: 'sanityKit.collectionPrefixPublication.operation-1',
	_type: 'sanityKitCollectionPrefixPublication',
	operationId: 'operation-1',
	oldPrefix: '/journal',
	newPrefix: '/blog',
	createRedirects: true,
	evidence: '{}',
}
function deferred<T>() {
	let resolve!: (value: T) => void
	let reject!: (reason: unknown) => void
	const promise = new Promise<T>((yes, no) => {
		resolve = yes
		reject = no
	})
	return { promise, resolve, reject }
}
function setup() {
	let current = snapshot()
	let saved: CollectionPrefixReceipt | null = null
	const controller = {
		review: vi.fn<Controller['review']>((choice) =>
			Promise.resolve({
				status: 'ready',
				review: review(choice.createRedirects),
			}),
		),
		publish: vi.fn<Controller['publish']>(() =>
			Promise.resolve({ status: 'published', operationId: 'operation-1' }),
		),
		reconcile: vi.fn<Controller['reconcile']>(() =>
			Promise.resolve({ status: 'unknown', operationId: 'operation-1' }),
		),
		getPending: vi.fn<Controller['getPending']>(() => saved),
	}
	const onPublished = vi.fn()
	const options = { controller, getCurrent: () => current, onPublished }
	const session = createCollectionPrefixPublicationSession(options)
	return {
		controller,
		onPublished,
		options,
		session,
		setCurrent: (value: CollectionPrefixNativeSnapshot) => {
			current = value
		},
		setPending: (value: CollectionPrefixReceipt | null) => {
			saved = value
		},
		state: () => {
			const view = session.getView()
			if (!view.open) throw new Error('Session closed')
			return view.state
		},
		ready: () => {
			const view = session.getView()
			if (!view.open || view.state.phase !== 'ready')
				throw new Error('Not ready')
			return view.state.review
		},
	}
}
afterEach(() => vi.useRealTimers())

describe('collection prefix publication session', () => {
	it('opens with a fresh review and only publishes the exact accepted review after explicit consent', async () => {
		const t = setup()
		expect(t.session.getView()).toEqual({ open: false, createRedirects: true })
		expect(t.controller.review).not.toHaveBeenCalled()
		expect(t.controller.publish).not.toHaveBeenCalled()
		await t.session.open()
		expect(t.controller.review).toHaveBeenCalledWith(
			{
				collection: 'journal',
				publishedRevision: 'live-1',
				draftRevision: 'draft-1',
				createRedirects: true,
			},
			expect.any(AbortSignal),
		)
		const accepted = t.ready()
		await t.session.publish({ ...accepted })
		expect(t.controller.publish).not.toHaveBeenCalled()
		await t.session.publish(accepted)
		expect(t.controller.publish.mock.calls[0]?.[0]).toBe(accepted)
		expect(t.session.getView().open).toBe(false)
		expect(t.onPublished).toHaveBeenCalledExactlyOnceWith('operation-1')
	})
	it.each([
		{ changes: { isSynced: false }, reason: 'settings-not-synced' },
		{
			changes: {
				validation: {
					isValidating: true,
					hasErrors: false,
					revision: 'draft-1',
				},
			},
			reason: 'settings-validation-pending',
		},
		{
			changes: {
				validation: {
					isValidating: false,
					hasErrors: false,
					revision: 'old-draft',
				},
			},
			reason: 'settings-validation-pending',
		},
		{
			changes: {
				validation: {
					isValidating: false,
					hasErrors: true,
					revision: 'draft-1',
				},
			},
			reason: 'settings-validation-failed',
		},
		{ changes: { draft: null }, reason: 'settings-unavailable' },
		{ changes: { published: null }, reason: 'settings-unavailable' },
		{
			changes: {
				draft: { _id: 'versions.release.journal-settings', _rev: 'draft-1' },
			},
			reason: 'settings-unavailable',
		},
	])('waits for native state: $reason', async ({ changes, reason }) => {
		const t = setup()
		t.setCurrent({ ...snapshot(), ...changes })
		expect(t.session.canOpen()).toBe(false)
		await t.session.open()
		expect(t.state()).toMatchObject({ phase: 'blocked', result: { reason } })
		expect(t.controller.review).not.toHaveBeenCalled()
		expect(t.controller.publish).not.toHaveBeenCalled()
	})
	it('rebuilds review on redirect choice and discards out-of-order review results', async () => {
		const t = setup()
		const first = deferred<Awaited<ReturnType<Controller['review']>>>()
		const second = deferred<Awaited<ReturnType<Controller['review']>>>()
		t.controller.review
			.mockReturnValueOnce(first.promise)
			.mockReturnValueOnce(second.promise)
		const opening = t.session.open()
		t.session.setCreateRedirects(false)
		expect(t.controller.review.mock.calls[0]?.[1]?.aborted).toBe(true)
		second.resolve({ status: 'ready', review: review(false) })
		await Promise.resolve()
		await Promise.resolve()
		await Promise.resolve()
		expect(t.ready().createRedirects).toBe(false)
		first.resolve({ status: 'ready', review: review(true) })
		await opening
		expect(t.ready().createRedirects).toBe(false)
		expect(t.controller.publish).not.toHaveBeenCalled()
	})
	it('rejects a review for a different settings identity or revision', async () => {
		const t = setup()
		const value = review()
		t.controller.review.mockResolvedValue({
			status: 'ready',
			review: {
				...value,
				plan: {
					...value.plan,
					settings: {
						...value.plan.settings,
						documentId: 'different-settings',
					},
				},
			},
		})
		await t.session.open()
		expect(t.state()).toMatchObject({
			phase: 'blocked',
			result: { reason: 'review-stale' },
		})
	})
	it('reads current native evidence at consent even when refresh has not run', async () => {
		const t = setup()
		await t.session.open()
		const accepted = t.ready()
		t.setCurrent({
			...snapshot(),
			draft: { _id: 'drafts.journal-settings', _rev: 'draft-2' },
		})
		await t.session.publish(accepted)
		expect(t.state()).toMatchObject({
			phase: 'blocked',
			result: { reason: 'review-stale' },
		})
		expect(t.controller.publish).not.toHaveBeenCalled()
	})
	it('keeps checking native evidence while the writer authorizes the operation', async () => {
		const t = setup()
		const saving = deferred<CollectionPrefixPublishResult>()
		t.controller.publish.mockReturnValue(saving.promise)
		await t.session.open()
		const publishing = t.session.publish(t.ready())
		const consent = t.controller.publish.mock.calls[0]?.[1]
		expect(consent?.isCurrent()).toBe(true)
		t.setCurrent({
			...snapshot(),
			validation: { isValidating: true, hasErrors: false, revision: 'draft-1' },
		})
		expect(consent?.isCurrent()).toBe(false)
		saving.resolve({ status: 'blocked', reason: 'review-stale' })
		await publishing
		expect(t.state()).toMatchObject({
			phase: 'blocked',
			result: { reason: 'review-stale' },
		})
	})
	it('invalidates a ready review on native changes and does not reuse it', async () => {
		const t = setup()
		await t.session.open()
		const accepted = t.ready()
		t.setCurrent({ ...snapshot(), isSynced: false })
		t.session.refresh()
		expect(t.state().phase).toBe('blocked')
		await t.session.publish(accepted)
		expect(t.controller.publish).not.toHaveBeenCalled()
	})
	it('allows closing read-only review and ignores its late result', async () => {
		const t = setup()
		const finding = deferred<Awaited<ReturnType<Controller['review']>>>()
		t.controller.review.mockReturnValue(finding.promise)
		const opening = t.session.open()
		t.session.close()
		expect(t.session.getView().open).toBe(false)
		expect(t.controller.review.mock.calls[0]?.[1]?.aborted).toBe(true)
		finding.resolve({ status: 'ready', review: review() })
		await opening
		expect(t.session.getView().open).toBe(false)
	})
	it('prevents double publish, closing, or choice changes during a save', async () => {
		const t = setup()
		const saving = deferred<CollectionPrefixPublishResult>()
		t.controller.publish.mockReturnValue(saving.promise)
		await t.session.open()
		const accepted = t.ready()
		const publishing = t.session.publish(accepted)
		await t.session.publish(accepted)
		t.session.close()
		t.session.setCreateRedirects(false)
		expect(t.state().phase).toBe('publishing')
		expect(t.session.getView().createRedirects).toBe(true)
		expect(t.controller.publish).toHaveBeenCalledOnce()
		saving.resolve({ status: 'published', operationId: 'operation-1' })
		await publishing
	})
	it('opens pending recovery even when the current settings are not publishable', async () => {
		const t = setup()
		t.setPending(receipt)
		t.setCurrent({ ...snapshot(), draft: null })
		expect(t.session.canOpen()).toBe(true)
		await t.session.open()
		expect(t.state()).toMatchObject({ phase: 'unconfirmed', receipt })
		expect(t.controller.review).not.toHaveBeenCalled()
	})
	it('keeps unknown outcomes through close/reopen and checks receipts without resending', async () => {
		const t = setup()
		t.controller.publish.mockImplementation(() => {
			t.setPending(receipt)
			return Promise.resolve({ status: 'unknown', operationId: 'operation-1' })
		})
		await t.session.open()
		await t.session.publish(t.ready())
		expect(t.state().phase).toBe('unconfirmed')
		t.session.close()
		await t.session.open()
		expect(t.state().phase).toBe('unconfirmed')
		t.controller.reconcile.mockResolvedValue({
			status: 'published',
			operationId: 'operation-1',
		})
		await t.session.checkStatus()
		expect(t.session.getView().open).toBe(false)
		expect(t.controller.publish).toHaveBeenCalledOnce()
		expect(t.controller.review).toHaveBeenCalledOnce()
		expect(t.onPublished).toHaveBeenCalledOnce()
	})
	it('does not reinterpret absent receipt state as failure after an unknown outcome', async () => {
		const t = setup()
		t.controller.publish.mockResolvedValue({
			status: 'unknown',
			operationId: 'operation-1',
		})
		await t.session.open()
		await t.session.publish(t.ready())
		t.controller.reconcile.mockResolvedValue({
			status: 'blocked',
			reason: 'no-pending-publish',
		})
		await t.session.checkStatus()
		expect(t.state().phase).toBe('unconfirmed')
		await t.session.review()
		expect(t.controller.review).toHaveBeenCalledOnce()
	})
	it('does not overwrite or clear unreadable recovery', async () => {
		const t = setup()
		t.controller.getPending.mockImplementation(() => {
			throw new Error('Corrupt record')
		})
		await t.session.open()
		expect(t.state()).toMatchObject({
			phase: 'blocked',
			result: { reason: 'recovery-invalid' },
		})
		await t.session.checkStatus()
		expect(t.controller.reconcile).not.toHaveBeenCalled()
		expect(t.controller.review).not.toHaveBeenCalled()
	})
	it('uses persisted recovery if an unexpected publish error escapes the controller', async () => {
		const t = setup()
		t.controller.publish.mockImplementation(() => {
			t.setPending(receipt)
			return Promise.reject(new Error('Lost response'))
		})
		await t.session.open()
		await t.session.publish(t.ready())
		expect(t.state().phase).toBe('unconfirmed')
		expect(t.controller.publish).toHaveBeenCalledOnce()
	})
	it('bounds review and ignores an eventual late answer', async () => {
		vi.useFakeTimers()
		const t = setup()
		const finding = deferred<Awaited<ReturnType<Controller['review']>>>()
		t.controller.review.mockReturnValue(finding.promise)
		const opening = t.session.open()
		await vi.advanceTimersByTimeAsync(15_000)
		await opening
		expect(t.state()).toMatchObject({
			phase: 'blocked',
			result: { reason: 'request-failed' },
		})
		finding.resolve({ status: 'ready', review: review() })
		await Promise.resolve()
		expect(t.state().phase).toBe('blocked')
	})
	it('bounds reconciliation without deleting pending recovery or resending', async () => {
		vi.useFakeTimers()
		const t = setup()
		t.setPending(receipt)
		t.controller.reconcile.mockReturnValue(new Promise(() => undefined))
		await t.session.open()
		const checking = t.session.checkStatus()
		await vi.advanceTimersByTimeAsync(15_000)
		await checking
		expect(t.state().phase).toBe('unconfirmed')
		expect(t.controller.getPending()).toBe(receipt)
		expect(t.controller.publish).not.toHaveBeenCalled()
	})
	it('allows dismissal during receipt checking without clearing the saved attempt', async () => {
		const t = setup()
		t.setPending(receipt)
		const result = deferred<CollectionPrefixPublishResult>()
		t.controller.reconcile.mockReturnValue(result.promise)
		await t.session.open()
		const checking = t.session.checkStatus()
		t.session.close()
		result.resolve({ status: 'published', operationId: 'operation-1' })
		await checking
		expect(t.session.getView().open).toBe(false)
		expect(t.controller.getPending()).toBe(receipt)
		expect(t.onPublished).not.toHaveBeenCalled()
	})
	it('turns an overlong save into receipt recovery instead of leaving an indefinite busy dialog', async () => {
		vi.useFakeTimers()
		const t = setup()
		t.controller.publish.mockImplementation(() => {
			t.setPending(receipt)
			return new Promise(() => undefined)
		})
		await t.session.open()
		const publishing = t.session.publish(t.ready())
		await vi.advanceTimersByTimeAsync(30_000)
		await publishing
		expect(t.state().phase).toBe('unconfirmed')
		expect(t.controller.publish.mock.calls[0]?.[1].signal?.aborted).toBe(true)
		expect(t.controller.getPending()).toBe(receipt)
	})
	it.each(['cleared', 'replaced'] as const)(
		'recovers the attempted operation after a timeout when another controller has %s the pending slot',
		async (slot) => {
			vi.useFakeTimers()
			const t = setup()
			t.controller.publish.mockImplementation(() => {
				t.setPending(receipt)
				return new Promise(() => undefined)
			})
			t.controller.reconcile.mockImplementation((operationId) =>
				Promise.resolve({ status: 'published', operationId: operationId! }),
			)
			await t.session.open()
			const publishing = t.session.publish(t.ready())
			t.setPending(
				slot === 'cleared' ? null : { ...receipt, operationId: 'operation-b' },
			)
			await vi.advanceTimersByTimeAsync(30_000)
			await publishing
			expect(t.controller.reconcile).toHaveBeenCalledWith('operation-1')
			expect(t.session.getView().open).toBe(false)
			expect(t.onPublished).toHaveBeenCalledExactlyOnceWith('operation-1')
		},
	)
	it('does not infer failure from an empty pending slot after a thrown request', async () => {
		const t = setup()
		t.controller.publish.mockRejectedValue(new Error('Response lost'))
		t.controller.reconcile.mockResolvedValue({
			status: 'blocked',
			reason: 'no-pending-publish',
		})
		await t.session.open()
		await t.session.publish(t.ready())
		expect(t.state()).toMatchObject({
			phase: 'unconfirmed',
			result: { operationId: 'operation-1' },
		})
		expect(t.controller.reconcile).toHaveBeenCalledWith('operation-1')
	})
	it.each([
		'aborted',
		'review-stale',
		'write-access-missing',
		'write-access-protected',
		'request-failed',
	])(
		'uses an explicit late pre-dispatch %s to leave recovery without resubmitting',
		async (reason) => {
			vi.useFakeTimers()
			const t = setup()
			const result = deferred<CollectionPrefixPublishResult>()
			t.controller.publish.mockReturnValue(result.promise)
			t.controller.reconcile.mockResolvedValue({
				status: 'blocked',
				reason: 'no-pending-publish',
			})
			await t.session.open()
			const publishing = t.session.publish(t.ready())
			await vi.advanceTimersByTimeAsync(30_000)
			await publishing
			expect(t.state().phase).toBe('unconfirmed')
			result.resolve({ status: 'blocked', reason })
			await Promise.resolve()
			expect(t.state()).toMatchObject({
				phase: 'blocked',
				result: { reason },
			})
			expect(t.controller.publish).toHaveBeenCalledOnce()
		},
	)
	it.each([
		'aborted',
		'write-access-missing',
		'write-access-protected',
		'request-failed',
	])(
		'remembers a late pre-dispatch %s while closed without reopening or notifying',
		async (reason) => {
			vi.useFakeTimers()
			const t = setup()
			const result = deferred<CollectionPrefixPublishResult>()
			t.controller.publish.mockReturnValue(result.promise)
			t.controller.reconcile.mockResolvedValue({
				status: 'blocked',
				reason: 'no-pending-publish',
			})
			await t.session.open()
			const publishing = t.session.publish(t.ready())
			await vi.advanceTimersByTimeAsync(30_000)
			await publishing
			t.session.close()
			const listener = vi.fn()
			t.session.subscribe(listener)
			result.resolve({ status: 'blocked', reason })
			await Promise.resolve()
			expect(t.session.getView().open).toBe(false)
			expect(listener).not.toHaveBeenCalled()
			expect(t.onPublished).not.toHaveBeenCalled()
			await t.session.open()
			expect(t.state().phase).toBe('ready')
			expect(t.controller.review).toHaveBeenCalledTimes(2)
			expect(t.controller.publish).toHaveBeenCalledOnce()
		},
	)
	it('does not clear a newer pending operation after the closed attempt is confirmed unsent', async () => {
		vi.useFakeTimers()
		const t = setup()
		const result = deferred<CollectionPrefixPublishResult>()
		t.controller.publish.mockReturnValue(result.promise)
		await t.session.open()
		const publishing = t.session.publish(t.ready())
		await vi.advanceTimersByTimeAsync(30_000)
		await publishing
		t.session.close()
		const newer = { ...receipt, operationId: 'operation-b' }
		t.setPending(newer)
		result.resolve({ status: 'blocked', reason: 'aborted' })
		await Promise.resolve()
		expect(t.controller.getPending()).toBe(newer)
		await t.session.open()
		expect(t.state()).toMatchObject({
			phase: 'unconfirmed',
			result: { operationId: 'operation-b' },
		})
		expect(t.controller.review).toHaveBeenCalledOnce()
	})
	it.each(['published', 'rejected'] as const)(
		'remembers exact late %s confirmation while closed and shows it only when reopened',
		async (status) => {
			vi.useFakeTimers()
			const t = setup()
			const result = deferred<CollectionPrefixPublishResult>()
			t.controller.publish.mockReturnValue(result.promise)
			await t.session.open()
			const publishing = t.session.publish(t.ready())
			await vi.advanceTimersByTimeAsync(30_000)
			await publishing
			t.session.close()
			const listener = vi.fn()
			t.session.subscribe(listener)
			const newer = { ...receipt, operationId: 'operation-b' }
			t.setPending(newer)
			result.resolve({ status, operationId: 'operation-1' })
			await Promise.resolve()
			expect(t.session.getView().open).toBe(false)
			expect(listener).not.toHaveBeenCalled()
			expect(t.onPublished).not.toHaveBeenCalled()
			expect(t.controller.getPending()).toBe(newer)
			await t.session.open()
			if (status === 'published') expect(t.session.getView().open).toBe(false)
			else
				expect(t.state()).toMatchObject({
					phase: 'rejected',
					result: { operationId: 'operation-1' },
				})
			expect(t.onPublished).toHaveBeenCalledTimes(
				status === 'published' ? 1 : 0,
			)
			expect(t.controller.review).toHaveBeenCalledOnce()
			t.session.close()
			await t.session.open()
			expect(t.state()).toMatchObject({
				phase: 'unconfirmed',
				result: { operationId: 'operation-b' },
			})
		},
	)
	it.each([
		'recovery-invalid',
		'recovery-unavailable',
		'outcome-unknown',
		'other-publication-pending',
		'no-pending-publish',
		'busy',
		'invalid-review',
	])(
		'does not treat a late %s diagnostic while closed as proof of no dispatch',
		async (reason) => {
			vi.useFakeTimers()
			const t = setup()
			const result = deferred<CollectionPrefixPublishResult>()
			t.controller.publish.mockReturnValue(result.promise)
			await t.session.open()
			const publishing = t.session.publish(t.ready())
			await vi.advanceTimersByTimeAsync(30_000)
			await publishing
			t.session.close()
			result.resolve({ status: 'blocked', reason })
			await Promise.resolve()
			expect(t.session.getView().open).toBe(false)
			await t.session.open()
			expect(t.state()).toMatchObject({
				phase: 'unconfirmed',
				result: { operationId: 'operation-1' },
			})
			expect(t.controller.review).toHaveBeenCalledOnce()
		},
	)
	it('does not describe a pending settings-only save as a prefix move', async () => {
		const t = setup()
		t.controller.getPending.mockReturnValue({
			_id: 'sanityKit.collectionSettingsPublication.operation-b',
			_type: 'sanityKitCollectionSettingsPublication',
			operationId: 'operation-b',
			documentId: 'settings',
			collection: 'other',
			draftRevision: 'draft',
			publishedRevision: null,
			prefix: '/other',
			activatesUrls: true,
			evidence: '{}',
		})
		await t.session.open()
		expect(t.state()).toMatchObject({
			phase: 'blocked',
			result: { reason: 'other-publication-pending' },
		})
		expect(t.controller.review).not.toHaveBeenCalled()
	})
	it('does not treat a late recovery error as proof that the write was never sent', async () => {
		vi.useFakeTimers()
		const t = setup()
		const result = deferred<CollectionPrefixPublishResult>()
		t.controller.publish.mockReturnValue(result.promise)
		t.controller.reconcile.mockResolvedValue({
			status: 'blocked',
			reason: 'recovery-invalid',
		})
		await t.session.open()
		const publishing = t.session.publish(t.ready())
		await vi.advanceTimersByTimeAsync(30_000)
		await publishing
		result.resolve({ status: 'blocked', reason: 'recovery-invalid' })
		await Promise.resolve()
		expect(t.state()).toMatchObject({
			phase: 'unconfirmed',
			result: { operationId: 'operation-1' },
		})
		expect(t.controller.publish).toHaveBeenCalledOnce()
	})
	it('disposes without clearing a sent operation and makes old consent checks false', async () => {
		const t = setup()
		const result = deferred<CollectionPrefixPublishResult>()
		t.controller.publish.mockImplementation(() => {
			t.setPending(receipt)
			return result.promise
		})
		await t.session.open()
		const publishing = t.session.publish(t.ready())
		const consent = t.controller.publish.mock.calls[0]?.[1]
		t.session.dispose()
		expect(consent?.isCurrent()).toBe(false)
		expect(consent?.signal?.aborted).toBe(true)
		result.resolve({ status: 'published', operationId: 'operation-1' })
		await publishing
		expect(t.onPublished).not.toHaveBeenCalled()
		const replacement = createCollectionPrefixPublicationSession(t.options)
		await replacement.open()
		expect(replacement.getView()).toMatchObject({
			open: true,
			state: { phase: 'unconfirmed' },
		})
	})
	it('does not let a consumer notification failure relabel a confirmed save', async () => {
		const t = setup()
		t.onPublished.mockImplementation(() => {
			expect(t.session.getView().open).toBe(false)
			throw new Error('Refresh failed')
		})
		await t.session.open()
		await t.session.publish(t.ready())
		expect(t.session.getView().open).toBe(false)
		expect(t.controller.publish).toHaveBeenCalledOnce()
	})
	it('does not confirm one operation with the result of another dataset-scoped attempt', async () => {
		const t = setup()
		t.setPending(receipt)
		await t.session.open()
		t.setPending({ ...receipt, operationId: 'another-operation' })
		t.controller.reconcile.mockResolvedValue({
			status: 'published',
			operationId: 'another-operation',
		})
		await t.session.checkStatus()
		expect(t.state()).toMatchObject({
			phase: 'unconfirmed',
			result: { operationId: 'operation-1' },
			receipt: { operationId: 'operation-1' },
		})
		expect(t.onPublished).not.toHaveBeenCalled()
		expect(t.controller.publish).not.toHaveBeenCalled()
	})
	it('does not attach a newer pending receipt to an older unknown publish result', async () => {
		const t = setup()
		t.controller.publish.mockImplementation(() => {
			t.setPending({ ...receipt, operationId: 'another-operation' })
			return Promise.resolve({ status: 'unknown', operationId: 'operation-1' })
		})
		await t.session.open()
		await t.session.publish(t.ready())
		expect(t.state()).toEqual({
			phase: 'unconfirmed',
			result: { status: 'unknown', operationId: 'operation-1' },
		})
	})
	it('notifies subscribers and stops notifications after unsubscription', async () => {
		const t = setup()
		const listener = vi.fn()
		const unsubscribe = t.session.subscribe(listener)
		await t.session.open()
		expect(listener).toHaveBeenCalledTimes(2)
		unsubscribe()
		t.session.close()
		expect(listener).toHaveBeenCalledTimes(2)
	})
})
