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
	it('serializes removal with creation and synchronization, then refreshes the list', async () => {
		const pending = deferred()
		const remove = vi.fn().mockReturnValue(pending.promise)
		const create = vi.fn().mockResolvedValue(synced(1))
		const synchronize = vi.fn().mockResolvedValue(synced())
		const refresh = vi.fn()
		const controller = createFolderSyncController(
			synchronize,
			refresh,
			create,
			remove,
		)
		controller.start()
		const first = controller.remove('/empty')
		expect(await controller.remove('/other')).toEqual({
			status: 'blocked',
			reason: 'busy',
		})
		expect(await controller.create('/new')).toEqual({
			status: 'blocked',
			reason: 'busy',
		})
		expect(await controller.manual()).toEqual({
			status: 'blocked',
			reason: 'busy',
		})
		await vi.advanceTimersByTimeAsync(FOLDER_SYNC_INTERVAL_MS * 2)
		expect(synchronize).not.toHaveBeenCalled()
		expect(create).not.toHaveBeenCalled()
		pending.resolve(synced(1))
		await first
		expect(remove).toHaveBeenCalledExactlyOnceWith(
			'/empty',
			expect.any(AbortSignal),
		)
		expect(refresh).toHaveBeenCalledOnce()
		controller.stop()
		expect(await controller.remove('/other')).toEqual({
			status: 'blocked',
			reason: 'aborted',
		})
	})
	it('pauses automatic checks after an uncertain removal', async () => {
		const synchronize = vi.fn().mockResolvedValue(synced())
		const remove = vi
			.fn()
			.mockResolvedValue({ status: 'blocked', reason: 'outcome-unknown' })
		const controller = createFolderSyncController(
			synchronize,
			vi.fn(),
			undefined,
			remove,
		)
		controller.start()
		await controller.remove('/empty')
		controller.notify()
		await vi.advanceTimersByTimeAsync(FOLDER_SYNC_INTERVAL_MS * 2)
		expect(synchronize).not.toHaveBeenCalled()
		controller.stop()
	})

	it('creates explicitly and refreshes folders without consuming a queued sync', async () => {
		const synchronize = vi.fn().mockResolvedValue(synced())
		const create = vi.fn().mockResolvedValue(synced(2))
		const refresh = vi.fn()
		const controller = createFolderSyncController(synchronize, refresh, create)
		controller.start()
		expect(await controller.create('/new/team')).toEqual(synced(2))
		expect(create).toHaveBeenCalledWith('/new/team', expect.any(AbortSignal))
		expect(refresh).toHaveBeenCalledOnce()
		expect(synchronize).not.toHaveBeenCalled()
		await vi.advanceTimersByTimeAsync(FOLDER_SYNC_INTERVAL_MS)
		expect(synchronize).toHaveBeenCalledOnce()
	})

	it('does not share creation results with other paths or manual sync requests', async () => {
		const pending = deferred()
		const create = vi.fn().mockReturnValue(pending.promise)
		const synchronize = vi.fn().mockResolvedValue(synced())
		const controller = createFolderSyncController(synchronize, vi.fn(), create)
		controller.start()
		const first = controller.create('/new')
		expect(await controller.create('/other')).toEqual({
			status: 'blocked',
			reason: 'busy',
		})
		expect(await controller.manual()).toEqual({
			status: 'blocked',
			reason: 'busy',
		})
		await vi.advanceTimersByTimeAsync(FOLDER_SYNC_INTERVAL_MS * 2)
		expect(create).toHaveBeenCalledOnce()
		expect(synchronize).not.toHaveBeenCalled()
		pending.resolve(synced(1))
		await first
	})

	it('refuses creation while a sync is running instead of reporting it as created', async () => {
		const pending = deferred()
		const synchronize = vi.fn().mockReturnValue(pending.promise)
		const create = vi.fn().mockResolvedValue(synced(1))
		const controller = createFolderSyncController(synchronize, vi.fn(), create)
		controller.start()
		const run = controller.manual()
		expect(await controller.create('/new')).toEqual({
			status: 'blocked',
			reason: 'busy',
		})
		expect(create).not.toHaveBeenCalled()
		pending.resolve(synced())
		await run
		expect(await controller.create('/new')).toEqual(synced(1))
	})

	it('pauses background sync after an uncertain creation until an explicit recovery', async () => {
		const synchronize = vi.fn().mockResolvedValue(synced())
		const create = vi
			.fn()
			.mockResolvedValue({ status: 'blocked', reason: 'outcome-unknown' })
		const controller = createFolderSyncController(synchronize, vi.fn(), create)
		controller.start()
		await controller.create('/new')
		controller.notify()
		await vi.advanceTimersByTimeAsync(FOLDER_SYNC_INTERVAL_MS * 2)
		expect(synchronize).not.toHaveBeenCalled()
		await controller.manual()
		expect(synchronize).toHaveBeenCalledOnce()
	})

	it('refuses creation after stop and preserves an already-dispatched late result', async () => {
		const pending = deferred()
		const create = vi
			.fn<
				(pathname: string, signal?: AbortSignal) => Promise<FolderSyncResult>
			>()
			.mockReturnValue(pending.promise)
		const refresh = vi.fn()
		const controller = createFolderSyncController(vi.fn(), refresh, create)
		controller.start()
		const run = controller.create('/new')
		await vi.advanceTimersByTimeAsync(0)
		controller.stop()
		expect(create.mock.calls[0]![1]!.aborted).toBe(true)
		expect(await controller.create('/other')).toEqual({
			status: 'blocked',
			reason: 'aborted',
		})
		pending.resolve(synced(1))
		expect(await run).toEqual(synced(1))
		expect(refresh).not.toHaveBeenCalled()
	})

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
