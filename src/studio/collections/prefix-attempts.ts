/**
 * Local recovery history for a mounted writer. An unresolved attempt needs its
 * exact receipt; a completed attempt needs only its small outcome. Dropping the
 * receipt after settlement releases its serialized review/settings evidence.
 */
import type {
	CollectionPublicationReceipt,
	CollectionPrefixSettlement,
	PendingCollectionPrefix,
} from './prefix-pending.js'

export const COLLECTION_COMPLETED_ATTEMPT_LIMIT = 64
interface CompletedAttempt {
	readonly receiptType: CollectionPublicationReceipt['_type']
	readonly result: CollectionPrefixSettlement
}
type Attempt = PendingCollectionPrefix | CompletedAttempt

export function createCollectionPublicationAttempts() {
	const attempts = new Map<string, Attempt>()
	let latest: string | undefined

	function compact() {
		for (const [id, attempt] of [...attempts]) {
			if ('receipt' in attempt) {
				if (!attempt.result) continue
				const { status, operationId, reason } = attempt.result
				// A long-running attempt that just settled is a recent completion,
				// not the oldest completed record merely because it started first.
				attempts.delete(id)
				attempts.set(id, {
					receiptType: attempt.receipt._type,
					result: Object.freeze({
						status,
						operationId,
						...(reason ? { reason } : {}),
					}),
				})
			}
		}
		const completed = [...attempts]
			.filter(([, value]) => !('receipt' in value))
			.map(([id]) => id)
		for (const id of completed.slice(0, -COLLECTION_COMPLETED_ATTEMPT_LIMIT))
			attempts.delete(id)
	}

	function remember(attempt: PendingCollectionPrefix) {
		const id = attempt.receipt.operationId
		latest = id
		const previous = attempts.get(id)
		// Never replace a known outcome with an older unresolved storage record.
		if (!previous || ('receipt' in previous && attempt.result))
			attempts.set(id, attempt)
		compact()
	}

	return Object.freeze({
		remember,
		compact,
		get(operationId?: string): Attempt | undefined {
			// Another mounted writer may have settled our shared pending object.
			compact()
			const id = operationId ?? latest
			return id ? attempts.get(id) : undefined
		},
	})
}
