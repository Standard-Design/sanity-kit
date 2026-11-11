// @vitest-environment jsdom
import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ThemeProvider } from '@sanity/ui'
import { buildTheme } from '@sanity/ui/theme'
import type {
	DocumentActionComponent,
	DocumentActionDescription,
	DocumentActionProps,
} from 'sanity'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	configuration,
	setting,
	inventory,
	choice,
} from './collection-prefix-fixtures.js'
import { createCollectionPrefixPlanner } from '../../src/studio/collections/prefix-plan.js'
const mock = vi.hoisted(() => ({
	client: { config: () => ({ projectId: 'project', dataset: 'test' }) },
	workspace: {},
	currentUser: { id: 'user' },
	grantsStore: {},
	toast: vi.fn(),
	nativeHandle: vi.fn(),
	syncing: false,
	validation: {
		isValidating: false,
		revision: 'draft-settings',
		validation: [] as { level: string }[],
	},
	settings: {
		review: vi.fn(),
		publish: vi.fn(),
		getPending: vi.fn(),
		reconcile: vi.fn(),
	},
	prefix: {
		review: vi.fn(),
		publish: vi.fn(),
		getPending: vi.fn(),
		reconcile: vi.fn(),
	},
	authorize: vi.fn(),
	readAccess: vi.fn(),
}))
vi.mock('sanity', () => ({
	useClient: () => mock.client,
	useWorkspace: () => mock.workspace,
	useCurrentUser: () => mock.currentUser,
	useGrantsStore: () => mock.grantsStore,
	useSyncState: () => ({ isSyncing: mock.syncing }),
	useValidationStatus: () => mock.validation,
}))
vi.mock('@sanity/ui/toast', () => ({ useToast: () => ({ push: mock.toast }) }))
vi.mock('../../src/studio/collections/prefix-native-access.js', () => ({
	createNativeCollectionPrefixReadAccess: () => mock.readAccess,
}))
vi.mock('../../src/studio/collections/prefix-native-write-access.js', () => ({
	createNativeCollectionPrefixWriteAccess: () => mock.authorize,
}))
vi.mock('../../src/studio/collections/prefix-write.js', () => ({
	createCollectionPrefixController: () => mock.prefix,
}))
vi.mock('../../src/studio/collections/settings-publication-write.js', () => ({
	createCollectionSettingsPublicationController: () => mock.settings,
}))
vi.mock('../../src/studio/collections/prefix-publication-dialog.js', () => ({
	CollectionPrefixPublicationDialog: (props: {
		collectionTitle: string
		state: { phase: string; review?: unknown }
		onClose: () => void
		onPublish: (review: unknown) => void
		onCreateRedirectsChange: (value: boolean) => void
		onCheckStatus: () => void
	}) => (
		<section aria-label="Prefix review">
			<p>
				{props.collectionTitle}: {props.state.phase}
			</p>
			<button onClick={() => props.onCreateRedirectsChange(false)}>
				No redirects
			</button>
			<button onClick={() => props.onPublish(props.state.review)}>
				Confirm prefix
			</button>
			<button onClick={props.onClose}>Close prefix</button>
			<button onClick={props.onCheckStatus}>Check prefix status</button>
		</section>
	),
}))
import { createCollectionSettingsPublishAction } from '../../src/studio/collections/settings-publication-action.js'
let host: HTMLDivElement,
	root: Root,
	props: DocumentActionProps,
	action: DocumentActionComponent,
	native: DocumentActionDescription | null,
	description: DocumentActionDescription | null
function Harness() {
	description = action(props)
	return (
		<>
			{description?.dialog && description.dialog.type === 'custom'
				? description.dialog.component
				: null}
		</>
	)
}
async function render(strict = false) {
	await act(async () => {
		root.render(
			<ThemeProvider theme={buildTheme()}>
				{strict ? (
					<StrictMode>
						<Harness />
					</StrictMode>
				) : (
					<Harness />
				)}
			</ThemeProvider>,
		)
		await Promise.resolve()
	})
}
async function handle() {
	await act(async () => {
		description?.onHandle?.()
		await Promise.resolve()
	})
}
async function click(text: string) {
	const button = [...document.querySelectorAll('button')].find(
		(button) => button.textContent === text,
	)
	expect(button).toBeDefined()
	await act(async () => {
		button!.click()
		await Promise.resolve()
	})
}
function settingsReview() {
	return {
		projectId: 'project',
		dataset: 'test',
		operationId: 'settings-operation',
		classification: {
			collection: 'journal',
			documentId: 'journal-settings',
			draftRevision: 'draft-settings',
			publishedRevision: props.published?._rev ?? null,
			prefix: '/journal',
			prefixOwnership: 'editable',
			...(props.published
				? { kind: 'unchanged-prefix' }
				: { kind: 'first-publication', activatesUrls: true }),
		},
		settings: { draft: props.draft, published: props.published },
	}
}
beforeEach(() => {
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
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
	vi.clearAllMocks()
	mock.settings.getPending.mockReturnValue(null)
	mock.prefix.getPending.mockReturnValue(null)
	mock.syncing = false
	mock.validation = {
		isValidating: false,
		revision: 'draft-settings',
		validation: [],
	}
	props = {
		id: 'journal-settings',
		type: 'sanityKitCollectionRoute',
		liveEdit: false,
		initialValueResolved: true,
		draft: setting('drafts.journal-settings', '/journal', 'draft-settings'),
		published: null,
		onComplete: vi.fn(),
	} as unknown as DocumentActionProps
	native = {
		label: 'Publish',
		shortcut: 'Ctrl+Alt+P',
		disabled: false,
		onHandle: mock.nativeHandle,
	}
	mock.settings.review.mockImplementation(() =>
		Promise.resolve({ status: 'ready', review: settingsReview() }),
	)
	mock.settings.publish.mockResolvedValue({
		status: 'published',
		operationId: 'settings-operation',
	})
	mock.settings.reconcile.mockResolvedValue({
		status: 'unknown',
		operationId: 'settings-operation',
	})
	mock.prefix.review.mockImplementation((input: typeof choice) => {
		const planned = createCollectionPrefixPlanner(configuration).plan(
			input,
			inventory(),
		)
		if (!planned.ok) throw Error('Bad prefix fixture')
		return Promise.resolve({
			status: 'ready',
			review: {
				projectId: 'project',
				dataset: 'test',
				operationId: 'prefix-operation',
				plan: planned.value,
				createRedirects: input.createRedirects,
				settings: { published: props.published, draft: props.draft },
			},
		})
	})
	mock.prefix.publish.mockResolvedValue({
		status: 'published',
		operationId: 'prefix-operation',
	})
	action = createCollectionSettingsPublishAction(() => native, configuration)
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
	vi.unstubAllGlobals()
	vi.useRealTimers()
})
describe('collection settings native Publish integration', () => {
	it.each(['first', 'metadata'] as const)(
		'publishes %s settings without a routine dialog or native handler',
		async (kind) => {
			if (kind === 'metadata')
				props = {
					...props,
					published: setting() as unknown as DocumentActionProps['published'],
				}
			await render()
			expect(description?.disabled).toBe(false)
			expect(description?.shortcut).toBe('Ctrl+Alt+P')
			await handle()
			expect(mock.settings.review).toHaveBeenCalledOnce()
			expect(mock.settings.publish).toHaveBeenCalledOnce()
			expect(mock.prefix.review).not.toHaveBeenCalled()
			expect(mock.nativeHandle).not.toHaveBeenCalled()
			expect(description?.dialog).toBeNull()
			expect(mock.toast).toHaveBeenCalledWith(
				expect.objectContaining({
					status: 'success',
					title: 'Collection settings published',
				}),
			)
			expect(props.onComplete).toHaveBeenCalledOnce()
		},
	)
	it('survives Strict Mode effect replay', async () => {
		await render(true)
		await handle()
		expect(mock.settings.publish).toHaveBeenCalledOnce()
		expect(props.onComplete).toHaveBeenCalledOnce()
	})
	it('opens the existing prefix review and leaves publishing to explicit confirmation', async () => {
		props = {
			...props,
			published: setting() as unknown as DocumentActionProps['published'],
			draft: setting(
				'drafts.journal-settings',
				'/blog',
				'draft-settings',
			) as unknown as DocumentActionProps['draft'],
		}
		await render()
		await handle()
		expect(mock.settings.review).not.toHaveBeenCalled()
		expect(mock.prefix.review).toHaveBeenCalledOnce()
		expect(mock.prefix.publish).not.toHaveBeenCalled()
		expect(host.textContent).toContain('Journal: ready')
		expect(description?.label).toBe('Publish')
		await click('No redirects')
		expect(mock.prefix.review).toHaveBeenLastCalledWith(
			expect.objectContaining({ createRedirects: false }),
			expect.any(AbortSignal),
		)
		await click('Confirm prefix')
		expect(mock.prefix.publish).toHaveBeenCalledOnce()
		expect(mock.nativeHandle).not.toHaveBeenCalled()
	})
	it('resets the action immediately when uncertain prefix publishing is confirmed and auto-closes', async () => {
		props = {
			...props,
			published: setting() as unknown as DocumentActionProps['published'],
			draft: setting(
				'drafts.journal-settings',
				'/blog',
				'draft-settings',
			) as unknown as DocumentActionProps['draft'],
		}
		mock.prefix.publish.mockResolvedValueOnce({
			status: 'unknown',
			operationId: 'prefix-operation',
		})
		mock.prefix.reconcile.mockResolvedValueOnce({
			status: 'published',
			operationId: 'prefix-operation',
		})
		await render()
		await handle()
		await click('Confirm prefix')
		expect(description?.label).toBe('Publish')
		expect(description?.disabled).toBe(true)
		await click('Close prefix')
		expect(description?.label).toBe('Check publish status')
		expect(description?.disabled).toBe(false)
		await handle()
		expect(description?.label).toBe('Publish')
		await click('Check prefix status')
		expect(description?.dialog).toBeNull()
		expect(description?.label).toBe('Publish')
		expect(mock.toast).toHaveBeenCalledOnce()
		props = {
			...props,
			published: { ...props.draft!, _id: props.id },
			draft: null,
		}
		native = { ...native!, disabled: true }
		await render()
		await handle()
		expect(description?.disabled).toBe(true)
		expect(description?.dialog).toBeNull()
		expect(mock.prefix.review).toHaveBeenCalledOnce()
	})
	it('clears recovery routing when a closed prefix check later proves it never dispatched', async () => {
		vi.useFakeTimers()
		props = {
			...props,
			published: setting() as unknown as DocumentActionProps['published'],
			draft: setting(
				'drafts.journal-settings',
				'/blog',
				'draft-settings',
			) as unknown as DocumentActionProps['draft'],
		}
		let finish!: (result: unknown) => void
		mock.prefix.publish.mockReturnValueOnce(
			new Promise((resolve) => {
				finish = resolve
			}),
		)
		mock.prefix.reconcile.mockResolvedValue({
			status: 'blocked',
			reason: 'no-pending-publish',
		})
		await render()
		await handle()
		await click('Confirm prefix')
		await act(async () => {
			await vi.advanceTimersByTimeAsync(30_001)
		})
		await click('Close prefix')
		expect(description?.label).toBe('Check publish status')
		await act(async () => {
			finish({ status: 'blocked', reason: 'aborted' })
			await Promise.resolve()
		})
		expect(description?.label).toBe('Publish')
		expect(description?.dialog).toBeNull()
		expect(mock.toast).not.toHaveBeenCalled()
		// The next click follows the now-current classification, not a sticky
		// flag left over from the dismissed prefix workflow.
		props = {
			...props,
			draft: setting(
				'drafts.journal-settings',
				'/journal',
				'draft-settings',
			) as unknown as DocumentActionProps['draft'],
		}
		await render()
		await handle()
		expect(mock.settings.publish).toHaveBeenCalledOnce()
		expect(mock.prefix.review).toHaveBeenCalledOnce()
	})
	it.each(['native', 'sync', 'validation', 'errors', 'release'] as const)(
		'keeps native %s restrictions',
		async (kind) => {
			if (kind === 'native') native = { ...native!, disabled: true }
			if (kind === 'sync') mock.syncing = true
			if (kind === 'validation') mock.validation.revision = 'older'
			if (kind === 'errors') mock.validation.validation = [{ level: 'error' }]
			if (kind === 'release') props = { ...props, version: props.draft! }
			await render()
			expect(description?.disabled).toBe(true)
			await handle()
			expect(mock.settings.publish).not.toHaveBeenCalled()
			expect(mock.prefix.review).not.toHaveBeenCalled()
		},
	)
	it('shows a failed prepare notice with a read-only Retry', async () => {
		mock.settings.review.mockResolvedValueOnce({
			status: 'blocked',
			reason: 'request-failed',
		})
		await render()
		await handle()
		expect(document.body.textContent).toContain('Settings could not be checked')
		expect(description?.label).toBe('Publish')
		expect(mock.settings.publish).not.toHaveBeenCalled()
		await click('Retry')
		expect(mock.settings.review).toHaveBeenCalledTimes(2)
		expect(mock.settings.publish).toHaveBeenCalledOnce()
	})
	it('keeps Publish on the Studio button while the prefix dialog checks and writes', async () => {
		props = {
			...props,
			published: setting() as unknown as DocumentActionProps['published'],
			draft: setting(
				'drafts.journal-settings',
				'/blog',
				'draft-settings',
			) as unknown as DocumentActionProps['draft'],
		}
		const review = mock.prefix.review.getMockImplementation()!
		let finishReview!: (result: unknown) => void
		mock.prefix.review.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finishReview = resolve
				}),
		)
		let finishPublish!: (result: unknown) => void
		mock.prefix.publish.mockImplementationOnce(() => {
			mock.settings.getPending.mockReturnValue({
				_type: 'sanityKitCollectionPrefixPublication',
				operationId: 'prefix-operation',
			})
			return new Promise((resolve) => {
				finishPublish = resolve
			})
		})
		await render()
		await handle()
		expect(host.textContent).toContain('Journal: checking')
		expect(description?.label).toBe('Publish')
		expect(description?.disabled).toBe(true)
		await act(async () => {
			finishReview(await review(choice))
		})
		expect(host.textContent).toContain('Journal: ready')
		await click('Confirm prefix')
		await render()
		expect(host.textContent).toContain('Journal: publishing')
		expect(description?.label).toBe('Publish')
		expect(description?.disabled).toBe(true)
		await act(async () => {
			mock.settings.getPending.mockReturnValue(null)
			finishPublish({ status: 'published', operationId: 'prefix-operation' })
			await Promise.resolve()
		})
		expect(description?.dialog).toBeNull()
		expect(description?.label).toBe('Publish')
	})
	it('does not mistake an active settings write for an uncertain outcome', async () => {
		let finish!: (result: unknown) => void
		mock.settings.publish.mockImplementationOnce(() => {
			mock.settings.getPending.mockReturnValue({
				_type: 'sanityKitCollectionSettingsPublication',
				operationId: 'settings-operation',
			})
			return new Promise((resolve) => {
				finish = resolve
			})
		})
		await render()
		await handle()
		await render()
		expect(description?.label).toBe('Publishing…')
		expect(description?.disabled).toBe(true)
		expect(description?.dialog).toBeNull()
		await act(async () => {
			finish({ status: 'unknown', operationId: 'settings-operation' })
			await Promise.resolve()
		})
		expect(description?.dialog).not.toBeNull()
		expect(description?.label).toBe('Publish')
		await click('Close')
		expect(description?.label).toBe('Check publish status')
		expect(description?.disabled).toBe(false)
		await handle()
		expect(description?.label).toBe('Publish')
		expect(mock.settings.publish).toHaveBeenCalledOnce()
	})
	it('allows status recovery without a current draft or native Publish availability', async () => {
		props = { ...props, draft: null }
		native = { ...native!, disabled: true }
		mock.settings.getPending.mockReturnValue({
			_type: 'sanityKitCollectionSettingsPublication',
			operationId: 'older-settings',
		})
		mock.settings.reconcile.mockResolvedValue({
			status: 'published',
			operationId: 'older-settings',
		})
		await render()
		expect(description?.label).toBe('Check publish status')
		expect(description?.disabled).toBe(false)
		await handle()
		expect(document.body.textContent).toContain('We could not confirm')
		await click('Check publish status')
		expect(mock.settings.reconcile).toHaveBeenCalledWith('older-settings')
		expect(mock.settings.publish).not.toHaveBeenCalled()
	})
	it('routes persisted prefix attempts to the prefix recovery owner', async () => {
		props = { ...props, draft: null }
		native = { ...native!, disabled: true }
		const receipt = {
			_type: 'sanityKitCollectionPrefixPublication',
			operationId: 'older-prefix',
			oldPrefix: '/journal',
			newPrefix: '/blog',
		}
		mock.settings.getPending.mockReturnValue(receipt)
		mock.prefix.getPending.mockReturnValue(receipt)
		await render()
		await handle()
		expect(host.textContent).toContain('unconfirmed')
		expect(mock.settings.review).not.toHaveBeenCalled()
		expect(mock.prefix.review).not.toHaveBeenCalled()
	})
	it('never falls back to native Publish on invalid settings', async () => {
		props = {
			...props,
			draft: { ...props.draft!, collection: 'not-registered' },
		}
		await render()
		expect(description?.disabled).toBe(true)
		await handle()
		expect(mock.nativeHandle).not.toHaveBeenCalled()
		expect(mock.settings.publish).not.toHaveBeenCalled()
	})
	it('shows the affected pathname supplied by a blocked activation review', async () => {
		mock.settings.review.mockResolvedValueOnce({
			status: 'blocked',
			reason: 'url-collision',
			planFailure: { pathname: '/journal/alpha' },
		})
		await render()
		await handle()
		expect(document.body.textContent).toContain('/journal/alpha')
		expect(document.body.textContent).toContain(
			'proposed collection URLs are not available',
		)
	})
	it('shows specific unverified read requirements', async () => {
		mock.settings.review.mockResolvedValueOnce({
			status: 'blocked',
			reason: 'unknown-read-access',
			accessIssues: [
				{
					key: 'posts',
					label: 'Read all versions of post documents',
					status: 'unverified',
				},
			],
		})
		await render()
		await handle()
		expect(document.body.textContent).toContain(
			'Read all versions of post documents',
		)
	})
})
