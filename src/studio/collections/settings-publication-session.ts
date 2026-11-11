/**
 * Own a normal Publish click for first or unchanged-prefix collection settings.
 * Successful checks proceed directly to the guarded writer; only failures or
 * an uncertain outcome open a notice. Prefix changes use their separate review
 * session because an editor must inspect moved URLs and choose redirect policy.
 */
import type { CollectionPrefixNativeSnapshot } from './prefix-publication-session.js'
import type {
	createCollectionSettingsPublicationController,
	CollectionSettingsPublishResult,
} from './settings-publication-write.js'

type Controller = ReturnType<
	typeof createCollectionSettingsPublicationController
>
export type CollectionSettingsSessionView = {
	readonly phase:
		| 'idle'
		| 'checking'
		| 'publishing'
		| 'blocked'
		| 'unknown'
		| 'checking-status'
	readonly open: boolean
	readonly reason?: string
	readonly operationId?: string
	readonly pathname?: string
	readonly accessRequirements?: readonly string[]
}
const READ_TIMEOUT = 15_000
const WRITE_TIMEOUT = 30_000

/** Keep one owner per controller; refresh it when native document state changes. */
export function createCollectionSettingsPublicationSession(options: {
	readonly controller: Controller
	readonly getCurrent: () => CollectionPrefixNativeSnapshot & {
		readonly canPublish: boolean
	}
	readonly onPublished: (operationId: string) => void
}) {
	let view: CollectionSettingsSessionView = Object.freeze({
		phase: 'idle',
		open: false,
	})
	let disposed = false
	let epoch = 0
	let abort: AbortController | undefined
	let attempt: string | undefined
	const announced = new Set<string>()
	const listeners = new Set<() => void>()
	function emit(next: CollectionSettingsSessionView) {
		if (disposed) return
		view = Object.freeze(next)
		for (const listener of listeners) {
			try {
				listener()
			} catch {
				/* Rendering cannot change a write outcome. */
			}
		}
	}
	function current() {
		const value = options.getCurrent()
		if (!value.canPublish)
			return { reason: 'native-publish-unavailable' } as const
		if (
			!value.collection ||
			!value.draft?._rev ||
			!value.draft._id.startsWith('drafts.') ||
			value.draft._id.startsWith('drafts.versions.')
		)
			return { reason: 'settings-unavailable' } as const
		if (value.published && value.draft._id !== `drafts.${value.published._id}`)
			return { reason: 'settings-unavailable' } as const
		if (!value.isSynced) return { reason: 'settings-not-synced' } as const
		if (
			value.validation.isValidating ||
			value.validation.revision !== value.draft._rev
		)
			return { reason: 'settings-validation-pending' } as const
		if (value.validation.hasErrors)
			return { reason: 'settings-validation-failed' } as const
		return {
			value: {
				collection: value.collection,
				documentId: value.draft._id.slice(7),
				draftRevision: value.draft._rev,
				publishedRevision: value.published?._rev ?? null,
			},
		} as const
	}
	const matches = (key: string) => {
		try {
			const now = current()
			return 'value' in now && JSON.stringify(now.value) === key
		} catch {
			return false
		}
	}
	function block(reason: string, result?: unknown, open = true) {
		const record = (value: unknown): value is Record<string, unknown> =>
			!!value && typeof value === 'object' && !Array.isArray(value)
		const plan =
			record(result) && record(result.planFailure)
				? result.planFailure
				: undefined
		const access =
			record(result) && Array.isArray(result.accessIssues)
				? (result.accessIssues as unknown[])
				: []
		const labels = access.flatMap((value) =>
			record(value) && typeof value.label === 'string' ? [value.label] : [],
		)
		emit({
			phase: 'blocked',
			open,
			reason,
			...(typeof plan?.pathname === 'string'
				? { pathname: plan.pathname }
				: {}),
			...(labels.length ? { accessRequirements: labels } : {}),
		})
	}
	function unknown(operationId = attempt, open = true) {
		attempt = operationId
		emit({
			phase: 'unknown',
			open,
			...(operationId ? { operationId } : {}),
		})
	}
	function pending(): boolean {
		// A newer dataset operation cannot replace the attempt this owner is checking.
		if (attempt) {
			unknown(attempt)
			return true
		}
		try {
			const receipt = options.controller.getPending()
			if (receipt) {
				if (receipt._type !== 'sanityKitCollectionSettingsPublication')
					block('other-publication-pending')
				else unknown(receipt.operationId)
				return true
			}
		} catch {
			block('recovery-invalid')
			return true
		}
		if (attempt) {
			unknown(attempt)
			return true
		}
		return false
	}
	function settled(
		result: CollectionSettingsPublishResult,
		operationId: string,
		open = true,
	) {
		if (result.status === 'blocked') {
			block(result.reason, result, open)
			return
		}
		if (result.operationId !== operationId) {
			unknown(operationId, open)
			return
		}
		if (result.status === 'unknown') {
			unknown(operationId, open)
			return
		}
		attempt = undefined
		if (result.status === 'published') {
			emit({ phase: 'idle', open: false })
			if (!announced.has(operationId)) {
				announced.add(operationId)
				try {
					options.onPublished(operationId)
				} catch {
					/* A toast or document refresh failure cannot undo a confirmed save. */
				}
			}
		} else block(result.reason ?? 'request-rejected', undefined, open)
	}
	/** Bound UI waits, even if an injected transport ignores cancellation. */
	async function bounded<T>(
		promise: Promise<T>,
		controller: AbortController,
		ms: number,
		fallback: () => T,
	): Promise<T> {
		let timer: ReturnType<typeof setTimeout> | undefined
		try {
			return await Promise.race([
				promise,
				new Promise<T>((resolve) => {
					timer = setTimeout(() => {
						controller.abort()
						resolve(fallback())
					}, ms)
				}),
			])
		} finally {
			if (timer) clearTimeout(timer)
		}
	}
	async function publish() {
		if (
			disposed ||
			['checking', 'publishing', 'unknown', 'checking-status'].includes(
				view.phase,
			)
		)
			return
		if (pending()) return
		let snapshot: ReturnType<typeof current>
		try {
			snapshot = current()
		} catch {
			block('settings-unavailable')
			return
		}
		if ('reason' in snapshot) {
			block(snapshot.reason)
			return
		}
		const evidence = snapshot.value,
			key = JSON.stringify(evidence)
		const token = ++epoch,
			controller = new AbortController()
		abort?.abort()
		abort = controller
		emit({ phase: 'checking', open: false })
		try {
			const found = await bounded(
				options.controller.review(
					{
						collection: evidence.collection,
						draftRevision: evidence.draftRevision,
					},
					controller.signal,
				),
				controller,
				READ_TIMEOUT,
				() => ({ status: 'blocked', reason: 'request-failed' }) as const,
			)
			if (disposed || token !== epoch) return
			if (found.status === 'blocked') {
				if (found.reason === 'outcome-unknown') {
					if (!pending()) block('review-stale')
				} else block(found.reason, found)
				return
			}
			if (
				!matches(key) ||
				found.review.classification.documentId !== evidence.documentId ||
				found.review.classification.draftRevision !== evidence.draftRevision ||
				found.review.classification.publishedRevision !==
					evidence.publishedRevision
			) {
				block('review-stale')
				return
			}
			attempt = found.review.operationId
			const operationId = attempt
			emit({ phase: 'publishing', open: false, operationId })
			// The late settlement observer also handles transports that complete after the
			// UI timeout. It never turns a missing receipt into permission to send again.
			const request = options.controller.publish(found.review, {
				signal: controller.signal,
				isCurrent: () => !disposed && token === epoch && matches(key),
			})
			void request.then(
				(result) => {
					if (
						!disposed &&
						['unknown', 'checking-status'].includes(view.phase) &&
						attempt === operationId
					) {
						const open = view.open
						if (result.status === 'blocked') {
							// Pending/recovery diagnostics may concern an existing attempt.
							// Only a definite preparation/access refusal clears uncertainty;
							// a status-read block alone never establishes that refusal.
							if (
								result.reason.startsWith('recovery-') ||
								[
									'outcome-unknown',
									'other-publication-pending',
									'no-pending-publish',
									'busy',
									'invalid-review',
								].includes(result.reason)
							)
								return
							epoch++
							abort?.abort()
							abort = undefined
							attempt = undefined
							block(result.reason, result, open)
						} else if (result.operationId === operationId) {
							if (result.status !== 'unknown') {
								epoch++
								abort?.abort()
								abort = undefined
							}
							settled(result, operationId, open)
						}
					}
				},
				() => {
					/* A thrown request stays uncertain. */
				},
			)
			const result = await bounded(
				request,
				controller,
				WRITE_TIMEOUT,
				() => ({ status: 'unknown', operationId }) as const,
			)
			if (disposed || token !== epoch) return
			// The writer only returns blocked before dispatch; post-dispatch recovery
			// failures are unknown. No retry is offered after an ambiguous send.
			if (result.status === 'blocked') attempt = undefined
			settled(result, operationId)
		} catch {
			if (!disposed && token === epoch) {
				if (attempt) unknown()
				else block('request-failed')
			}
		} finally {
			if (token === epoch) abort = undefined
		}
	}
	async function checkStatus() {
		if (
			disposed ||
			['checking', 'publishing', 'checking-status'].includes(view.phase)
		)
			return
		if (!attempt && !pending()) return
		if (!attempt) return
		const operationId = attempt,
			token = ++epoch,
			controller = new AbortController()
		abort?.abort()
		abort = controller
		emit({ phase: 'checking-status', open: true, operationId })
		try {
			const result = await bounded(
				options.controller.reconcile(operationId),
				controller,
				READ_TIMEOUT,
				() => ({ status: 'unknown', operationId }) as const,
			)
			if (!disposed && token === epoch) {
				if (result.status === 'blocked') unknown(operationId)
				else settled(result, operationId)
			}
		} catch {
			if (!disposed && token === epoch) unknown(operationId)
		} finally {
			if (token === epoch) abort = undefined
		}
	}
	return Object.freeze({
		getView: () => view,
		subscribe(listener: () => void) {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},
		publish,
		checkStatus,
		recover: pending,
		close() {
			if (disposed || view.phase === 'publishing') return
			if (view.phase === 'checking-status') {
				epoch++
				abort?.abort()
				abort = undefined
				unknown(attempt, false)
			} else if (view.phase === 'unknown') emit({ ...view, open: false })
			else {
				epoch++
				abort?.abort()
				emit({ phase: 'idle', open: false })
			}
		},
		dispose() {
			disposed = true
			epoch++
			abort?.abort()
			listeners.clear()
		},
	})
}
