import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCollectionSettingsPublicationSession } from '../../src/studio/collections/settings-publication-session.js'
import type {
	createCollectionSettingsPublicationController,
	CollectionSettingsPublicationReview,
} from '../../src/studio/collections/settings-publication-write.js'
import type { CollectionPrefixNativeSnapshot } from '../../src/studio/collections/prefix-publication-session.js'
type Controller = ReturnType<
	typeof createCollectionSettingsPublicationController
>
function setup() {
	let snapshot: CollectionPrefixNativeSnapshot & { canPublish: boolean } = {
		collection: 'journal',
		published: null,
		draft: { _id: 'drafts.settings', _rev: 'draft-1' },
		isSynced: true,
		canPublish: true,
		validation: { isValidating: false, hasErrors: false, revision: 'draft-1' },
	}
	const review: CollectionSettingsPublicationReview = {
		projectId: 'project',
		dataset: 'test',
		operationId: 'operation-a',
		classification: {
			kind: 'first-publication',
			collection: 'journal',
			documentId: 'settings',
			draftRevision: 'draft-1',
			publishedRevision: null,
			prefix: '/journal',
			prefixOwnership: 'editable',
			activatesUrls: true,
		},
		settings: {
			published: null,
			draft: { _id: 'drafts.settings', _rev: 'draft-1' },
		},
	}
	const controller = {
		review: vi
			.fn<Controller['review']>()
			.mockResolvedValue({ status: 'ready', review }),
		publish: vi.fn<Controller['publish']>().mockResolvedValue({
			status: 'published',
			operationId: review.operationId,
		}),
		reconcile: vi.fn<Controller['reconcile']>().mockResolvedValue({
			status: 'unknown',
			operationId: review.operationId,
		}),
		getPending: vi.fn<Controller['getPending']>().mockReturnValue(null),
	}
	const onPublished = vi.fn()
	const session = createCollectionSettingsPublicationSession({
		controller,
		getCurrent: () => snapshot,
		onPublished,
	})
	return {
		controller,
		review,
		session,
		onPublished,
		get snapshot() {
			return snapshot
		},
		set snapshot(value) {
			snapshot = value
		},
	}
}
afterEach(() => vi.useRealTimers())
describe('settings-only native Publish session', () => {
	it('prepares and publishes directly without opening a routine dialog', async () => {
		const t = setup(),
			views: unknown[] = []
		t.session.subscribe(() => views.push(t.session.getView()))
		await t.session.publish()
		expect(views).toEqual([
			{ phase: 'checking', open: false },
			{ phase: 'publishing', open: false, operationId: 'operation-a' },
			{ phase: 'idle', open: false },
		])
		expect(t.controller.review).toHaveBeenCalledWith(
			{ collection: 'journal', draftRevision: 'draft-1' },
			expect.any(AbortSignal),
		)
		expect(t.controller.publish).toHaveBeenCalledWith(
			t.review,
			expect.objectContaining({ isCurrent: expect.any(Function) as unknown }),
		)
		expect(t.onPublished).toHaveBeenCalledExactlyOnceWith('operation-a')
	})
	it.each(['native', 'sync', 'validation', 'errors'] as const)(
		'does not prepare while %s state prevents Publish',
		async (kind) => {
			const t = setup()
			if (kind === 'native') t.snapshot.canPublish = false
			if (kind === 'sync') t.snapshot = { ...t.snapshot, isSynced: false }
			if (kind === 'validation')
				t.snapshot = {
					...t.snapshot,
					validation: { ...t.snapshot.validation, revision: 'older' },
				}
			if (kind === 'errors')
				t.snapshot = {
					...t.snapshot,
					validation: { ...t.snapshot.validation, hasErrors: true },
				}
			await t.session.publish()
			expect(t.controller.review).not.toHaveBeenCalled()
			expect(t.session.getView()).toMatchObject({
				phase: 'blocked',
				open: true,
			})
		},
	)
	it('refuses to publish a review prepared for a newer or different draft', async () => {
		const t = setup()
		t.controller.review.mockImplementationOnce(() => {
			t.snapshot = {
				...t.snapshot,
				draft: { _id: 'drafts.settings', _rev: 'draft-2' },
			}
			return Promise.resolve({ status: 'ready', review: t.review })
		})
		await t.session.publish()
		expect(t.controller.publish).not.toHaveBeenCalled()
		expect(t.session.getView()).toMatchObject({ reason: 'review-stale' })
	})
	it('binds the final writer gate to current native validation and revision', async () => {
		const t = setup()
		t.controller.publish.mockImplementationOnce((_review, choice) => {
			expect(choice.isCurrent()).toBe(true)
			t.snapshot.canPublish = false
			expect(choice.isCurrent()).toBe(false)
			return Promise.resolve({ status: 'blocked', reason: 'review-stale' })
		})
		await t.session.publish()
		expect(t.session.getView()).toMatchObject({
			phase: 'blocked',
			reason: 'review-stale',
		})
	})
	it('shows a failed read and permits a fresh read-only retry', async () => {
		const t = setup()
		t.controller.review.mockResolvedValueOnce({
			status: 'blocked',
			reason: 'request-failed',
		})
		await t.session.publish()
		expect(t.session.getView()).toMatchObject({
			phase: 'blocked',
			reason: 'request-failed',
		})
		await t.session.publish()
		expect(t.controller.review).toHaveBeenCalledTimes(2)
		expect(t.controller.publish).toHaveBeenCalledTimes(1)
	})
	it('does not leave checking active if a pending operation settled before recovery read', async () => {
		const t = setup()
		t.controller.review.mockResolvedValueOnce({
			status: 'blocked',
			reason: 'outcome-unknown',
		})
		await t.session.publish()
		expect(t.session.getView()).toMatchObject({
			phase: 'blocked',
			reason: 'review-stale',
		})
	})
	it('keeps an uncertain result recoverable after closing its notice', async () => {
		const t = setup()
		t.controller.publish.mockResolvedValueOnce({
			status: 'unknown',
			operationId: 'operation-a',
		})
		await t.session.publish()
		t.session.close()
		expect(t.session.getView()).toMatchObject({ phase: 'unknown', open: false })
		await t.session.publish()
		expect(t.controller.publish).toHaveBeenCalledTimes(1)
		t.session.recover()
		expect(t.session.getView()).toMatchObject({ phase: 'unknown', open: true })
		t.controller.reconcile.mockResolvedValueOnce({
			status: 'published',
			operationId: 'operation-a',
		})
		await t.session.checkStatus()
		expect(t.controller.reconcile).toHaveBeenCalledWith('operation-a')
		expect(t.onPublished).toHaveBeenCalledOnce()
	})
	it('never settles an older attempt from another operation response', async () => {
		const t = setup()
		t.controller.publish.mockResolvedValueOnce({
			status: 'unknown',
			operationId: 'operation-a',
		})
		await t.session.publish()
		t.controller.reconcile.mockResolvedValueOnce({
			status: 'published',
			operationId: 'operation-b',
		})
		await t.session.checkStatus()
		expect(t.session.getView()).toMatchObject({
			phase: 'unknown',
			operationId: 'operation-a',
		})
		expect(t.onPublished).not.toHaveBeenCalled()
	})
	it('keeps failed reconciliation unknown and never repeats the write', async () => {
		const t = setup()
		t.controller.publish.mockResolvedValueOnce({
			status: 'unknown',
			operationId: 'operation-a',
		})
		await t.session.publish()
		t.controller.reconcile.mockResolvedValueOnce({
			status: 'blocked',
			reason: 'recovery-invalid',
		})
		await t.session.checkStatus()
		expect(t.session.getView()).toMatchObject({ phase: 'unknown' })
		expect(t.controller.publish).toHaveBeenCalledOnce()
	})
	it('bounds a hung prepare and ignores its late result', async () => {
		vi.useFakeTimers()
		const t = setup()
		let finish!: (value: Awaited<ReturnType<Controller['review']>>) => void
		t.controller.review.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve
				}),
		)
		const pending = t.session.publish()
		await vi.advanceTimersByTimeAsync(15_001)
		await pending
		expect(t.session.getView()).toMatchObject({
			phase: 'blocked',
			reason: 'request-failed',
		})
		finish({ status: 'ready', review: t.review })
		await Promise.resolve()
		expect(t.controller.publish).not.toHaveBeenCalled()
	})
	it('bounds a hung write, then confirms its own late successful result', async () => {
		vi.useFakeTimers()
		const t = setup()
		let finish!: (value: Awaited<ReturnType<Controller['publish']>>) => void
		t.controller.publish.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve
				}),
		)
		const pending = t.session.publish()
		await vi.advanceTimersByTimeAsync(30_001)
		await pending
		expect(t.session.getView()).toMatchObject({
			phase: 'unknown',
			operationId: 'operation-a',
		})
		finish({ status: 'published', operationId: 'operation-a' })
		await Promise.resolve()
		expect(t.onPublished).toHaveBeenCalledExactlyOnceWith('operation-a')
	})
	it.each(['aborted', 'write-access-protected', 'request-failed'])(
		'retains late pre-dispatch %s evidence after closing without reopening the notice',
		async (reason) => {
			vi.useFakeTimers()
			const t = setup()
			let finish!: (value: Awaited<ReturnType<Controller['publish']>>) => void
			t.controller.publish.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						finish = resolve
					}),
			)
			const publishing = t.session.publish()
			await vi.advanceTimersByTimeAsync(30_001)
			await publishing
			t.session.close()
			finish({ status: 'blocked', reason })
			await Promise.resolve()
			expect(t.session.getView()).toMatchObject({
				phase: 'blocked',
				open: false,
				reason,
			})
			t.session.recover()
			expect(t.session.getView().phase).toBe('blocked')
			t.controller.publish.mockResolvedValueOnce({
				status: 'published',
				operationId: 'operation-a',
			})
			await t.session.publish()
			expect(t.session.getView()).toEqual({ phase: 'idle', open: false })
		},
	)
	it('accepts definitive late preparation failure while status checking and ignores its later stale read', async () => {
		vi.useFakeTimers()
		const t = setup()
		let finish!: (value: Awaited<ReturnType<Controller['publish']>>) => void
		let status!: (value: Awaited<ReturnType<Controller['reconcile']>>) => void
		t.controller.publish.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve
				}),
		)
		t.controller.reconcile.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					status = resolve
				}),
		)
		const publishing = t.session.publish()
		await vi.advanceTimersByTimeAsync(30_001)
		await publishing
		const checking = t.session.checkStatus()
		finish({ status: 'blocked', reason: 'aborted' })
		await Promise.resolve()
		expect(t.session.getView()).toMatchObject({
			phase: 'blocked',
			reason: 'aborted',
		})
		status({ status: 'unknown', operationId: 'operation-a' })
		await checking
		expect(t.session.getView()).toMatchObject({
			phase: 'blocked',
			reason: 'aborted',
		})
	})
	it('does not clear uncertainty for a late pending or recovery diagnostic', async () => {
		vi.useFakeTimers()
		const t = setup()
		let finish!: (value: Awaited<ReturnType<Controller['publish']>>) => void
		t.controller.publish.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve
				}),
		)
		const publishing = t.session.publish()
		await vi.advanceTimersByTimeAsync(30_001)
		await publishing
		t.session.close()
		finish({ status: 'blocked', reason: 'recovery-invalid' })
		await Promise.resolve()
		expect(t.session.getView()).toMatchObject({
			phase: 'unknown',
			open: false,
			operationId: 'operation-a',
		})
	})
	it('never relabels confirmed publication when its notification callback fails', async () => {
		const t = setup()
		t.onPublished.mockImplementation(() => {
			throw new Error('Toast failed')
		})
		await t.session.publish()
		expect(t.session.getView()).toEqual({ phase: 'idle', open: false })
		expect(t.onPublished).toHaveBeenCalledExactlyOnceWith('operation-a')
	})
	it('lets Close dismiss a status check without losing the uncertain attempt or reopening on a late read', async () => {
		const t = setup()
		t.controller.publish.mockResolvedValueOnce({
			status: 'unknown',
			operationId: 'operation-a',
		})
		await t.session.publish()
		let finish!: (value: Awaited<ReturnType<Controller['reconcile']>>) => void
		t.controller.reconcile.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve
				}),
		)
		const checking = t.session.checkStatus()
		t.session.close()
		expect(t.session.getView()).toMatchObject({
			phase: 'unknown',
			open: false,
			operationId: 'operation-a',
		})
		finish({ status: 'unknown', operationId: 'operation-a' })
		await checking
		expect(t.session.getView()).toMatchObject({ phase: 'unknown', open: false })
		t.session.recover()
		expect(t.session.getView()).toMatchObject({
			phase: 'unknown',
			open: true,
			operationId: 'operation-a',
		})
	})
	it('ignores prepare completion after navigation/unmount', async () => {
		const t = setup()
		let finish!: (value: Awaited<ReturnType<Controller['review']>>) => void
		t.controller.review.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve
				}),
		)
		const pending = t.session.publish()
		t.session.dispose()
		finish({ status: 'ready', review: t.review })
		await pending
		expect(t.controller.publish).not.toHaveBeenCalled()
		expect(t.onPublished).not.toHaveBeenCalled()
	})
	it('ignores late write confirmation after unmount without clearing controller evidence', async () => {
		const t = setup()
		let finish!: (value: Awaited<ReturnType<Controller['publish']>>) => void
		t.controller.publish.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve
				}),
		)
		const pending = t.session.publish()
		await Promise.resolve()
		await Promise.resolve()
		await Promise.resolve()
		expect(t.controller.publish).toHaveBeenCalledOnce()
		t.session.dispose()
		finish({ status: 'published', operationId: 'operation-a' })
		await pending
		expect(t.onPublished).not.toHaveBeenCalled()
	})
	it('does not replace its uncertain attempt with a newer pending settings save', async () => {
		const t = setup()
		t.controller.publish.mockResolvedValueOnce({
			status: 'unknown',
			operationId: 'operation-a',
		})
		await t.session.publish()
		t.session.close()
		t.controller.getPending.mockReturnValue({
			_id: 'sanityKit.collectionSettingsPublication.operation-b',
			_type: 'sanityKitCollectionSettingsPublication',
			operationId: 'operation-b',
			documentId: 'another',
			collection: 'people',
			draftRevision: 'draft-b',
			publishedRevision: null,
			prefix: '/people',
			activatesUrls: true,
			evidence: '{}',
		})
		t.session.recover()
		expect(t.session.getView()).toMatchObject({
			phase: 'unknown',
			operationId: 'operation-a',
		})
		await t.session.checkStatus()
		expect(t.controller.reconcile).toHaveBeenCalledWith('operation-a')
	})
})
