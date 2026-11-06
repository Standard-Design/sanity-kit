// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ThemeProvider } from '@sanity/ui'
import { buildTheme } from '@sanity/ui/theme'
import type {
	DocumentActionComponent,
	DocumentActionDescription,
	DocumentActionProps,
} from 'sanity'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
const mock = vi.hoisted(() => ({
	client: {},
	syncing: false,
	validation: {
		isValidating: false,
		revision: 'draft',
		validation: [] as { level: string }[],
	},
	review: vi.fn(),
	publish: vi.fn(),
	reconcile: vi.fn(),
	getPending: vi.fn(),
	toast: vi.fn(),
	nativeHandle: vi.fn(),
}))
vi.mock('sanity', () => ({
	useClient: () => mock.client,
	useSyncState: () => ({ isSyncing: mock.syncing }),
	useValidationStatus: () => mock.validation,
}))
vi.mock('@sanity/ui/toast', () => ({ useToast: () => ({ push: mock.toast }) }))
vi.mock('../../src/studio/redirects/publication.js', () => ({
	createRedirectPublicationController: () => ({
		review: mock.review,
		publish: mock.publish,
		reconcile: mock.reconcile,
		getPending: mock.getPending,
	}),
}))
vi.mock('../../src/studio/url/publication-action.js', () => ({
	RedirectDestination: ({
		value,
		previous,
	}: {
		value: string
		previous?: boolean
	}) => <span data-previous={previous}>{value}</span>,
	ConflictRecord: ({ conflict }: { conflict: { pathname: string } }) => (
		<a>{conflict.pathname}</a>
	),
}))
import { createRedirectPublishAction } from '../../src/studio/redirects/publication-action.js'
const review = {
	documentId: 'rule',
	draftRevision: 'draft',
	publishedRevision: 'live',
	before: {
		source: '/old',
		destination: '/before',
		status: 301,
		enabled: true,
	},
	after: { source: '/old', destination: '/after', status: 301, enabled: true },
}
let host: HTMLDivElement,
	root: Root,
	props: DocumentActionProps,
	native: DocumentActionDescription,
	description: DocumentActionDescription | null,
	action: DocumentActionComponent
function Harness() {
	description = action(props)
	const dialog = description?.dialog
	return dialog && 'content' in dialog ? (
		<>
			{dialog.content}
			{'footer' in dialog && dialog.footer}
		</>
	) : null
}
async function render() {
	await act(async () => {
		await Promise.resolve()
		root.render(
			<ThemeProvider theme={buildTheme()}>
				<Harness />
			</ThemeProvider>,
		)
	})
}
async function handle() {
	await act(async () => {
		description?.onHandle?.()
		await Promise.resolve()
	})
}
async function click(text: string) {
	const button = [...host.querySelectorAll('button')].find(
		(button) => button.textContent === text,
	)
	expect(button).toBeDefined()
	await act(async () => {
		button?.click()
		await Promise.resolve()
	})
}
beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
	vi.clearAllMocks()
	mock.getPending.mockReturnValue(null)
	mock.syncing = false
	mock.validation = { isValidating: false, revision: 'draft', validation: [] }
	mock.review.mockResolvedValue({ status: 'ready', review })
	mock.publish.mockResolvedValue({ status: 'published' })
	mock.reconcile.mockResolvedValue({ status: 'published' })
	props = {
		id: 'rule',
		type: 'sanityKitRedirect',
		liveEdit: false,
		initialValueResolved: true,
		draft: { _id: 'drafts.rule', _type: 'sanityKitRedirect', _rev: 'draft' },
		published: { _id: 'rule', _type: 'sanityKitRedirect', _rev: 'live' },
		onComplete: vi.fn(),
	} as unknown as DocumentActionProps
	native = {
		label: 'Publish',
		disabled: false,
		onHandle: mock.nativeHandle,
		shortcut: 'Ctrl+Alt+P',
	}
	action = createRedirectPublishAction(() => native, {
		pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
	})
	host = document.createElement('div')
	document.body.append(host)
	root = createRoot(host)
})
afterEach(async () => {
	await act(async () => {
		root.unmount()
		await Promise.resolve()
	})
	host.remove()
})
describe('redirect publish action', () => {
	it('checks and publishes in one action without a confirmation dialog or success notice', async () => {
		await render()
		await handle()
		expect(description?.shortcut).toBe('Ctrl+Alt+P')
		expect(mock.review).toHaveBeenCalledOnce()
		expect(mock.publish).toHaveBeenCalledOnce()
		expect(mock.publish.mock.calls[0]?.[0]).toEqual(review)
		expect(description?.dialog).toBeNull()
		expect(mock.nativeHandle).not.toHaveBeenCalled()
		expect(mock.toast).not.toHaveBeenCalled()
		expect(props.onComplete).toHaveBeenCalledOnce()
	})
	it('does not review when Sanity denies publishing', async () => {
		native.disabled = true
		await render()
		await handle()
		expect(mock.review).not.toHaveBeenCalled()
		expect(description?.disabled).toBe(true)
	})
	it.each(['permission', 'draft', 'sync'] as const)(
		'blocks publishing if %s changes while checks run',
		async (change) => {
			let finish!: (value: { status: 'ready'; review: typeof review }) => void
			mock.review.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						finish = resolve
					}),
			)
			await render()
			await handle()
			expect(description?.dialog).toBeNull()
			expect(description?.disabled).toBe(true)
			if (change === 'permission') native.disabled = true
			if (change === 'draft')
				props = { ...props, draft: { ...props.draft!, _rev: 'new' } }
			if (change === 'sync') mock.syncing = true
			await render()
			await act(async () => {
				finish({ status: 'ready', review })
				await Promise.resolve()
			})
			expect(mock.publish).not.toHaveBeenCalled()
			expect(host.textContent).toContain('Changes need another check')
		},
	)
	it('rechecks current state at the service write boundary', async () => {
		let isCurrent: (() => boolean) | undefined
		let finish:
			((value: { status: 'blocked'; reason: string }) => void) | undefined
		mock.publish.mockImplementation(
			(_review: unknown, choice: { isCurrent: () => boolean }) => {
				isCurrent = choice.isCurrent
				return new Promise((resolve) => {
					finish = resolve
				})
			},
		)
		await render()
		await handle()
		native.disabled = true
		await render()
		expect(isCurrent?.()).toBe(false)
		await act(async () => {
			finish?.({ status: 'blocked', reason: 'review-stale' })
			await Promise.resolve()
		})
		expect(mock.toast).not.toHaveBeenCalled()
	})
	it('retires through the same single-click publish path', async () => {
		mock.review.mockResolvedValue({
			status: 'ready',
			review: { ...review, after: { ...review.after, enabled: false } },
		})
		await render()
		await handle()
		expect(mock.publish).toHaveBeenCalledOnce()
		expect(mock.publish.mock.calls[0]?.[0]).toEqual({
			...review,
			after: { ...review.after, enabled: false },
		})
		expect(description?.dialog).toBeNull()
		expect(mock.toast).not.toHaveBeenCalled()
	})
	it('lets editors retry a failed check without closing', async () => {
		mock.review.mockResolvedValueOnce({
			status: 'blocked',
			reason: 'request-failed',
		})
		await render()
		await handle()
		expect(host.textContent).toContain('Check your connection')
		await click('Retry publish')
		expect(mock.review).toHaveBeenCalledTimes(2)
		expect(mock.publish).toHaveBeenCalledOnce()
		expect(description?.dialog).toBeNull()
	})
	it('allows dismissal and recovery without sending another publish', async () => {
		mock.publish.mockResolvedValue({ status: 'unknown' })
		await render()
		await handle()
		expect(host.textContent).toContain('Could not confirm')
		await click('Close')
		expect(description?.label).toBe('Check publish status')
		await handle()
		await click('Check publish status')
		expect(mock.reconcile).toHaveBeenCalledWith('rule')
		expect(mock.publish).toHaveBeenCalledOnce()
		expect(mock.toast).toHaveBeenCalledWith(
			expect.objectContaining({ title: 'Redirect published' }),
		)
	})
	it('shows a conflict notice without writing', async () => {
		mock.review.mockResolvedValue({
			status: 'blocked',
			reason: 'invalid-redirect',
			diagnostic: { ok: false, message: 'Another redirect uses this old URL.' },
		})
		await render()
		await handle()
		expect(host.textContent).toContain('Another redirect uses this old URL.')
		expect(mock.publish).not.toHaveBeenCalled()
	})
	it('ignores duplicate activation while checking', async () => {
		let finish!: (value: { status: 'ready'; review: typeof review }) => void
		mock.review.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve
				}),
		)
		await render()
		await handle()
		await handle()
		expect(mock.review).toHaveBeenCalledOnce()
		await act(async () => {
			finish({ status: 'ready', review })
			await Promise.resolve()
		})
		expect(mock.publish).toHaveBeenCalledOnce()
	})
	it('restores pending recovery even with no draft and a disabled native button', async () => {
		mock.getPending.mockReturnValue(review)
		props = { ...props, draft: null }
		native.disabled = true
		await render()
		expect(description?.disabled).toBe(false)
		await handle()
		await click('Check publish status')
		expect(mock.publish).not.toHaveBeenCalled()
		expect(mock.toast).toHaveBeenCalledOnce()
	})
	it('reports corrupt recovery without crashing or enabling a fresh write', async () => {
		mock.getPending.mockImplementation(() => {
			throw new Error('Malformed')
		})
		await render()
		await handle()
		expect(host.textContent).toContain('saved confirmation information')
		expect(mock.review).not.toHaveBeenCalled()
		expect(mock.publish).not.toHaveBeenCalled()
	})
})
