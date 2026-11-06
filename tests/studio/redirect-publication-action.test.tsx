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
describe('redirect publish review action', () => {
	it('reviews first, preserves the native shortcut, and never invokes unguarded native publishing', async () => {
		await render()
		await handle()
		expect(host.textContent).toContain('/before')
		expect(host.textContent).toContain('/after')
		expect(description?.shortcut).toBe('Ctrl+Alt+P')
		expect(mock.publish).not.toHaveBeenCalled()
		await click('Publish')
		expect(mock.publish).toHaveBeenCalledOnce()
		expect(mock.nativeHandle).not.toHaveBeenCalled()
		expect(mock.toast).toHaveBeenCalledWith(
			expect.objectContaining({ title: 'Redirect published' }),
		)
		expect(props.onComplete).toHaveBeenCalledOnce()
	})
	it('does not review when Sanity denies publishing', async () => {
		native.disabled = true
		await render()
		await handle()
		expect(mock.review).not.toHaveBeenCalled()
		expect(description?.disabled).toBe(true)
	})
	it('blocks the modal confirm if permissions change after review', async () => {
		await render()
		await handle()
		native.disabled = true
		await render()
		await click('Publish')
		expect(mock.publish).not.toHaveBeenCalled()
		expect(host.textContent).toContain('Review out of date')
	})
	it('blocks new draft edits and pending sync while the dialog is open', async () => {
		await render()
		await handle()
		props = { ...props, draft: { ...props.draft!, _rev: 'new' } }
		mock.syncing = true
		await render()
		await click('Publish')
		expect(mock.publish).not.toHaveBeenCalled()
	})
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
		await click('Publish')
		native.disabled = true
		await render()
		expect(isCurrent?.()).toBe(false)
		await act(async () => {
			finish?.({ status: 'blocked', reason: 'review-stale' })
			await Promise.resolve()
		})
		expect(mock.toast).not.toHaveBeenCalled()
	})
	it('retires through the same reviewed publish path', async () => {
		mock.review.mockResolvedValue({
			status: 'ready',
			review: { ...review, after: { ...review.after, enabled: false } },
		})
		await render()
		await handle()
		expect(host.textContent).toContain('website refreshes')
		await click('Retire redirect')
		expect(mock.toast).toHaveBeenCalledWith(
			expect.objectContaining({ title: 'Redirect retired' }),
		)
	})
	it('lets editors retry a failed check without closing', async () => {
		mock.review.mockResolvedValueOnce({
			status: 'blocked',
			reason: 'request-failed',
		})
		await render()
		await handle()
		expect(host.textContent).toContain('Check your connection')
		await click('Retry')
		expect(mock.review).toHaveBeenCalledTimes(2)
		expect(host.textContent).toContain('/after')
	})
	it('allows dismissal and recovery without sending another publish', async () => {
		mock.publish.mockResolvedValue({ status: 'unknown' })
		await render()
		await handle()
		await click('Publish')
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
