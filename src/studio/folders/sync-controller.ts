/**
 * Schedule the Pages safety fallback without making browsing wait for it.
 * One controller belongs to the tool, not to a perspective or navigator panel.
 * The synchronizer owns access checks and uncertain writes; this layer coalesces
 * checks and keeps explicit creation from overlapping them. Failed operations
 * pause automatic checks until an editor retries. See docs/folders.md.
 */
import type { FolderSyncResult } from './synchronize.js'

export const FOLDER_SYNC_DELAY_MS = 1000
export const FOLDER_SYNC_INTERVAL_MS = 60_000

export function createFolderSyncController(
	synchronize: (signal?: AbortSignal) => Promise<FolderSyncResult>,
	onSaved: () => void,
	create?: (
		pathname: string,
		signal?: AbortSignal,
	) => Promise<FolderSyncResult>,
) {
	let active = false
	let paused = false
	let queued = false
	let lastStarted = -Infinity
	let timer: ReturnType<typeof setTimeout> | undefined
	let running: Promise<FolderSyncResult> | undefined
	let runningKind: 'sync' | 'create' | undefined
	let abort: AbortController | undefined

	function schedule() {
		if (!active || paused || !queued || running || timer) return
		const delay = Math.max(
			FOLDER_SYNC_DELAY_MS,
			lastStarted + FOLDER_SYNC_INTERVAL_MS - Date.now(),
		)
		timer = setTimeout(() => {
			timer = undefined
			void run()
		}, delay)
	}
	function run(pathname?: string): Promise<FolderSyncResult> {
		const kind = pathname === undefined ? 'sync' : 'create'
		if (running) {
			// Only equivalent synchronization requests can share a result. A
			// creation result must never imply that another path was created.
			return kind === 'sync' && runningKind === 'sync'
				? running
				: Promise.resolve({ status: 'blocked', reason: 'busy' })
		}
		if (kind === 'sync') queued = false
		lastStarted = Date.now()
		const controller = new AbortController()
		abort = controller
		runningKind = kind
		running = Promise.resolve()
			.then(() =>
				pathname === undefined
					? synchronize(controller.signal)
					: create!(pathname, controller.signal),
			)
			.catch((): FolderSyncResult => ({
				status: 'blocked',
				reason: 'request-failed',
			}))
			.then((result) => {
				// Do not discard a late write result on unmount. The service must
				// retain its uncertainty, and a confirmed result stays confirmed.
				paused = result.status === 'blocked' && result.reason !== 'aborted'
				if (active && result.status === 'synced') {
					try {
						onSaved()
					} catch {
						/* Display refresh cannot undo a confirmed write. */
					}
				}
				return result
			})
			.finally(() => {
				running = undefined
				runningKind = undefined
				abort = undefined
				schedule()
			})
		return running
	}
	return {
		start() {
			active = true
			queued = true
			schedule()
		},
		stop() {
			active = false
			queued = false
			clearTimeout(timer)
			timer = undefined
			abort?.abort()
		},
		notify() {
			if (!active) return
			queued = true
			schedule()
		},
		/** An explicit retry bypasses the throttle, but shares an in-flight check. */
		manual() {
			clearTimeout(timer)
			timer = undefined
			paused = false
			return run()
		},
		/** Explicit folder creation shares the tool's write and recovery boundary. */
		create(pathname: string): Promise<FolderSyncResult> {
			if (!active)
				return Promise.resolve({ status: 'blocked', reason: 'aborted' })
			if (!create)
				return Promise.resolve({ status: 'blocked', reason: 'configuration' })
			clearTimeout(timer)
			timer = undefined
			return run(pathname)
		},
	}
}
