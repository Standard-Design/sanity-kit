/**
 * One editor session for an existing collection-prefix change. The native action
 * will supply current document/validation state; this owner drives the private
 * dialog without changing Studio's action registration. Its controller remains
 * responsible for permissions, revision guards, writes, and durable recovery.
 */
import type { CollectionPrefixDialogState } from './prefix-publication-dialog.js'
import type { CollectionPrefixReceipt } from './prefix-pending.js'
import type {
	createCollectionPrefixController,
	CollectionPrefixPublishResult,
	CollectionPrefixPublishReview,
} from './prefix-write.js'

type Controller = ReturnType<typeof createCollectionPrefixController>
export interface CollectionPrefixNativeSnapshot {
	readonly collection: string
	readonly published: { readonly _id: string; readonly _rev: string } | null
	readonly draft: { readonly _id: string; readonly _rev: string } | null
	readonly isSynced: boolean
	readonly validation: {
		readonly isValidating: boolean
		readonly hasErrors: boolean
		readonly revision?: string
	}
}
export type CollectionPrefixSessionView =
	| { readonly open: false; readonly createRedirects: boolean }
	| {
			readonly open: true
			readonly createRedirects: boolean
			readonly state: CollectionPrefixDialogState
	  }

interface Evidence {
	readonly collection: string
	readonly documentId: string
	readonly publishedRevision: string
	readonly draftRevision: string
}
const keyFor = (value: Evidence) => JSON.stringify(value)
const blocked = (reason: string): CollectionPrefixDialogState => ({
	phase: 'blocked',
	result: { status: 'blocked', reason },
})
const READ_TIMEOUT_MS = 15_000
const PUBLISH_TIMEOUT_MS = 30_000

/** A writer block stops before dispatch; pending/recovery diagnostics do not
 * establish the outcome of an attempt that may already exist elsewhere. */
function confirmsNoDispatch(reason: string) {
	return (
		!reason.startsWith('recovery-') &&
		![
			'outcome-unknown',
			'other-publication-pending',
			'no-pending-publish',
			'busy',
			'invalid-review',
		].includes(reason)
	)
}

/**
 * Keep this object for one controller and dispose it when the workspace/action
 * changes. A React owner can subscribe with useSyncExternalStore. Call refresh
 * when native document state changes; publish also reads getCurrent directly so
 * a delayed render cannot make an old review current again.
 */
export function createCollectionPrefixPublicationSession(options: {
	readonly controller: Controller
	readonly getCurrent: () => CollectionPrefixNativeSnapshot
	readonly onPublished?: (operationId: string) => void
}) {
	let view: CollectionPrefixSessionView = Object.freeze({
		open: false,
		createRedirects: true,
	})
	const listeners = new Set<() => void>()
	let disposed = false
	let epoch = 0
	let active: AbortController | undefined
	let readEvidence: Evidence | undefined
	let accepted:
		{ review: CollectionPrefixPublishReview; evidence: Evidence } | undefined
	let pending: CollectionPrefixReceipt | undefined
	let unknownOperationId: string | undefined
	let closedSettlement:
		| Extract<
				CollectionPrefixPublishResult,
				{ status: 'published' | 'rejected' }
		  >
		| undefined
	const announced = new Set<string>()

	function emit(state: CollectionPrefixDialogState | null) {
		if (disposed) return
		view = Object.freeze(
			state
				? { open: true, state, createRedirects: view.createRedirects }
				: { open: false, createRedirects: view.createRedirects },
		)
		for (const listener of listeners) {
			try {
				listener()
			} catch {
				/* Rendering failure cannot change a confirmed save. */
			}
		}
	}
	function current(): { evidence?: Evidence; reason?: string } {
		try {
			const value = options.getCurrent()
			if (
				!value.collection ||
				!value.published?._id ||
				!value.published._rev ||
				!value.draft?._rev ||
				value.draft._id !== `drafts.${value.published._id}` ||
				value.published._id.startsWith('drafts.') ||
				value.published._id.startsWith('versions.')
			)
				return { reason: 'settings-unavailable' }
			if (!value.isSynced) return { reason: 'settings-not-synced' }
			if (
				value.validation.isValidating ||
				value.validation.revision !== value.draft._rev
			)
				return { reason: 'settings-validation-pending' }
			if (value.validation.hasErrors)
				return { reason: 'settings-validation-failed' }
			return {
				evidence: {
					collection: value.collection,
					documentId: value.published._id,
					publishedRevision: value.published._rev,
					draftRevision: value.draft._rev,
				},
			}
		} catch {
			return { reason: 'settings-unavailable' }
		}
	}
	function matches(evidence: Evidence) {
		const now = current().evidence
		return !!now && keyFor(now) === keyFor(evidence)
	}
	function invalidate() {
		epoch++
		active?.abort()
		active = undefined
		accepted = undefined
		readEvidence = undefined
	}
	function saving() {
		return view.open && view.state.phase === 'publishing'
	}
	function showUnknown(
		operationId = unknownOperationId ?? pending?.operationId,
	) {
		accepted = undefined
		if (!operationId) {
			emit(blocked('recovery-invalid'))
			return
		}
		unknownOperationId = operationId
		emit({
			phase: 'unconfirmed',
			result: { status: 'unknown', operationId },
			...(pending ? { receipt: pending } : {}),
		})
	}
	/** Reading pending state never clears it or decides that a missing receipt failed. */
	function recoverIfNeeded(): boolean {
		try {
			const stored = options.controller.getPending()
			if (stored && stored._type !== 'sanityKitCollectionPrefixPublication') {
				if (unknownOperationId) showUnknown()
				else emit(blocked('other-publication-pending'))
				return true
			}
			if (
				stored &&
				(!unknownOperationId || stored.operationId === unknownOperationId)
			)
				pending = stored
			if (pending || unknownOperationId) {
				showUnknown()
				return true
			}
			return false
		} catch {
			emit(blocked('recovery-invalid'))
			return true
		}
	}
	function bounded<T>(
		task: Promise<T>,
		abort: AbortController,
		timeout: () => T,
		milliseconds = READ_TIMEOUT_MS,
	): Promise<T> {
		return new Promise((resolve, reject) => {
			let done = false
			const finish = (value: T) => {
				if (done) return
				done = true
				clearTimeout(timer)
				abort.signal.removeEventListener('abort', canceled)
				resolve(value)
			}
			const canceled = () => finish(timeout())
			const timer = setTimeout(() => {
				abort.abort()
			}, milliseconds)
			abort.signal.addEventListener('abort', canceled, { once: true })
			if (abort.signal.aborted) canceled()
			task.then(finish, (error: unknown) => {
				if (done) return
				done = true
				clearTimeout(timer)
				abort.signal.removeEventListener('abort', canceled)
				reject(
					error instanceof Error
						? error
						: new Error('Collection URL check failed'),
				)
			})
		})
	}
	async function review() {
		if (disposed || saving()) return
		invalidate()
		if (closedSettlement) {
			const result = closedSettlement
			closedSettlement = undefined
			settled(result)
			return
		}
		if (recoverIfNeeded()) return
		const snapshot = current()
		if (!snapshot.evidence) {
			emit(blocked(snapshot.reason ?? 'settings-unavailable'))
			return
		}
		const evidence = snapshot.evidence
		readEvidence = evidence
		const token = epoch
		const abort = new AbortController()
		active = abort
		const choice = view.createRedirects
		emit({ phase: 'checking' })
		try {
			const result = await bounded(
				options.controller.review(
					{
						collection: evidence.collection,
						publishedRevision: evidence.publishedRevision,
						draftRevision: evidence.draftRevision,
						createRedirects: choice,
					},
					abort.signal,
				),
				abort,
				() => ({ status: 'blocked', reason: 'request-failed' }) as const,
			)
			if (disposed || token !== epoch || !view.open) return
			if (!matches(evidence) || choice !== view.createRedirects) {
				emit(blocked('review-stale'))
				return
			}
			if (result.status === 'blocked') {
				if (result.reason === 'outcome-unknown') {
					if (!recoverIfNeeded()) emit(blocked('recovery-invalid'))
					return
				}
				emit({ phase: 'blocked', result })
				return
			}
			const { settings } = result.review.plan
			if (
				settings.collection !== evidence.collection ||
				settings.documentId !== evidence.documentId ||
				settings.publishedRevision !== evidence.publishedRevision ||
				settings.draftRevision !== evidence.draftRevision ||
				result.review.createRedirects !== choice
			) {
				emit(blocked('review-stale'))
				return
			}
			accepted = { review: result.review, evidence }
			emit({ phase: 'ready', review: result.review })
		} catch {
			if (!disposed && token === epoch && view.open)
				emit(blocked('request-failed'))
		} finally {
			if (token === epoch) {
				active = undefined
				readEvidence = undefined
			}
		}
	}
	function settled(result: CollectionPrefixPublishResult) {
		accepted = undefined
		if (result.status === 'published' || result.status === 'rejected') {
			pending = undefined
			unknownOperationId = undefined
			if (result.status === 'published') {
				// Close first; the Studio owner announces confirmed success with a toast.
				emit(null)
				if (!announced.has(result.operationId)) {
					announced.add(result.operationId)
					try {
						options.onPublished?.(result.operationId)
					} catch {
						/* A notification or refresh failure must not relabel a successful save. */
					}
				}
			} else
				emit({ phase: 'rejected', result: { ...result, status: 'rejected' } })
			return
		}
		if (result.status === 'unknown') {
			unknownOperationId = result.operationId
			try {
				const stored = options.controller.getPending()
				if (
					stored?._type === 'sanityKitCollectionPrefixPublication' &&
					stored.operationId === result.operationId
				)
					pending = stored
			} catch {
				/* Keep the uncertain result; never authorize another write. */
			}
			showUnknown(result.operationId)
			return
		}
		if (result.status === 'blocked') {
			if (result.reason === 'outcome-unknown') {
				if (!recoverIfNeeded()) emit(blocked('recovery-invalid'))
				return
			}
			emit({ phase: 'blocked', result })
		}
	}
	async function publish(reviewed: CollectionPrefixPublishReview) {
		if (
			disposed ||
			!view.open ||
			view.state.phase !== 'ready' ||
			!accepted ||
			accepted.review !== reviewed ||
			reviewed.createRedirects !== view.createRedirects
		)
			return
		const evidence = accepted.evidence
		if (!matches(evidence)) {
			invalidate()
			emit(blocked('review-stale'))
			return
		}
		if (recoverIfNeeded()) return
		const token = ++epoch
		const abort = new AbortController()
		active = abort
		emit({ phase: 'publishing', review: reviewed })
		try {
			const task = options.controller.publish(reviewed, {
				signal: abort.signal,
				isCurrent: () =>
					!disposed &&
					view.open &&
					token === epoch &&
					view.createRedirects === reviewed.createRedirects &&
					matches(evidence),
			})
			// A timed-out pre-dispatch check can eventually return an explicit
			// block. That is evidence; an empty pending slot by itself is not.
			void task.then(
				(result) => {
					if (
						disposed ||
						(view.open &&
							!['unconfirmed', 'checking-status'].includes(view.state.phase)) ||
						unknownOperationId !== reviewed.operationId
					)
						return
					if (
						result.status === 'blocked' &&
						confirmsNoDispatch(result.reason)
					) {
						invalidate()
						pending = undefined
						unknownOperationId = undefined
						// Keep a dismissed dialog closed. The next open can safely make
						// a new review instead of recovering a write that never happened.
						if (view.open) emit({ phase: 'blocked', result })
						else emit(null)
					} else if (
						result.status !== 'blocked' &&
						result.operationId === reviewed.operationId &&
						result.status !== 'unknown'
					) {
						invalidate()
						if (view.open) settled(result)
						else {
							pending = undefined
							unknownOperationId = undefined
							closedSettlement = result
						}
					}
				},
				() => undefined,
			)
			const result = await bounded<CollectionPrefixPublishResult | null>(
				task,
				abort,
				() => null,
				PUBLISH_TIMEOUT_MS,
			)
			if (!disposed && token === epoch && view.open) {
				if (result) {
					if (
						result.status === 'blocked' ||
						result.operationId === reviewed.operationId
					)
						settled(result)
					else showUnknown(reviewed.operationId)
				} else {
					showUnknown(reviewed.operationId)
					await checkStatus()
				}
			}
		} catch {
			if (!disposed && token === epoch && view.open) {
				// The controller persists before dispatch. Inspect that record before
				// allowing any new attempt; never turn a thrown request into a resend.
				showUnknown(reviewed.operationId)
				await checkStatus()
			}
		} finally {
			if (token === epoch) active = undefined
		}
	}
	async function checkStatus() {
		if (
			disposed ||
			saving() ||
			(view.open && view.state.phase === 'checking-status')
		)
			return
		invalidate()
		if (!recoverIfNeeded()) {
			emit(blocked('no-pending-publish'))
			return
		}
		if (!unknownOperationId || !view.open || view.state.phase !== 'unconfirmed')
			return
		const operationId = unknownOperationId
		const token = epoch
		const abort = new AbortController()
		active = abort
		emit({
			phase: 'checking-status',
			result: { status: 'unknown', operationId },
			...(pending ? { receipt: pending } : {}),
		})
		try {
			// reconcile does not yet accept an AbortSignal. Bound this UI wait and
			// ignore late results; the controller may still record confirmed success.
			const result = await bounded(
				options.controller.reconcile(operationId),
				abort,
				() => ({ status: 'unknown', operationId }) as const,
			)
			if (!disposed && token === epoch && view.open) {
				if (result.status === 'blocked' || result.operationId !== operationId)
					showUnknown(operationId)
				else settled(result)
			}
		} catch {
			if (!disposed && token === epoch && view.open) showUnknown(operationId)
		} finally {
			if (token === epoch) active = undefined
		}
	}
	return Object.freeze({
		getView: () => view,
		/** Local recovery survives closing; confirmed or unsent attempts clear it. */
		needsRecovery: () =>
			!disposed && !!(pending || unknownOperationId || closedSettlement),
		subscribe(listener: () => void) {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},
		canOpen() {
			if (disposed) return false
			try {
				return !!(
					options.controller.getPending() ||
					closedSettlement ||
					pending ||
					unknownOperationId ||
					current().evidence
				)
			} catch {
				return true
			}
		},
		open: review,
		review,
		publish,
		checkStatus,
		setCreateRedirects(value: boolean) {
			if (
				disposed ||
				saving() ||
				value === view.createRedirects ||
				(view.open &&
					['unconfirmed', 'checking-status'].includes(view.state.phase))
			)
				return
			view = Object.freeze({ ...view, createRedirects: value })
			if (view.open) void review()
		},
		refresh() {
			if (disposed || saving() || !view.open) return
			const previous = accepted?.evidence ?? readEvidence
			if (previous && !matches(previous)) {
				invalidate()
				emit(blocked('review-stale'))
			}
		},
		close() {
			if (disposed || saving()) return
			invalidate()
			emit(null)
		},
		dispose() {
			if (disposed) return
			disposed = true
			invalidate()
			listeners.clear()
		},
	})
}
