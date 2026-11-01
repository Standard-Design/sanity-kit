/**
 * Wait for a brief pause in URL editing, then run the existing preparation gates.
 * This hook never creates a Sanity patch itself. The input receives a current,
 * checked candidate and lets the native form save it. See docs/url-field.md.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { UrlCandidate } from '../../url/authoring.js'
import type { createUrlEditController, UrlEditDocument } from './edit.js'

export const URL_AUTOSAVE_DELAY_MS = 500

export interface UrlAutosaveOptions {
	readonly editor: Pick<ReturnType<typeof createUrlEditController>, 'prepare'>
	readonly document: UrlEditDocument
	/** The already prepared storage value, not a full URL for slug-only items. */
	readonly storedValue: string | undefined
	/** The input owns validity, dirtiness, field mapping, and read-only checks. */
	readonly enabled: boolean
	/** Pause while generating or creating a folder. */
	readonly paused: boolean
	readonly onReady: (candidate: UrlCandidate) => void
}

export interface UrlAutosaveState {
	readonly status: 'idle' | 'waiting' | 'checking' | 'error'
	readonly reason?: string
}

/**
 * Cancellation can arrive while a folder mutation is being acknowledged. Queue
 * the next prepare behind that work rather than overlapping controller actions.
 * A failed check does not retry by itself; edits or explicit retry start again.
 */
export function useUrlAutosave(
	options: UrlAutosaveOptions,
): UrlAutosaveState & {
	readonly retry: () => void
	/** After pausing/canceling, wait before starting another controller action. */
	readonly waitForIdle: () => Promise<void>
} {
	const { editor, document, storedValue, enabled, paused } = options
	const [state, setState] = useState<UrlAutosaveState>({ status: 'idle' })
	const [attempt, setAttempt] = useState(0)
	const mounted = useRef(false)
	const tail = useRef<Promise<void>>(Promise.resolve())
	const latest = useRef({ ...options, attempt })
	// A render can precede passive-effect cleanup. Read the newest restrictions
	// synchronously before calling prepare and again before emitting any candidate.
	latest.current = { ...options, attempt }

	useEffect(() => {
		mounted.current = true
		return () => {
			mounted.current = false
		}
	}, [])

	useEffect(() => {
		let active = true
		const abort = new AbortController()
		const current = () => {
			const now = latest.current
			return (
				mounted.current &&
				active &&
				!abort.signal.aborted &&
				now.editor === editor &&
				now.document === document &&
				now.storedValue === storedValue &&
				now.attempt === attempt &&
				now.enabled &&
				!now.paused
			)
		}
		if (!enabled || paused || storedValue === undefined) {
			setState({ status: 'idle' })
			return () => {
				active = false
				abort.abort()
			}
		}
		setState({ status: 'waiting' })
		const timer = setTimeout(() => {
			// Keep the tail settled even if a supplied callback throws. Rejections
			// belong to this attempt and must never poison the next queued change.
			tail.current = tail.current
				.then(async () => {
					if (!current()) return
					setState({ status: 'checking' })
					try {
						const result = await editor.prepare(
							{ document, storedValue, readOnly: false },
							abort.signal,
						)
						if (!current()) return
						if (result.status === 'ready') {
							setState({ status: 'idle' })
							latest.current.onReady(result.candidate)
						} else setState({ status: 'error', reason: result.reason })
					} catch {
						if (current())
							setState({ status: 'error', reason: 'request-failed' })
					}
				})
				.catch(() => {
					if (current()) setState({ status: 'error', reason: 'request-failed' })
				})
		}, URL_AUTOSAVE_DELAY_MS)
		return () => {
			active = false
			clearTimeout(timer)
			abort.abort()
		}
	}, [editor, document, storedValue, enabled, paused, attempt])

	const retry = useCallback(() => {
		if (mounted.current) setAttempt((value) => value + 1)
	}, [])
	const waitForIdle = useCallback(() => tail.current, [])
	return { ...state, retry, waitForIdle }
}
