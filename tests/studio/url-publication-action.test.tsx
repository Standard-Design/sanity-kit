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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({
	client: { config: () => ({ projectId: 'project', dataset: 'test' }) },
	syncing: false,
	validation: {
		isValidating: false,
		revision: 'draft-1',
		validation: [] as { level: string }[],
	},
	review: vi.fn(),
	publish: vi.fn(),
	reconcile: vi.fn(),
	getPending: vi.fn(),
	toast: vi.fn(),
	nativeHandle: vi.fn(),
	presentation: null as Record<string, string> | null,
}))
vi.mock('sanity/presentation', () => ({
	usePresentationParams: () => mock.presentation,
}))
vi.mock('@sanity/ui/toast', () => ({ useToast: () => ({ push: mock.toast }) }))
vi.mock('../../src/studio/pages/document-status.js', () => ({
	PageStatus: ({ id }: { id: string }) => (
		<span
			role="img"
			aria-label="Available versions: published"
			data-document-id={id}
		/>
	),
}))
vi.mock('sanity/router', () => ({
	StateLink: ({
		children,
		state,
		onClick,
		...rest
	}: {
		children: import('react').ReactNode
		state: { id: string; type: string; _searchParams: string[][] }
		onClick: () => void
	}) => (
		<a
			{...rest}
			href={`/pages-proof/${state.type}/${state.id}`}
			data-state={JSON.stringify(state)}
			onClick={(event) => {
				event.preventDefault()
				onClick()
			}}
		>
			{children}
		</a>
	),
	IntentLink: ({
		children,
		params,
		searchParams,
		onClick,
		...rest
	}: {
		children: import('react').ReactNode
		params: { id: string; type: string; mode: string }
		searchParams: string[][]
		onClick: () => void
	}) => (
		<a
			{...rest}
			href={`/intent/edit/${params.id}`}
			data-type={params.type}
			data-mode={params.mode}
			data-perspective={searchParams[0]?.[1]}
			onClick={(event) => {
				event.preventDefault()
				onClick()
			}}
		>
			{children}
		</a>
	),
}))
vi.mock('sanity', () => ({
	getPublishedId: (id: string) =>
		id.replace(/^drafts\./u, '').replace(/^versions\.[^.]+\./u, ''),
	useClient: () => mock.client,
	useSyncState: () => ({ isSyncing: mock.syncing }),
	useValidationStatus: () => mock.validation,
}))
vi.mock('../../src/studio/url/publication.js', () => ({
	createUrlPublicationController: () => ({
		review: mock.review,
		publish: mock.publish,
		reconcile: mock.reconcile,
		getPending: mock.getPending,
	}),
}))
import { createUrlPublishAction } from '../../src/studio/url/publication-action.js'
import { useUrlPublicationState } from '../../src/studio/url/publication-state.js'

const routes = {
	pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
}
const review = {
	documentId: 'page-1',
	draftRevision: 'draft-1',
	publishedRevision: 'pub-1',
	oldPathname: '/old',
	newPathname: '/new',
	affectedRedirects: [],
}
let host: HTMLDivElement
let root: Root
let props: DocumentActionProps
let description: DocumentActionDescription | null
let native: DocumentActionDescription | null
let action: DocumentActionComponent
let proposal = false
function Reporter() {
	useUrlPublicationState(
		{ projectId: 'project', dataset: 'test', documentId: props.id },
		proposal,
	)
	return null
}
function Harness() {
	description = action(props)
	const dialog = description?.dialog
	return (
		<>
			<Reporter />
			{dialog && 'content' in dialog && (
				<section aria-label="Publish URL change">
					{dialog.content}
					{'footer' in dialog && dialog.footer}
				</section>
			)}
		</>
	)
}
async function render() {
	await act(async () => {
		root.render(
			<ThemeProvider theme={buildTheme()}>
				<Harness />
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
	const button = [...host.querySelectorAll('button')].find(
		(item) => item.textContent === text,
	)
	expect(button, text).toBeDefined()
	await act(async () => {
		button?.click()
		await Promise.resolve()
	})
}

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
	vi.clearAllMocks()
	mock.presentation = null
	mock.getPending.mockReturnValue(null)
	mock.syncing = false
	mock.validation = { isValidating: false, revision: 'draft-1', validation: [] }
	mock.review.mockResolvedValue({ status: 'ready', review })
	mock.publish.mockResolvedValue({ status: 'published' })
	mock.reconcile.mockResolvedValue({ status: 'published' })
	proposal = false
	props = {
		id: 'page-1',
		type: 'page',
		liveEdit: false,
		initialValueResolved: true,
		draft: {
			_id: 'drafts.page-1',
			_type: 'page',
			_rev: 'draft-1',
			pathname: { current: '/new' },
		},
		published: {
			_id: 'page-1',
			_type: 'page',
			_rev: 'pub-1',
			pathname: { current: '/old' },
		},
		onComplete: vi.fn(),
	} as unknown as DocumentActionProps
	native = {
		label: 'Publish',
		disabled: false,
		shortcut: 'Ctrl+Alt+P',
		onHandle: mock.nativeHandle,
	}
	action = createUrlPublishAction(() => native, routes)
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

describe('URL-aware Publish action', () => {
	it.each(['new', 'unchanged'])(
		'delegates %s documents to native publishing',
		async (kind) => {
			if (kind === 'new') props = { ...props, published: null }
			else
				props = {
					...props,
					draft: { ...props.draft!, pathname: { current: '/old' } },
				}
			await render()
			await handle()
			expect(mock.nativeHandle).toHaveBeenCalledOnce()
			expect(mock.review).not.toHaveBeenCalled()
			expect(description?.shortcut).toBe('Ctrl+Alt+P')
		},
	)
	it('explains the release limitation without requiring editors to remove planned work', async () => {
		mock.review.mockResolvedValue({
			status: 'blocked',
			reason: 'release-version',
		})
		await render()
		await handle()
		const notice = host.querySelector('[role="alert"]')
		expect(notice?.textContent).toContain(
			'This URL change is blocked because the page belongs to a release',
		)
		expect(notice?.textContent).toContain(
			'SanityKit does not yet handle these release conflicts.',
		)
		expect(notice?.textContent).toContain('keep the current live URL')
		expect(notice?.textContent).toContain('finish the planned release first')
		expect(notice?.textContent).toContain(
			'Keep any planned work you still need',
		)
		expect(mock.publish).not.toHaveBeenCalled()
	})
	it('does not mistake changed document versions for release membership', async () => {
		mock.review.mockResolvedValue({
			status: 'blocked',
			reason: 'versions-changed',
		})
		await render()
		await handle()
		expect(host.textContent).toContain(
			'document or routing information changed',
		)
		expect(host.textContent).not.toContain('page belongs to a release')
	})
	it('reviews a changed URL and defaults to creating a redirect', async () => {
		await render()
		await handle()
		expect(mock.nativeHandle).not.toHaveBeenCalled()
		expect(mock.review).toHaveBeenCalledWith(
			{
				documentId: 'page-1',
				draftRevision: 'draft-1',
				publishedRevision: 'pub-1',
			},
			expect.any(AbortSignal),
		)
		expect(host.textContent).toContain('From/old')
		expect(host.textContent).toContain('To/new')
		expect(host.querySelector('input')?.checked).toBe(true)
		await click('Publish')
		expect(mock.publish).toHaveBeenCalledWith(review, {
			createRedirect: true,
			isCurrent: expect.any(Function) as unknown,
		})
		expect(host.querySelector('section')).toBeNull()
	})
	it.each(['response', 'exception'])(
		'retries failed review reads without publishing: %s',
		async (failure) => {
			if (failure === 'response')
				mock.review.mockResolvedValueOnce({
					status: 'blocked',
					reason: 'request-failed',
				})
			else mock.review.mockRejectedValueOnce(new Error('offline'))
			await render()
			await handle()
			expect(host.querySelector('[role="alert"]')?.textContent).toContain(
				'Retry',
			)
			// A retry uses current revisions rather than the failed request's snapshot.
			props = { ...props, draft: { ...props.draft!, _rev: 'draft-2' } }
			mock.validation.revision = 'draft-2'
			mock.review.mockResolvedValue({
				status: 'ready',
				review: { ...review, draftRevision: 'draft-2' },
			})
			await render()
			await click('Retry')
			expect(mock.review).toHaveBeenLastCalledWith(
				expect.objectContaining({ draftRevision: 'draft-2' }),
				expect.any(AbortSignal),
			)
			expect(host.textContent).toContain('To/new')
			expect(host.querySelector('[role="alert"]')).toBeNull()
			expect(mock.publish).not.toHaveBeenCalled()
			expect(mock.nativeHandle).not.toHaveBeenCalled()
		},
	)
	it('keeps retry available after another read failure and prevents concurrent retries', async () => {
		mock.review.mockRejectedValueOnce(new Error('offline'))
		await render()
		await handle()
		let reject!: (error: Error) => void
		mock.review.mockReturnValueOnce(
			new Promise((_, fail) => {
				reject = fail
			}),
		)
		const retry = [...host.querySelectorAll('button')].find(
			(button) => button.textContent === 'Retry',
		)!
		act(() => {
			retry.click()
			retry.click()
		})
		expect(mock.review).toHaveBeenCalledTimes(2)
		expect(host.textContent).toContain('Checking the URL change')
		await act(async () => {
			reject(new Error('still offline'))
			await Promise.resolve()
		})
		expect(host.querySelector('[role="alert"]')?.textContent).toContain('Retry')
		expect(mock.publish).not.toHaveBeenCalled()
	})
	it('keeps retry subject to native validation and draft-saving gates', async () => {
		mock.review.mockRejectedValueOnce(new Error('offline'))
		await render()
		await handle()
		mock.syncing = true
		await render()
		const retry = [...host.querySelectorAll('button')].find(
			(button) => button.textContent === 'Retry',
		)!
		expect(retry.disabled).toBe(true)
		await click('Retry')
		expect(mock.review).toHaveBeenCalledOnce()
		expect(mock.publish).not.toHaveBeenCalled()
	})
	it('allows publishing without a redirect and never mutates on Cancel', async () => {
		await render()
		await handle()
		await act(async () => {
			host.querySelector('input')?.click()
			await Promise.resolve()
		})
		expect(host.textContent).toContain('will not automatically forward')
		await click('Publish')
		expect(mock.publish).toHaveBeenCalledWith(review, {
			createRedirect: false,
			isCurrent: expect.any(Function) as unknown,
		})
		await handle()
		await click('Cancel')
		expect(mock.publish).toHaveBeenCalledOnce()
	})
	it('shows existing redirect changes independently of the new-redirect choice', async () => {
		const withAliases = {
			...review,
			affectedRedirects: [
				{
					id: 'alias-a',
					source: '/first',
					oldDestination: '/old',
					newDestination: '/new',
					status: 301,
				},
				{
					id: 'alias-b',
					source: '/second',
					oldDestination: '/old',
					newDestination: '/new',
					status: 302,
				},
			],
		}
		mock.review.mockResolvedValue({ status: 'ready', review: withAliases })
		await render()
		await handle()
		expect(host.textContent).toContain('Existing redirects · 2')
		const items = [...host.querySelectorAll('li')]
		expect(items).toHaveLength(2)
		expect(items[0]?.textContent).toContain('/first')
		expect(items[1]?.textContent).toContain('/second')
		expect(
			items.every(
				(item) =>
					item.querySelector('[aria-label="Previous destination"]')
						?.textContent === '/old' &&
					item.querySelector('[aria-label="New destination"]')?.textContent ===
						'/new',
			),
		).toBe(true)
		await act(async () => {
			host.querySelector('input')?.click()
			await Promise.resolve()
		})
		expect(host.textContent).toContain(
			'Existing redirects for this page will be updated to the new destination URL, even if the checkbox above is unchecked.',
		)
		expect(host.querySelectorAll('li')).toHaveLength(2)
		await click('Publish')
		expect(mock.publish).toHaveBeenCalledWith(withAliases, {
			createRedirect: false,
			isCurrent: expect.any(Function) as unknown,
		})
	})
	it.each(['native', 'sync', 'validating', 'revision', 'errors'])(
		'blocks changed-URL publication while %s is not ready',
		async (kind) => {
			if (kind === 'native') native = { ...native!, disabled: true }
			if (kind === 'sync') mock.syncing = true
			if (kind === 'validating') mock.validation.isValidating = true
			if (kind === 'revision') mock.validation.revision = 'old'
			if (kind === 'errors') mock.validation.validation = [{ level: 'error' }]
			await render()
			await handle()
			expect(description?.disabled).toBe(true)
			expect(mock.review).not.toHaveBeenCalled()
			expect(mock.nativeHandle).not.toHaveBeenCalled()
		},
	)
	it('blocks even native delegation while a local URL proposal is pending', async () => {
		props = { ...props, published: null }
		proposal = true
		await render()
		await handle()
		expect(description?.disabled).toBe(true)
		expect(mock.nativeHandle).not.toHaveBeenCalled()
		proposal = false
		await render()
		await handle()
		expect(mock.nativeHandle).toHaveBeenCalledOnce()
	})
	it('invalidates the review if a document revision or local proposal changes', async () => {
		await render()
		await handle()
		props = { ...props, draft: { ...props.draft!, _rev: 'draft-2' } }
		mock.validation.revision = 'draft-2'
		await render()
		await click('Publish')
		expect(mock.publish).not.toHaveBeenCalled()
		expect(host.textContent).toContain('document changed')
	})
	it('passes an immediate freshness check to guard an async publication', async () => {
		let current: (() => boolean) | undefined
		mock.publish.mockImplementation(
			(_review: unknown, options: { isCurrent: () => boolean }) => {
				current = options.isCurrent
				return new Promise(() => {})
			},
		)
		await render()
		await handle()
		await click('Publish')
		expect(current?.()).toBe(true)
		proposal = true
		await render()
		expect(current?.()).toBe(false)
	})
	it('reconciles uncertain outcomes without issuing another publish', async () => {
		mock.publish.mockResolvedValue({ status: 'unknown', reason: 'network' })
		let confirm: ((result: { status: 'published' }) => void) | undefined
		mock.reconcile.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					confirm = resolve
				}),
		)
		await render()
		await handle()
		await click('Publish')
		expect(host.textContent).toContain(
			'The connection ended before we received confirmation.',
		)
		const notice = host.querySelector('[role="alert"]')
		expect(notice?.textContent).toContain(
			'Could not confirm this page was published',
		)
		expect(
			host.textContent?.indexOf('Could not confirm this page was published'),
		).toBeLessThan(host.textContent?.indexOf('From') ?? -1)
		await click('Check publish status')
		expect(host.querySelector('[role="alert"]')).toBe(notice)
		expect(
			[...host.querySelectorAll('button')].find(
				(button) => button.textContent === 'Checking result…',
			)?.disabled,
		).toBe(true)
		expect(mock.reconcile).toHaveBeenCalledOnce()
		expect(mock.publish).toHaveBeenCalledOnce()
		await act(async () => {
			confirm?.({ status: 'published' })
			await Promise.resolve()
		})
		expect(host.querySelector('section')).toBeNull()
		expect(mock.toast).toHaveBeenCalledWith(
			expect.objectContaining({
				status: 'success',
				title: 'Page published',
				description: expect.stringContaining('/new') as unknown,
			}),
		)
		expect(props.onComplete).toHaveBeenCalledOnce()
	})
	it('lets editors close and reopen an uncertain result without republishing', async () => {
		mock.publish.mockResolvedValue({ status: 'unknown', reason: 'network' })
		await render()
		await handle()
		await click('Publish')
		await click('Close')
		expect(host.querySelector('section')).toBeNull()
		expect(description?.label).toBe('Check publish status')
		// The native action may become disabled when the published snapshot arrives.
		native = { ...native!, disabled: true }
		props = { ...props, draft: null }
		await render()
		expect(description?.disabled).toBe(false)
		await handle()
		expect(host.textContent).toContain(
			'Could not confirm this page was published',
		)
		await click('Check publish status')
		expect(mock.publish).toHaveBeenCalledOnce()
		expect(mock.review).toHaveBeenCalledOnce()
		expect(mock.nativeHandle).not.toHaveBeenCalled()
		expect(mock.toast).toHaveBeenCalledOnce()
	})
	it('restores a pending publication after remount without requiring an editable draft', async () => {
		mock.getPending.mockReturnValue({ ...review, createRedirect: false })
		native = { ...native!, disabled: true }
		props = { ...props, draft: null }
		await render()
		expect(host.querySelector('section')).toBeNull()
		expect(description?.label).toBe('Check publish status')
		expect(description?.disabled).toBe(false)
		await handle()
		expect(host.querySelector('input')?.checked).toBe(false)
		await click('Check publish status')
		expect(mock.reconcile).toHaveBeenCalledWith('page-1')
		expect(mock.review).not.toHaveBeenCalled()
		expect(mock.publish).not.toHaveBeenCalled()
		expect(mock.toast).toHaveBeenCalledWith(
			expect.objectContaining({ status: 'success', title: 'Page published' }),
		)
	})
	it('confirms an ordinary successful publication with its URL', async () => {
		await render()
		await handle()
		await click('Publish')
		expect(mock.toast).toHaveBeenCalledWith(
			expect.objectContaining({
				status: 'success',
				title: 'Page published',
				description: expect.stringContaining('/new') as unknown,
			}),
		)
		expect(props.onComplete).toHaveBeenCalledOnce()
	})
	it('can close while a result check is pending and receive confirmation afterward', async () => {
		mock.publish.mockResolvedValue({ status: 'unknown', reason: 'network' })
		let confirm: ((result: { status: 'published' }) => void) | undefined
		mock.reconcile.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					confirm = resolve
				}),
		)
		await render()
		await handle()
		await click('Publish')
		await click('Check publish status')
		await click('Close')
		expect(host.querySelector('section')).toBeNull()
		await act(async () => {
			confirm?.({ status: 'published' })
			await Promise.resolve()
		})
		expect(host.querySelector('section')).toBeNull()
		expect(mock.toast).toHaveBeenCalledOnce()
		expect(mock.publish).toHaveBeenCalledOnce()
	})
	it('keeps corrupted recovery data blocked and dismissible', async () => {
		mock.getPending.mockImplementation(() => {
			throw new Error('Corrupt recovery')
		})
		await render()
		await handle()
		expect(host.textContent).toContain(
			'saved information about the last attempt to publish this page could not be read',
		)
		await click('Close')
		expect(description?.label).toBe('Check publish status')
		expect(mock.publish).not.toHaveBeenCalled()
		expect(mock.nativeHandle).not.toHaveBeenCalled()
	})
	it.each(['publication-rejected', 'review-stale'])(
		'allows a fresh review after confirmed rejection: %s',
		async (reason) => {
			mock.publish.mockResolvedValue({ status: 'unknown', reason: 'network' })
			mock.reconcile.mockResolvedValue({ status: 'blocked', reason })
			await render()
			await handle()
			await click('Publish')
			await click('Check publish status')
			expect(host.textContent).not.toContain(
				'Could not confirm this page was published',
			)
			expect(mock.toast).toHaveBeenCalledWith(
				expect.objectContaining({
					status: 'warning',
					title: 'Page was not published',
				}),
			)
			await handle()
			expect(mock.review).toHaveBeenCalledTimes(2)
			expect(mock.publish).toHaveBeenCalledOnce()
		},
	)
	it.each(['other', 'drafts.other', 'versions.release-a.other'])(
		'keeps conflict %s in Presentation with its preview and correct version',
		async (id) => {
			mock.presentation = {
				preview: '/original?campaign=test',
				viewport: 'mobile',
				id: 'page-1',
				type: 'page',
				path: 'title',
				parentRefPath: 'shared',
				inspect: 'history',
				template: 'old-template',
				perspective: 'old-release',
			}
			mock.review.mockResolvedValue({
				status: 'blocked',
				reason: 'url-conflict',
				conflict: {
					kind: 'page',
					pathname: '/about',
					documentId: id,
					schemaType: 'page',
					title: 'About us',
				},
			})
			await render()
			await handle()
			const link = host.querySelector('[role="alert"] a') as HTMLAnchorElement
			expect(link.getAttribute('href')).toBe('/pages-proof/page/other')
			expect(JSON.parse(link.getAttribute('data-state')!)).toEqual({
				id: 'other',
				type: 'page',
				_searchParams: [
					['preview', '/original?campaign=test'],
					['viewport', 'mobile'],
					['perspective', 'old-release'],
					...(id.startsWith('versions.') ? [['version', 'release-a']] : []),
				],
			})
			act(() => link.click())
			expect(host.querySelector('[role="alert"]')).toBeNull()
			expect(mock.publish).not.toHaveBeenCalled()
		},
	)
	it.each(['other', 'drafts.other', 'versions.release-a.other'])(
		'shows an actionable red page conflict notice for %s',
		async (id) => {
			mock.review.mockResolvedValue({
				status: 'blocked',
				reason: 'url-conflict',
				conflict: {
					kind: 'page',
					pathname: '/about',
					documentId: id,
					schemaType: 'page',
					title: 'About us',
				},
			})
			await render()
			await handle()
			const alert = host.querySelector('[role="alert"]')
			expect(alert?.getAttribute('data-tone')).toBe('critical')
			expect(alert?.textContent).toContain('URL already in use')
			expect(alert?.textContent).toContain('/about')
			expect(alert?.textContent).toContain('About us')
			expect(alert?.textContent).not.toMatch(new RegExp(`\\b${id}\\b`, 'u'))
			expect(alert?.textContent).toContain('Page using this URL')
			const link = alert?.querySelector('a')
			expect(link?.textContent).toContain('About us')
			expect(link?.textContent).not.toContain('Open page')
			expect(link?.getAttribute('aria-label')).toContain('Open page: About us')
			expect(
				link?.querySelector('[role="img"]')?.getAttribute('data-document-id'),
			).toBe('other')
			expect(link?.getAttribute('href')).toBe('/intent/edit/other')
			expect(link?.getAttribute('data-as')).toBe('a')
			expect(link?.getAttribute('data-mode')).toBe('structure')
			expect(link?.getAttribute('data-perspective')).toBe(
				id.startsWith('versions.')
					? 'release-a'
					: id.startsWith('drafts.')
						? null
						: 'published',
			)
			expect(mock.publish).not.toHaveBeenCalled()
			act(() => link?.click())
			expect(host.querySelector('[role="alert"]')).toBeNull()
		},
	)
	it.each(['review', 'publish'] as const)(
		'lists missing and unverified access requirements after %s without exposing hidden documents',
		async (phase) => {
			const accessIssues = [
				{
					key: 'pages:drafts',
					label: 'Read all page documents — drafts',
					status: 'missing',
				},
				{
					key: 'pages:releases',
					label: 'Read all page documents — release versions',
					status: 'unverified',
				},
			] as const
			mock[phase].mockResolvedValueOnce({
				status: 'blocked',
				reason: 'unknown-read-access',
				accessIssues,
			})
			await render()
			await handle()
			if (phase === 'publish') await click('Publish')
			const alert = host.querySelector('[role="alert"]')
			expect(alert?.getAttribute('data-tone')).toBe('critical')
			expect(alert?.textContent).toContain('Missing read access')
			expect(alert?.textContent).toContain('Read access could not be verified')
			expect(
				[...alert!.querySelectorAll('li')].map((item) => item.textContent),
			).toEqual(accessIssues.map((issue) => issue.label))
			expect(alert?.textContent).toContain(
				'Contact someone who manages project permissions',
			)
			expect(alert?.querySelector('a')).toBeNull()
			expect(
				[...host.querySelectorAll('button')].find(
					(item) => item.textContent === 'Publish',
				)?.disabled,
			).toBe(true)
			await click('Cancel')
			await handle()
			expect(host.textContent).not.toContain('Missing read access')
			expect(host.textContent).not.toContain(
				'Read access could not be verified',
			)
			expect(host.querySelector('input')?.checked).toBe(true)
		},
	)
	it.each(['redirect-1', 'drafts.redirect-1', 'versions.release-a.redirect-1'])(
		'shows a clickable blocking redirect row for %s',
		async (id) => {
			mock.review.mockResolvedValue({
				status: 'blocked',
				reason: 'target-is-redirect',
				conflict: {
					kind: 'redirect',
					pathname: '/about',
					destination: '/company',
					documentId: id,
					schemaType: 'sanityKitRedirect',
				},
			})
			await render()
			await handle()
			expect(host.querySelector('[role="alert"]')?.textContent).toContain(
				'/about→ /company',
			)
			const link = host.querySelector('a')
			expect(link?.getAttribute('aria-label')).toContain(
				'Open redirect: /about → /company',
			)
			expect(link?.textContent).not.toContain('Open redirect')
			expect(link?.getAttribute('href')).toBe('/intent/edit/redirect-1')
			expect(link?.getAttribute('data-type')).toBe('sanityKitRedirect')
			expect(host.textContent).toContain('This URL is used by a redirect')
			expect(host.textContent).toContain(
				'Retire the conflicting redirect or choose another URL.',
			)
			expect(host.textContent).not.toContain('administrator')
			expect(link?.getAttribute('data-as')).toBe('a')
			expect(link?.getAttribute('data-mode')).toBe('structure')
			expect(link?.getAttribute('data-perspective')).toBe(
				id.startsWith('versions.')
					? 'release-a'
					: id.startsWith('drafts.')
						? null
						: 'published',
			)
			expect(
				link?.querySelector('[role="img"]')?.getAttribute('data-document-id'),
			).toBe('redirect-1')
			expect(host.textContent).not.toContain(id)
			expect(mock.publish).not.toHaveBeenCalled()
			act(() => link?.click())
			expect(host.querySelector('[role="alert"]')).toBeNull()
		},
	)

	it.each(['drafts.redirect-1', 'versions.release-a.redirect-1'])(
		'explains pending redirect work and opens the appropriate version: %s',
		async (id) => {
			mock.review.mockResolvedValue({
				status: 'blocked',
				reason: 'pending-redirect-change',
				conflict: {
					kind: 'redirect',
					pathname: '/historic',
					destination: '/pending',
					documentId: id,
					schemaType: 'sanityKitRedirect',
				},
			})
			await render()
			await handle()
			const alert = host.querySelector('[role="alert"]')
			expect(alert?.textContent).toContain(
				'Unpublished redirect changes conflict with this URL',
			)
			expect(alert?.textContent).toContain('Affected URL')
			expect(alert?.textContent).toContain(
				'Publish or discard the redirect’s pending changes, then try publishing this page again.',
			)
			expect(alert?.textContent).not.toContain('Retire')
			expect(alert?.textContent).not.toContain('administrator')
			const link = alert?.querySelector('a')
			expect(link?.getAttribute('href')).toBe('/intent/edit/redirect-1')
			expect(link?.getAttribute('data-perspective')).toBe(
				id.startsWith('versions.') ? 'release-a' : null,
			)
			expect(
				[...host.querySelectorAll('button')].find(
					(button) => button.textContent === 'Publish',
				)?.disabled,
			).toBe(true)
			expect(mock.publish).not.toHaveBeenCalled()
			act(() => link?.click())
			expect(host.querySelector('[role="alert"]')).toBeNull()
			mock.review.mockResolvedValue({
				status: 'blocked',
				reason: 'target-is-redirect',
				conflict: {
					kind: 'redirect',
					pathname: '/other',
					destination: '/elsewhere',
					documentId: 'another',
					schemaType: 'sanityKitRedirect',
				},
			})
			await handle()
			expect(host.textContent).toContain('This URL is used by a redirect')
			expect(host.textContent).not.toContain(
				'Unpublished redirect changes conflict with this URL',
			)
		},
	)

	it.each([
		[
			'redirect-updates',
			125,
			100,
			'exact',
			'proposed',
			'Too many redirects need updating',
			'125',
		],
		[
			'redirect-records',
			1001,
			1000,
			'at-least',
			'current',
			'Too many redirects to check before publishing this URL change',
			'At least 1,001',
		],
		[
			'redirect-records',
			1001,
			1000,
			'exact',
			'proposed',
			'Publishing this URL change would exceed the redirect limit',
			'1,001',
		],
		[
			'redirect-bytes',
			1258291,
			1048576,
			'at-least',
			'current',
			'Redirect data is too large to review',
			'At least 1.20 MiB (1,258,291 bytes)',
		],
		[
			'redirect-bytes',
			1205862,
			1048576,
			'estimated',
			'proposed',
			'This change would exceed the redirect data limit',
			'Estimated 1.15 MiB (1,205,862 bytes)',
		],
		[
			'publication-bytes',
			1153434,
			1048576,
			'exact',
			'proposed',
			'This URL change is too large to publish',
			'1.10 MiB (1,153,434 bytes)',
		],
	] as const)(
		'shows measured %s limits with %s actual',
		async (kind, actual, maximum, measurement, phase, heading, value) => {
			mock.review.mockResolvedValue({
				status: 'blocked',
				reason: 'inventory-limit',
				limit: { kind, actual, maximum, measurement, phase },
			})
			await render()
			await handle()
			const alert = host.querySelector('[role="alert"]')
			expect(alert?.textContent).toContain(heading)
			expect(alert?.textContent).toContain(value)
			expect(alert?.textContent).toContain('Supported limit')
			expect(alert?.textContent).toContain(
				kind.endsWith('bytes')
					? '1.00 MiB (1,048,576 bytes)'
					: maximum.toLocaleString('en-US'),
			)
			expect(alert?.textContent).toContain('Nothing was published')
			expect(alert?.textContent).not.toContain('administrator')
			expect(
				[...host.querySelectorAll('button')].find(
					(button) => button.textContent === 'Publish',
				)?.disabled,
			).toBe(true)
			expect(mock.publish).not.toHaveBeenCalled()
		},
	)
	it('shows invalid redirect data separately from numeric limits', async () => {
		mock.review.mockResolvedValue({
			status: 'blocked',
			reason: 'invalid-before-snapshot',
			redirectIssue: 'duplicate-source',
		})
		await render()
		await handle()
		expect(host.textContent).toContain('Redirect data needs correction')
		expect(host.textContent).toContain(
			'More than one redirect uses the same source URL',
		)
		expect(host.textContent).not.toContain('Supported limit')
		expect(host.textContent).not.toContain('administrator')
	})
	it('shows each redirect sharing an invalid source URL as a native editor link', async () => {
		mock.review.mockResolvedValue({
			status: 'blocked',
			reason: 'invalid-before-snapshot',
			redirectIssue: 'duplicate-source',
			conflict: {
				kind: 'redirect',
				pathname: '/old',
				documentId: 'redirect-1',
				schemaType: 'sanityKitRedirect',
				destination: '/one',
				relatedRedirects: [
					{ documentId: 'redirect-2', pathname: '/old', destination: '/two' },
				],
			},
		})
		await render()
		await handle()
		const alert = host.querySelector('[role="alert"]')!
		expect(alert.textContent).toContain('Affected URL')
		expect(alert.textContent).toContain('Redirects using this URL')
		expect(alert.textContent).toContain(
			'More than one redirect uses the same source URL',
		)
		const links = [...alert.querySelectorAll('a')]
		expect(links.map((link) => link.getAttribute('href'))).toEqual([
			'/intent/edit/redirect-1',
			'/intent/edit/redirect-2',
		])
		expect(links.map((link) => link.getAttribute('aria-label'))).toEqual([
			'Open redirect: /old → /one · Published',
			'Open redirect: /old → /two · Published',
		])
		for (const link of links) {
			expect(link.getAttribute('data-as')).toBe('a')
			expect(link.getAttribute('data-perspective')).toBe('published')
			expect(link.querySelector('[data-document-id]')).not.toBeNull()
		}
		expect(mock.publish).not.toHaveBeenCalled()
		act(() => links[1]!.click())
		expect(host.querySelector('[role="alert"]')).toBeNull()
	})

	it.each([
		['self-redirect', 'A redirect points back to itself'],
		['invalid-source', 'A redirect has an invalid source URL'],
		['invalid-destination', 'A redirect has an invalid destination URL'],
		['unsupported-status', 'A redirect has an unsupported status'],
		['reserved-source', 'A redirect uses a URL reserved by the app'],
		['invalid-record', 'A redirect has missing or invalid fields'],
	])(
		'shows actionable %s details and a link to its record',
		async (issue, heading) => {
			mock.review.mockResolvedValue({
				status: 'blocked',
				reason: 'invalid-before-snapshot',
				redirectIssue: issue,
				conflict: {
					kind: 'redirect',
					pathname: '/old',
					destination: '/next',
					documentId: 'redirect-1',
					schemaType: 'sanityKitRedirect',
					fieldIssues: [
						{ field: 'Status', value: '307', message: 'Use 301 or 302.' },
					],
				},
			})
			await render()
			await handle()
			const alert = host.querySelector('[role="alert"]')!
			expect(alert.textContent).toContain(heading)
			expect(alert.textContent).toContain('Current value: 307')
			expect(alert.textContent).toContain('Use 301 or 302.')
			expect(alert.querySelector('a')?.getAttribute('href')).toBe(
				'/intent/edit/redirect-1',
			)
			expect(
				alert
					.querySelector('[data-document-id]')
					?.getAttribute('data-document-id'),
			).toBe('redirect-1')
			expect(mock.publish).not.toHaveBeenCalled()
		},
	)
	it.each(['redirect-chain', 'redirect-cycle'])(
		'shows connected rules in order for %s',
		async (issue) => {
			mock.review.mockResolvedValue({
				status: 'blocked',
				reason: 'invalid-before-snapshot',
				redirectIssue: issue,
				conflict: {
					kind: 'redirect',
					pathname: '/a',
					destination: '/b',
					documentId: 'rule-a',
					schemaType: 'sanityKitRedirect',
					relatedRedirects: [
						{
							documentId: 'rule-b',
							pathname: '/b',
							destination: issue === 'redirect-cycle' ? '/a' : '/final',
						},
					],
					...(issue === 'redirect-chain' ? { finalDestination: '/final' } : {}),
				},
			})
			await render()
			await handle()
			const alert = host.querySelector('[role="alert"]')!
			expect(alert.textContent).toContain('Connected redirects')
			expect(
				[...alert.querySelectorAll('a')].map((link) =>
					link.getAttribute('href'),
				),
			).toEqual(['/intent/edit/rule-a', '/intent/edit/rule-b'])
			if (issue === 'redirect-chain')
				expect(alert.textContent).toContain('Final destination/final')
			else expect(alert.textContent).not.toContain('Final destination')
		},
	)
	it('links both the redirect and the page occupying its source', async () => {
		mock.review.mockResolvedValue({
			status: 'blocked',
			reason: 'invalid-before-snapshot',
			redirectIssue: 'occupied-source',
			conflict: {
				kind: 'redirect',
				pathname: '/about',
				destination: '/company',
				documentId: 'rule-a',
				schemaType: 'sanityKitRedirect',
				relatedPages: [
					{
						documentId: 'about-page',
						pathname: '/about',
						schemaType: 'page',
						title: 'About us',
					},
				],
			},
		})
		await render()
		await handle()
		const alert = host.querySelector('[role="alert"]')!
		expect(alert.textContent).toContain(
			'A page and a redirect use the same URL',
		)
		expect(alert.textContent).toContain('Page using this URL')
		const link = alert.querySelector('a[data-type="page"]')!
		expect(link.getAttribute('aria-label')).toBe(
			'Open page: About us · /about · Published',
		)
		expect(link.getAttribute('href')).toBe('/intent/edit/about-page')
		act(() => (link as HTMLAnchorElement).click())
		expect(host.querySelector('[role="alert"]')).toBeNull()
	})
	it.each(['incomplete-snapshot', 'invalid-envelope', 'wrong-perspective'])(
		'does not invent a record for %s',
		async (issue) => {
			mock.review.mockResolvedValue({
				status: 'blocked',
				reason: 'incomplete-inventory',
				redirectIssue: issue,
			})
			await render()
			await handle()
			const alert = host.querySelector('[role="alert"]')!
			expect(alert.textContent).toContain('Redirect data could not be checked')
			expect(alert.textContent).toContain(
				'This does not mean the redirect URLs themselves are wrong',
			)
			expect(alert.textContent).not.toContain('Affected URL')
			expect(alert.querySelector('a')).toBeNull()
			expect(mock.publish).not.toHaveBeenCalled()
		},
	)
	it('disables publication after its final request exceeds the size limit', async () => {
		await render()
		await handle()
		mock.publish.mockResolvedValue({
			status: 'blocked',
			reason: 'publication-operation-limit',
			limit: {
				kind: 'publication-bytes',
				actual: 1153434,
				maximum: 1048576,
				measurement: 'exact',
				phase: 'proposed',
			},
		})
		await act(async () => {
			;[...host.querySelectorAll('button')]
				.find((button) => button.textContent === 'Publish')
				?.click()
			await Promise.resolve()
		})
		expect(host.textContent).toContain(
			'This URL change is too large to publish',
		)
		expect(
			[...host.querySelectorAll('button')].find(
				(button) => button.textContent === 'Publish',
			)?.disabled,
		).toBe(true)
		await act(async () => {
			;[...host.querySelectorAll('button')]
				.find((button) => button.textContent === 'Cancel')
				?.click()
			await Promise.resolve()
		})
		await handle()
		expect(host.textContent).not.toContain(
			'This URL change is too large to publish',
		)
	})
	it('preserves native null and existing native dialogs', async () => {
		native = null
		await render()
		expect(description).toBeNull()
		native = {
			label: 'Publish',
			dialog: { type: 'dialog', content: 'Native dialog', onClose: vi.fn() },
			onHandle: mock.nativeHandle,
		}
		await render()
		await handle()
		expect(host.textContent).toContain('Native dialog')
		expect(mock.review).not.toHaveBeenCalled()
	})
	it('drops an obsolete review after changing documents', async () => {
		let finish: ((value: unknown) => void) | undefined
		mock.review.mockReturnValue(
			new Promise((resolve) => {
				finish = resolve
			}),
		)
		await render()
		const previousHandle = description?.onHandle
		await handle()
		props = {
			...props,
			id: 'page-2',
			draft: { ...props.draft!, _id: 'drafts.page-2' },
			published: { ...props.published!, _id: 'page-2' },
		}
		await render()
		await act(async () => {
			previousHandle?.()
			await Promise.resolve()
		})
		expect(mock.review).toHaveBeenCalledOnce()
		expect(host.querySelector('section')).toBeNull()
		await act(async () => {
			finish?.({ status: 'ready', review })
			await Promise.resolve()
		})
		expect(host.querySelector('section')).toBeNull()
		expect(description?.disabled).toBe(false)
	})
	it('does not start duplicate reviews from repeated immediate activation', async () => {
		mock.review.mockReturnValue(new Promise(() => {}))
		await render()
		await act(async () => {
			description?.onHandle?.()
			description?.onHandle?.()
			await Promise.resolve()
		})
		expect(mock.review).toHaveBeenCalledOnce()
	})
	it.each(['review', 'error', 'unknown'])(
		'never delegates through a stale shortcut during an active %s',
		async (mode) => {
			if (mode === 'error')
				mock.review.mockResolvedValue({ status: 'blocked', reason: 'conflict' })
			if (mode === 'unknown')
				mock.publish.mockResolvedValue({ status: 'unknown', reason: 'network' })
			await render()
			const staleHandle = description?.onHandle
			await handle()
			if (mode === 'unknown') await click('Publish')
			props = {
				...props,
				draft: { ...props.draft!, pathname: { current: '/old' } },
			}
			await render()
			await act(async () => {
				staleHandle?.()
				description?.onHandle?.()
				await Promise.resolve()
			})
			expect(mock.nativeHandle).not.toHaveBeenCalled()
			expect(mock.review).toHaveBeenCalledOnce()
			expect(description?.disabled).toBe(true)
		},
	)
	it('rejects a reviewed URL changed locally even before its revision changes', async () => {
		await render()
		await handle()
		props = {
			...props,
			draft: { ...props.draft!, pathname: { current: '/another' } },
		}
		await render()
		await click('Publish')
		expect(mock.publish).not.toHaveBeenCalled()
	})
})
