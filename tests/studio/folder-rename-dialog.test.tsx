// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ThemeProvider } from '@sanity/ui'
import { buildTheme } from '@sanity/ui/theme'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FolderRenameDialog } from '../../src/studio/pages/folder-rename-dialog.js'
import type {
	createFolderRenameController,
	FolderRenameReview,
	FolderRenameWriteResult,
} from '../../src/studio/folders/rename-write.js'
import type { FolderRenameReceipt } from '../../src/studio/folders/rename-pending.js'

type Controller = ReturnType<typeof createFolderRenameController>
const review: FolderRenameReview = {
	operationId: 'rename-proof',
	createRedirects: true,
	plan: {
		oldPathname: '/about/company',
		newPathname: '/about/business',
		folderChanges: [
			{
				key: 'company',
				oldPathname: '/about/company',
				newPathname: '/about/business',
			},
		],
		pageChanges: [
			{
				id: 'team',
				revision: 'published-rev',
				schemaType: 'page',
				pathField: 'pathname.current',
				oldPathname: '/about/company/team',
				newPathname: '/about/business/team',
				version: 'published',
			},
			{
				id: 'drafts.team',
				revision: 'draft-rev',
				schemaType: 'page',
				pathField: 'pathname.current',
				oldPathname: '/about/company/team',
				newPathname: '/about/business/team',
				version: 'draft',
			},
		],
		redirects: {
			creates: [
				{
					_type: 'sanityKitRedirect',
					source: '/about/company/team',
					destination: '/about/business/team',
					status: 301,
					enabled: true,
					origin: 'url-change',
				},
			],
			updates: [
				{
					id: 'redirect',
					revision: 'redirect-rev',
					source: '/old-team',
					oldDestination: '/about/company/team',
					newDestination: '/about/business/team',
					status: 301,
				},
			],
		},
		reviewVersions: [],
		guards: [],
		projectedUrls: [],
		reviewBytes: 100,
	},
}
const receipt: FolderRenameReceipt = {
	_id: 'sanityKit.folderRename.rename-proof',
	_type: 'sanityKitFolderRename',
	operationId: review.operationId,
	oldPathname: review.plan.oldPathname,
	newPathname: review.plan.newPathname,
	createRedirects: true,
	evidence: '{}',
}
function controller() {
	return {
		review: vi
			.fn<Controller['review']>()
			.mockResolvedValue({ status: 'ready', review }),
		apply: vi.fn<Controller['apply']>().mockResolvedValue({
			status: 'renamed',
			operationId: review.operationId,
		}),
		reconcile: vi.fn<Controller['reconcile']>().mockResolvedValue({
			status: 'renamed',
			operationId: review.operationId,
		}),
		getPending: vi.fn<Controller['getPending']>().mockReturnValue(null),
	}
}
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
const button = (label: string) =>
	[...document.querySelectorAll('button')].find(
		(item) => item.textContent === label,
	)
const input = () =>
	document.querySelector<HTMLInputElement>('input:not([type="checkbox"])')!
async function typeName(value: string) {
	await flush(() => {
		Object.getOwnPropertyDescriptor(
			HTMLInputElement.prototype,
			'value',
		)!.set!.call(input(), value)
		input().dispatchEvent(new Event('input', { bubbles: true }))
	})
}
async function click(label: string) {
	expect(button(label), `Missing ${label} button`).toBeDefined()
	await flush(() => button(label)!.click())
}
async function render(
	service = controller(),
	pathname: string | null = '/about/company',
) {
	const onClose = vi.fn()
	const onSettled = vi.fn()
	await flush(() =>
		root.render(
			<ThemeProvider theme={buildTheme()}>
				<FolderRenameDialog
					{...(pathname ? { pathname } : {})}
					controller={service}
					onClose={onClose}
					onSettled={onSettled}
				/>
			</ThemeProvider>,
		),
	)
	return { service, onClose, onSettled }
}

describe('reviewed folder rename dialog', () => {
	it('opens without a write, then reviews the name and explicitly applies the exact proposal', async () => {
		const { service, onSettled } = await render()
		expect(input().value).toBe('company')
		expect(service.review).not.toHaveBeenCalled()
		expect(service.apply).not.toHaveBeenCalled()
		await typeName('business')
		await click('Review URL changes')
		expect(service.review).toHaveBeenCalledWith(
			{
				pathname: '/about/company',
				newName: 'business',
				createRedirects: true,
			},
			expect.any(AbortSignal),
		)
		expect(document.body.textContent).toContain('/about/company/team')
		expect(document.body.textContent).toContain('/about/business/team')
		expect(document.body.textContent).toContain('/old-team')
		expect(service.apply).not.toHaveBeenCalled()
		await click('Apply URL changes')
		expect(service.apply.mock.calls[0]?.[0]).toBe(review)
		expect(service.apply.mock.calls[0]?.[1].isCurrent).toEqual(
			expect.any(Function),
		)
		expect(document.body.textContent).toContain('Folder renamed')
		expect(onSettled).toHaveBeenCalledTimes(1)
	})
	it('invalidates the review when the redirect choice changes', async () => {
		const { service } = await render()
		await typeName('business')
		await click('Review URL changes')
		const checkbox = document.querySelector<HTMLInputElement>(
			'input[type="checkbox"]',
		)!
		expect(checkbox.checked).toBe(true)
		await flush(() => checkbox.click())
		expect(button('Apply URL changes')).toBeUndefined()
		await click('Review URL changes')
		expect(service.review).toHaveBeenLastCalledWith(
			{
				pathname: '/about/company',
				newName: 'business',
				createRedirects: false,
			},
			expect.any(AbortSignal),
		)
		expect(service.apply).not.toHaveBeenCalled()
	})
	it('blocks a stale review and requires a fresh review before another write', async () => {
		const service = controller()
		service.apply.mockResolvedValue({
			status: 'blocked',
			reason: 'review-stale',
		})
		await render(service)
		await typeName('business')
		await click('Review URL changes')
		await click('Apply URL changes')
		expect(document.querySelector('[role="alert"]')).not.toBeNull()
		expect(button('Apply URL changes')).toBeUndefined()
		expect(button('Review URL changes')).toBeDefined()
		expect(service.apply).toHaveBeenCalledTimes(1)
	})
	it('prevents closing while saving and does not resend an uncertain write', async () => {
		const service = controller()
		let finish!: (value: FolderRenameWriteResult) => void
		service.apply.mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = resolve
				}),
		)
		const { onClose, onSettled } = await render(service)
		await typeName('business')
		await click('Review URL changes')
		await click('Apply URL changes')
		expect(button('Cancel')?.disabled).toBe(true)
		expect(onClose).not.toHaveBeenCalled()
		service.getPending.mockReturnValue(receipt)
		await flush(() =>
			finish({ status: 'unknown', operationId: review.operationId }),
		)
		expect(document.querySelector('[role="alert"]')).not.toBeNull()
		expect(button('Apply URL changes')).toBeUndefined()
		await click('Check rename status')
		expect(service.reconcile).toHaveBeenCalledTimes(1)
		expect(service.apply).toHaveBeenCalledTimes(1)
		expect(document.body.textContent).toContain('Folder renamed')
		expect(onSettled).toHaveBeenCalledTimes(1)
	})
	it('lists missing access requirements without offering an Apply action', async () => {
		const service = controller()
		service.review.mockResolvedValue({
			status: 'blocked',
			reason: 'unknown-read-access',
			accessIssues: [
				{
					key: 'pages',
					label: 'All registered page versions',
					status: 'missing',
				},
			],
		})
		await render(service)
		await typeName('business')
		await click('Review URL changes')
		expect(document.querySelector('[role="alert"]')?.textContent).toContain(
			'All registered page versions (not granted)',
		)
		expect(button('Apply URL changes')).toBeUndefined()
		expect(service.apply).not.toHaveBeenCalled()
	})
	it('abandons an outstanding review when the dialog unmounts', async () => {
		const service = controller()
		let finish!: (value: Awaited<ReturnType<Controller['review']>>) => void
		service.review.mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = resolve
				}),
		)
		await render(service)
		await typeName('business')
		await click('Review URL changes')
		const signal = service.review.mock.calls[0]?.[1]
		expect(signal?.aborted).toBe(false)
		await flush(() => root.render(null))
		expect(signal?.aborted).toBe(true)
		await flush(() => finish({ status: 'ready', review }))
		expect(button('Apply URL changes')).toBeUndefined()
		expect(service.apply).not.toHaveBeenCalled()
	})
	it('starts a fresh review when its controller is replaced during a pending check', async () => {
		const first = controller()
		let finish!: (value: Awaited<ReturnType<Controller['review']>>) => void
		first.review.mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = resolve
				}),
		)
		await render(first)
		await typeName('business')
		await click('Review URL changes')
		const next = controller()
		await render(next)
		expect(first.review.mock.calls[0]?.[1]?.aborted).toBe(true)
		expect(button('Review URL changes')?.disabled).toBe(false)
		await flush(() => finish({ status: 'ready', review }))
		expect(button('Apply URL changes')).toBeUndefined()
		await click('Review URL changes')
		expect(next.review).toHaveBeenCalledTimes(1)
		expect(first.apply).not.toHaveBeenCalled()
	})
	it('recovers a dispatched write after replacing its controller without resending it', async () => {
		const first = controller()
		let finish!: (value: FolderRenameWriteResult) => void
		first.apply.mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = resolve
				}),
		)
		await render(first)
		await typeName('business')
		await click('Review URL changes')
		await click('Apply URL changes')
		const next = controller()
		next.getPending.mockReturnValue(receipt)
		const { onSettled } = await render(next)
		expect(first.apply.mock.calls[0]?.[1].isCurrent()).toBe(false)
		expect(button('Check rename status')?.disabled).toBe(false)
		await flush(() =>
			finish({ status: 'unknown', operationId: review.operationId }),
		)
		expect(button('Apply URL changes')).toBeUndefined()
		await click('Check rename status')
		expect(next.reconcile).toHaveBeenCalledTimes(1)
		expect(next.review).not.toHaveBeenCalled()
		expect(next.apply).not.toHaveBeenCalled()
		expect(first.apply).toHaveBeenCalledTimes(1)
		expect(onSettled).toHaveBeenCalledTimes(1)
	})
	it('restores a pending operation without a folder pathname and only checks its outcome', async () => {
		const service = controller()
		service.getPending.mockReturnValue(receipt)
		const { onSettled } = await render(service, null)
		expect(service.review).not.toHaveBeenCalled()
		expect(service.apply).not.toHaveBeenCalled()
		expect(document.body.textContent).toContain('/about/company')
		expect(document.body.textContent).toContain('/about/business')
		expect(button('Review URL changes')).toBeUndefined()
		await click('Check rename status')
		expect(service.reconcile).toHaveBeenCalledTimes(1)
		expect(onSettled).toHaveBeenCalledTimes(1)
	})
})
