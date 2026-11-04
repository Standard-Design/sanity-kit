import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	createFolderSyncController,
	FOLDER_SYNC_DELAY_MS,
	FOLDER_SYNC_INTERVAL_MS,
} from '../../src/studio/folders/sync-controller.js'
import type { FolderSyncResult } from '../../src/studio/folders/synchronize.js'

function deferred() {
	let resolve!: (value: FolderSyncResult) => void
	const promise = new Promise<FolderSyncResult>((complete) => {
		resolve = complete
	})
	return { promise, resolve }
}
const synced = (count = 0): FolderSyncResult => ({ status: 'synced', count })

function harness() {
	const synchronize = vi
		.fn<(signal?: AbortSignal) => Promise<FolderSyncResult>>()
		.mockResolvedValue(synced())
	const onSaved = vi.fn()
	const controller = createFolderSyncController(synchronize, onSaved)
	return { synchronize, onSaved, controller }
}

beforeEach(() => {
	vi.useFakeTimers()
	vi.setSystemTime(0)
})
afterEach(() => {
	vi.clearAllTimers()
	vi.useRealTimers()
})

describe('Pages folder synchronization scheduling', () => {
	it('starts after a short delay and does not poll when nothing changes', async () => {
		const { controller, synchronize, onSaved } = harness()
		controller.start()
		await vi.advanceTimersByTimeAsync(FOLDER_SYNC_DELAY_MS - 1)
		expect(synchronize).not.toHaveBeenCalled()
		await vi.advanceTimersByTimeAsync(1)
		expect(synchronize).toHaveBeenCalledOnce()
		expect(onSaved).toHaveBeenCalledOnce()
		await vi.advanceTimersByTimeAsync(FOLDER_SYNC_INTERVAL_MS * 3)
		expect(synchronize).toHaveBeenCalledOnce()
	})

	it('coalesces path changes and throttles checks from the previous start', async () => {
		const { controller, synchronize } = harness()
		controller.start()
		await vi.advanceTimersByTimeAsync(FOLDER_SYNC_DELAY_MS)
		controller.notify()
		controller.notify()
		await vi.advanceTimersByTimeAsync(FOLDER_SYNC_INTERVAL_MS - 1)
		expect(synchronize).toHaveBeenCalledOnce()
		await vi.advanceTimersByTimeAsync(1)
		expect(synchronize).toHaveBeenCalledTimes(2)
		await vi.advanceTimersByTimeAsync(FOLDER_SYNC_INTERVAL_MS)
		expect(synchronize).toHaveBeenCalledTimes(2)
	})

	it('queues one follow-up during a slow check without aborting or overlapping it', async () => {
		const { controller, synchronize } = harness()
		const pending = deferred()
		synchronize.mockReturnValueOnce(pending.promise)
		controller.start()
		await vi.advanceTimersByTimeAsync(FOLDER_SYNC_DELAY_MS)
		controller.notify()
		controller.notify()
		await vi.advanceTimersByTimeAsync(FOLDER_SYNC_INTERVAL_MS * 2)
		expect(synchronize).toHaveBeenCalledOnce()
		expect(synchronize.mock.calls[0]![0]!.aborted).toBe(false)
		pending.resolve(synced())
		await vi.advanceTimersByTimeAsync(0)
		await vi.advanceTimersByTimeAsync(FOLDER_SYNC_DELAY_MS)
		expect(synchronize).toHaveBeenCalledTimes(2)
	})

	it('manual attempts join the current check and bypass a queued throttle', async () => {
		const { controller, synchronize, onSaved } = harness()
		const pending = deferred()
		synchronize.mockReturnValueOnce(pending.promise)
		controller.start()
		await vi.advanceTimersByTimeAsync(FOLDER_SYNC_DELAY_MS)
		const first = controller.manual()
		const second = controller.manual()
		expect(first).toBe(second)
		expect(synchronize).toHaveBeenCalledOnce()
		pending.resolve(synced(2))
		await expect(first).resolves.toEqual(synced(2))
		expect(onSaved).toHaveBeenCalledOnce()
		controller.notify()
		await controller.manual()
		expect(synchronize).toHaveBeenCalledTimes(2)
		await vi.advanceTimersByTimeAsync(FOLDER_SYNC_INTERVAL_MS * 2)
		expect(synchronize).toHaveBeenCalledTimes(2)
	})

	it('pauses automatic work after a failure until an explicit retry succeeds', async () => {
		const { controller, synchronize } = harness()
		synchronize.mockResolvedValueOnce({
			status: 'blocked',
			reason: 'unknown-read-access',
		})
		controller.start()
		await vi.advanceTimersByTimeAsync(FOLDER_SYNC_DELAY_MS)
		controller.notify()
		await vi.advanceTimersByTimeAsync(FOLDER_SYNC_INTERVAL_MS * 2)
		expect(synchronize).toHaveBeenCalledOnce()
		await controller.manual()
		controller.notify()
		await vi.advanceTimersByTimeAsync(FOLDER_SYNC_INTERVAL_MS)
		expect(synchronize).toHaveBeenCalledTimes(3)
	})

	it('converts a thrown adapter error into a paused result', async () => {
		const { controller, synchronize } = harness()
		synchronize.mockRejectedValueOnce(new Error('offline'))
		controller.start()
		await expect(controller.manual()).resolves.toEqual({
			status: 'blocked',
			reason: 'request-failed',
		})
		controller.notify()
		await vi.advanceTimersByTimeAsync(FOLDER_SYNC_INTERVAL_MS * 2)
		expect(synchronize).toHaveBeenCalledOnce()
	})

	it('cancels a queued startup and ignores notifications while stopped', async () => {
		const { controller, synchronize } = harness()
		controller.start()
		controller.stop()
		controller.notify()
		await vi.advanceTimersByTimeAsync(FOLDER_SYNC_INTERVAL_MS)
		expect(synchronize).not.toHaveBeenCalled()
		controller.start()
		await vi.advanceTimersByTimeAsync(FOLDER_SYNC_DELAY_MS)
		expect(synchronize).toHaveBeenCalledOnce()
	})

	it('aborts reads on stop but preserves a late confirmed write without refreshing a closed tool', async () => {
		const { controller, synchronize, onSaved } = harness()
		const pending = deferred()
		synchronize.mockReturnValueOnce(pending.promise)
		controller.start()
		const run = controller.manual()
		await vi.advanceTimersByTimeAsync(0)
		controller.stop()
		expect(synchronize.mock.calls[0]![0]!.aborted).toBe(true)
		pending.resolve(synced(1))
		await expect(run).resolves.toEqual(synced(1))
		expect(onSaved).not.toHaveBeenCalled()
		await vi.advanceTimersByTimeAsync(FOLDER_SYNC_INTERVAL_MS * 2)
		expect(synchronize).toHaveBeenCalledOnce()
	})

	it('retains a blocked uncertain outcome across stop and restart', async () => {
		const { controller, synchronize } = harness()
		const pending = deferred()
		synchronize.mockReturnValueOnce(pending.promise)
		controller.start()
		const run = controller.manual()
		await vi.advanceTimersByTimeAsync(0)
		controller.stop()
		controller.start()
		pending.resolve({ status: 'blocked', reason: 'outcome-unknown' })
		await run
		await vi.advanceTimersByTimeAsync(FOLDER_SYNC_INTERVAL_MS * 2)
		expect(synchronize).toHaveBeenCalledOnce()
		await controller.manual()
		expect(synchronize).toHaveBeenCalledTimes(2)
	})

	it('resumes a restarted tool after its previous read was cancelled', async () => {
		const { controller, synchronize } = harness()
		const pending = deferred()
		synchronize.mockReturnValueOnce(pending.promise)
		controller.start()
		await vi.advanceTimersByTimeAsync(FOLDER_SYNC_DELAY_MS)
		controller.stop()
		controller.start()
		pending.resolve({ status: 'blocked', reason: 'aborted' })
		await vi.advanceTimersByTimeAsync(FOLDER_SYNC_INTERVAL_MS)
		expect(synchronize).toHaveBeenCalledTimes(2)
	})
})
