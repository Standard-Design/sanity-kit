// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ThemeProvider } from '@sanity/ui'
import { buildTheme } from '@sanity/ui/theme'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FolderRemoveDialog } from '../../src/studio/pages/folder-remove-dialog.js'
import { createFolderSyncController } from '../../src/studio/folders/sync-controller.js'
import type { FolderSyncResult } from '../../src/studio/folders/synchronize.js'

async function flush(action: () => void) {
	await act(async () => {
		action()
		await Promise.resolve()
	})
}

let root: Root
let host: HTMLDivElement
beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
	vi.stubGlobal('matchMedia', () => ({
		matches: false,
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
	}))
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	)
	host = document.createElement('div')
	document.body.append(host)
	root = createRoot(host)
})
afterEach(async () => {
	await flush(() => root.unmount())
	host.remove()
	vi.unstubAllGlobals()
})
const button = (text: string) =>
	[...document.querySelectorAll('button')].find(
		(item) => item.textContent === text,
	)!
async function render(
	remove: (pathname: string, signal?: AbortSignal) => Promise<FolderSyncResult>,
) {
	const controller = createFolderSyncController(
		vi.fn(),
		vi.fn(),
		undefined,
		remove,
	)
	controller.start()
	const close = vi.fn()
	await flush(() =>
		root.render(
			<ThemeProvider theme={buildTheme()}>
				<FolderRemoveDialog
					pathname="/empty"
					folderSync={controller}
					onClose={close}
				/>
			</ThemeProvider>,
		),
	)
	return { controller, close }
}
async function click(text: string) {
	await flush(() => button(text).click())
}

describe('empty-folder removal confirmation', () => {
	it('does not write on open; confirmation shows progress, then success', async () => {
		let finish!: (value: FolderSyncResult) => void
		const remove = vi.fn(
			() =>
				new Promise<FolderSyncResult>((resolve) => {
					finish = resolve
				}),
		)
		const { controller } = await render(remove)
		expect(remove).not.toHaveBeenCalled()
		expect(document.body.textContent).toContain('/empty')
		await click('Remove folder')
		expect(remove).toHaveBeenCalledWith('/empty', expect.any(AbortSignal))
		expect(document.querySelector('[role="status"]')?.textContent).toContain(
			'Checking and removing folder',
		)
		expect(button('Cancel').disabled).toBe(true)
		await flush(() => finish({ status: 'synced', count: 1 }))
		expect(document.body.textContent).toContain('Folder removed')
		expect(button('Remove folder')).toBeUndefined()
		controller.stop()
	})
	it('shows an actionable occupied-folder error without offering to retry removal', async () => {
		const { controller } = await render(
			vi
				.fn()
				.mockResolvedValue({ status: 'blocked', reason: 'folder-not-empty' }),
		)
		await click('Remove folder')
		expect(document.querySelector('[role="alert"]')?.textContent).toContain(
			'contains a page or subfolder',
		)
		expect(button('Remove folder')).toBeUndefined()
		expect(button('Close')).toBeDefined()
		controller.stop()
	})
	it('offers a read-only recheck after an uncertain result', async () => {
		const remove = vi
			.fn()
			.mockResolvedValueOnce({ status: 'blocked', reason: 'outcome-unknown' })
			.mockResolvedValueOnce({ status: 'synced', count: 1 })
		const { controller } = await render(remove)
		await click('Remove folder')
		expect(document.querySelector('[role="alert"]')?.textContent).toContain(
			'Checking does not repeat the removal',
		)
		expect(button('Remove folder')).toBeUndefined()
		await click('Check again')
		expect(document.body.textContent).toContain('Folder removed')
		controller.stop()
	})
	it('lists missing access instead of implying an invisible folder is empty', async () => {
		const { controller } = await render(
			vi.fn().mockResolvedValue({
				status: 'blocked',
				reason: 'unknown-read-access',
				accessIssues: [
					{ key: 'pages', label: 'All page versions', status: 'missing' },
				],
			}),
		)
		await click('Remove folder')
		expect(document.querySelector('[role="alert"]')?.textContent).toContain(
			'All page versions (not granted)',
		)
		controller.stop()
	})
})
