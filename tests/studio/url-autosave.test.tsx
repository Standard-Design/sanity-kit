// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	useUrlAutosave,
	type UrlAutosaveOptions,
	type UrlAutosaveState,
} from '../../src/studio/url/autosave.js'
import type { UrlEditPrepareResult } from '../../src/studio/url/edit.js'

const candidate = (storedValue: string) => ({
	storedValue,
	fieldPath: 'pathname.current',
	url: { pathname: storedValue, prefix: '/', slug: storedValue.slice(1) },
})
function deferred() {
	let resolve!: (result: UrlEditPrepareResult) => void
	const promise = new Promise<UrlEditPrepareResult>((done) => {
		resolve = done
	})
	return { promise, resolve }
}

async function flush(action: () => void) {
	await act(async () => {
		action()
		await Promise.resolve()
	})
}

describe('debounced URL autosave', () => {
	let root: Root
	let host: HTMLDivElement
	let options: UrlAutosaveOptions
	let state: UrlAutosaveState & {
		retry: () => void
		waitForIdle: () => Promise<void>
	}
	const prepare = vi.fn<UrlAutosaveOptions['editor']['prepare']>()
	const onReady = vi.fn<UrlAutosaveOptions['onReady']>()
	function Harness() {
		state = useUrlAutosave(options)
		return (
			<output>
				{state.status}:{state.reason}
			</output>
		)
	}
	async function render() {
		await flush(() => {
			root.render(<Harness />)
		})
	}
	async function tick(milliseconds = 500) {
		await act(async () => {
			await vi.advanceTimersByTimeAsync(milliseconds)
		})
	}
	beforeEach(() => {
		vi.useFakeTimers()
		prepare.mockReset()
		onReady.mockReset()
		prepare.mockImplementation(({ storedValue }) =>
			Promise.resolve({
				status: 'ready',
				candidate: candidate(String(storedValue)),
			}),
		)
		options = {
			editor: { prepare },
			document: { _id: 'drafts.page', _type: 'page' },
			storedValue: '/first',
			enabled: true,
			paused: false,
			onReady,
		}
		Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
		host = document.createElement('div')
		document.body.append(host)
		root = createRoot(host)
	})
	afterEach(async () => {
		await flush(() => {
			root.unmount()
		})
		host.remove()
		vi.useRealTimers()
	})

	it('waits 500ms and emits a prepared candidate once while waiting for the native echo', async () => {
		await render()
		expect(state.status).toBe('waiting')
		await tick(499)
		expect(prepare).not.toHaveBeenCalled()
		await tick(1)
		expect(onReady).toHaveBeenCalledExactlyOnceWith(candidate('/first'))
		expect(state.status).toBe('idle')
		await render()
		await tick(2000)
		expect(prepare).toHaveBeenCalledTimes(1)
	})

	it('debounces edits and sends only the latest storage value', async () => {
		await render()
		await tick(300)
		options = { ...options, storedValue: '/second' }
		await render()
		await tick(300)
		expect(prepare).not.toHaveBeenCalled()
		await tick(200)
		expect(prepare).toHaveBeenCalledExactlyOnceWith(
			{ document: options.document, storedValue: '/second', readOnly: false },
			expect.any(AbortSignal),
		)
	})

	it('aborts obsolete preparation and serializes the next candidate behind its settlement', async () => {
		const pending = deferred()
		prepare.mockReturnValueOnce(pending.promise)
		await render()
		await tick()
		const signal = prepare.mock.calls[0]![1]!
		options = { ...options, storedValue: '/second' }
		await render()
		expect(signal.aborted).toBe(true)
		await tick()
		expect(prepare).toHaveBeenCalledTimes(1)
		await flush(() => {
			pending.resolve({ status: 'ready', candidate: candidate('/first') })
		})
		expect(prepare).toHaveBeenCalledTimes(2)
		expect(onReady).toHaveBeenCalledExactlyOnceWith(candidate('/second'))
	})

	it('lets another action wait for canceled preparation to finish', async () => {
		const pending = deferred()
		prepare.mockReturnValueOnce(pending.promise)
		await render()
		await tick()
		const wait = state.waitForIdle
		options = { ...options, paused: true }
		await render()
		expect(state.waitForIdle).toBe(wait)
		expect(prepare.mock.calls[0]![1]!.aborted).toBe(true)
		let idle = false
		const settled = wait().then(() => {
			idle = true
		})
		await flush(() => {})
		expect(idle).toBe(false)
		await flush(() => {
			pending.resolve({ status: 'ready', candidate: candidate('/first') })
		})
		await settled
		expect(idle).toBe(true)
		expect(onReady).not.toHaveBeenCalled()
	})

	it.each(['disabled', 'paused', 'invalid'] as const)(
		'never emits obsolete preparation when %s',
		async (change) => {
			const pending = deferred()
			prepare.mockReturnValueOnce(pending.promise)
			await render()
			await tick()
			options = {
				...options,
				...(change === 'disabled'
					? { enabled: false }
					: change === 'paused'
						? { paused: true }
						: { storedValue: undefined }),
			}
			await render()
			await flush(() => {
				pending.resolve({ status: 'ready', candidate: candidate('/first') })
			})
			expect(onReady).not.toHaveBeenCalled()
			expect(state.status).toBe('idle')
		},
	)

	it('refuses a stale document snapshot and checks the new snapshot after settling', async () => {
		const pending = deferred()
		prepare.mockReturnValueOnce(pending.promise)
		await render()
		await tick()
		options = {
			...options,
			document: { ...options.document, title: 'Changed' },
		}
		await render()
		await flush(() => {
			pending.resolve({ status: 'ready', candidate: candidate('/first') })
		})
		expect(onReady).not.toHaveBeenCalled()
		await tick()
		expect(prepare.mock.calls[1]?.[0].document).toBe(options.document)
		expect(onReady).toHaveBeenCalledTimes(1)
	})

	it('leaves a failed result visible without automatic retries, then allows explicit retry', async () => {
		prepare.mockResolvedValueOnce({ status: 'blocked', reason: 'url-in-use' })
		await render()
		await tick()
		expect(state).toMatchObject({ status: 'error', reason: 'url-in-use' })
		await tick(5000)
		expect(prepare).toHaveBeenCalledTimes(1)
		await flush(() => {
			state.retry()
		})
		await tick()
		expect(onReady).toHaveBeenCalledExactlyOnceWith(candidate('/first'))
	})

	it('starts fresh after a changed candidate without carrying forward the old error', async () => {
		prepare.mockResolvedValueOnce({ status: 'blocked', reason: 'url-in-use' })
		await render()
		await tick()
		options = { ...options, storedValue: '/available' }
		await render()
		expect(state).toMatchObject({ status: 'waiting' })
		expect(state.reason).toBeUndefined()
		await tick()
		expect(onReady).toHaveBeenCalledExactlyOnceWith(candidate('/available'))
	})

	it('uses the newest callback without restarting a pending attempt', async () => {
		const pending = deferred()
		prepare.mockReturnValueOnce(pending.promise)
		await render()
		await tick()
		const replacement = vi.fn()
		options = { ...options, onReady: replacement }
		await render()
		await flush(() => {
			pending.resolve({ status: 'ready', candidate: candidate('/first') })
		})
		expect(onReady).not.toHaveBeenCalled()
		expect(replacement).toHaveBeenCalledExactlyOnceWith(candidate('/first'))
		expect(prepare).toHaveBeenCalledTimes(1)
	})

	it('handles thrown preparation without poisoning later attempts', async () => {
		prepare.mockRejectedValueOnce(new Error('Network unavailable'))
		await render()
		await tick()
		expect(state).toMatchObject({ status: 'error', reason: 'request-failed' })
		await flush(() => {
			state.retry()
		})
		await tick()
		expect(onReady).toHaveBeenCalledTimes(1)
	})

	it('does not emit after unmount, even if the adapter ignores cancellation', async () => {
		const pending = deferred()
		prepare.mockReturnValueOnce(pending.promise)
		await render()
		await tick()
		await flush(() => {
			root.unmount()
		})
		await flush(() => {
			pending.resolve({ status: 'ready', candidate: candidate('/first') })
		})
		expect(onReady).not.toHaveBeenCalled()
	})
})
