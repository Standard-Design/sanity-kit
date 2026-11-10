// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ThemeProvider } from '@sanity/ui'
import { buildTheme } from '@sanity/ui/theme'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	CollectionPrefixPublicationDialog,
	type CollectionPrefixDialogState,
	type CollectionPrefixPublicationDialogProps,
} from '../../src/studio/collections/prefix-publication-dialog.js'
import type { CollectionPrefixPublishReview } from '../../src/studio/collections/prefix-write.js'

const releaseDetails = vi.hoisted(
	(): { release: { metadata: { title: string } } | undefined } => ({
		release: { metadata: { title: 'Winter launch' } },
	}),
)
vi.mock('sanity', async (original) => ({
	...(await original<typeof import('sanity')>()),
	useVersionRelease: () => releaseDetails,
}))
vi.mock('../../src/studio/url/publication-action.js', async (original) => ({
	...(await original<
		typeof import('../../src/studio/url/publication-action.js')
	>()),
	ConflictRecord: ({
		conflict,
		onOpen,
	}: {
		conflict: { documentId?: string; title?: string; pathname: string }
		onOpen: () => void
	}) => (
		<button onClick={onOpen}>
			{conflict.title} {conflict.pathname}
		</button>
	),
}))

const review: CollectionPrefixPublishReview = {
	projectId: 'test',
	dataset: 'development',
	operationId: 'change-1',
	createRedirects: true,
	settings: {
		published: {
			_id: 'journal-settings',
			_type: 'sanityKitCollectionRoute',
			_rev: 'published-1',
			displayName: 'Journal',
		},
		draft: {
			_id: 'drafts.journal-settings',
			_type: 'sanityKitCollectionRoute',
			_rev: 'draft-1',
			displayName: 'Articles',
		},
	},
	plan: {
		settings: {
			collection: 'journal',
			documentId: 'journal-settings',
			publishedRevision: 'published-1',
			draftRevision: 'draft-1',
			oldPrefix: '/journal',
			newPrefix: '/blog',
		},
		liveChanges: [
			{
				id: 'post',
				revision: 'post-1',
				schemaType: 'post',
				title: 'First article',
				oldPathname: '/journal/first',
				newPathname: '/blog/first',
			},
		],
		draftUrls: [{ id: 'drafts.post', pathname: '/blog/first' }],
		redirects: {
			creates: [
				{
					_type: 'sanityKitRedirect',
					source: '/journal/first',
					destination: '/blog/first',
					status: 301,
					enabled: true,
					origin: 'url-change',
				},
			],
			updates: [
				{
					id: 'alias',
					revision: 'alias-1',
					source: '/old-article',
					oldDestination: '/journal/first',
					newDestination: '/blog/first',
					status: 301,
				},
			],
		},
		reviewVersions: [],
		reviewBytes: 100,
	},
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
async function flush(action: () => void) {
	await act(async () => {
		action()
		await Promise.resolve()
	})
}
afterEach(async () => {
	await flush(() => root.unmount())
	host.remove()
	vi.unstubAllGlobals()
})
const button = (label: string) =>
	[...document.querySelectorAll('button')].find(
		(node) => node.textContent === label,
	)
function props(
	state: CollectionPrefixDialogState = { phase: 'ready', review },
): CollectionPrefixPublicationDialogProps {
	return {
		state,
		collectionTitle: 'Journal',
		createRedirects: true,
		onCreateRedirectsChange: vi.fn(),
		onPublish: vi.fn(),
		onReview: vi.fn(),
		onCheckStatus: vi.fn(),
		onClose: vi.fn(),
	}
}
async function render(input = props()) {
	await flush(() =>
		root.render(
			<ThemeProvider theme={buildTheme()}>
				<CollectionPrefixPublicationDialog {...input} />
			</ThemeProvider>,
		),
	)
	return input
}

describe('collection-prefix presentation-only review', () => {
	it('allows dismissal while read-only checks are running', async () => {
		const p = await render(props({ phase: 'checking' }))
		await flush(() => button('Cancel')!.click())
		expect(p.onClose).toHaveBeenCalledOnce()
	})
	it('makes both bounded review lists keyboard focusable', async () => {
		await render()
		for (const label of [
			'Published item URL changes',
			'Existing redirect destination changes',
		]) {
			const list = document.querySelector<HTMLElement>(
				`[aria-label="${label}"]`,
			)!
			expect(list.tabIndex).toBe(0)
			await flush(() => list.focus())
			expect(document.activeElement).toBe(list)
		}
	})
	it('explains overlapping collection prefixes without claiming that a page owns the URL', async () => {
		await render(
			props({
				phase: 'blocked',
				result: { status: 'blocked', reason: 'routing-conflict' },
			}),
		)
		expect(document.body.textContent).toContain(
			'Collection URL prefixes overlap',
		)
		expect(document.body.textContent).not.toContain('Another page is using')
	})
	it('shows prefix changes, item URL changes, and distinct redirect destinations without invoking any operation', async () => {
		const p = await render()
		expect(document.body.textContent).toContain('Publish Journal URL change')
		expect(document.body.textContent).toContain('/journal')
		expect(document.body.textContent).toContain('/blog')
		const items = document.querySelector(
			'[aria-label="Published item URL changes"]',
		)!
		expect(items.textContent).toContain('First article')
		expect(items.querySelector('del')?.textContent).toBe('/journal/first')
		expect(items.querySelector('ins')?.textContent).toBe('/blog/first')
		const redirects = document.querySelector(
			'[aria-label="Existing redirect destination changes"]',
		)!
		expect(redirects.textContent).toContain('Redirect from')
		expect(redirects.textContent).toContain('/old-article')
		expect(redirects.textContent).toContain('Destination')
		expect(redirects.querySelector('del')?.textContent).toBe('/journal/first')
		expect(document.body.textContent).toContain(
			'all changes in the collection settings draft',
		)
		expect(document.body.textContent).toContain(
			'Item slugs and item drafts stay unchanged',
		)
		expect(p.onReview).not.toHaveBeenCalled()
		expect(p.onPublish).not.toHaveBeenCalled()
		expect(p.onCheckStatus).not.toHaveBeenCalled()
	})
	it('publishes only through the owner callback with the exact supplied review', async () => {
		const p = await render()
		await flush(() => button('Publish')!.click())
		expect(p.onPublish).toHaveBeenCalledOnce()
		expect(vi.mocked(p.onPublish).mock.calls[0]?.[0]).toBe(review)
	})
	it('reports a changed redirect choice and disables publishing until it matches a rebuilt review', async () => {
		const p = await render()
		await flush(() =>
			document
				.querySelector<HTMLInputElement>('input[type="checkbox"]')!
				.click(),
		)
		expect(p.onCreateRedirectsChange).toHaveBeenCalledWith(false)
		await render({ ...p, createRedirects: false })
		expect(button('Publish')?.disabled).toBe(true)
		expect(document.body.textContent).toContain(
			'Review this redirect choice before publishing',
		)
		await flush(() => button('Publish')!.click())
		expect(p.onPublish).not.toHaveBeenCalled()
		await flush(() => button('Review latest changes')!.click())
		expect(p.onReview).toHaveBeenCalledOnce()
	})
	it('retains existing redirect updates when new redirects are declined', async () => {
		const withoutNewRedirects = {
			...review,
			createRedirects: false,
			plan: {
				...review.plan,
				redirects: { ...review.plan.redirects, creates: [] },
			},
		}
		await render({
			...props({ phase: 'ready', review: withoutNewRedirects }),
			createRedirects: false,
		})
		expect(button('Publish')?.disabled).toBe(false)
		expect(
			document.querySelector(
				'[aria-label="Existing redirect destination changes"]',
			)?.textContent,
		).toContain('/old-article')
		expect(document.body.textContent).toContain(
			'even if the checkbox above is unchecked',
		)
		expect(document.body.textContent).toContain(
			'Old item URLs will not automatically forward',
		)
	})
	it('shows checking and publishing progress while disabling actions and choice edits', async () => {
		const p = await render(props({ phase: 'checking' }))
		expect(document.querySelector('[role="status"]')?.textContent).toContain(
			'Checking the collection URL change',
		)
		expect(button('Publish')?.disabled).toBe(true)
		expect(button('Cancel')?.disabled).toBe(false)
		await render({ ...p, state: { phase: 'publishing', review } })
		expect(button('Publishing…')?.disabled).toBe(true)
		expect(
			document.querySelector<HTMLInputElement>('input[type="checkbox"]')
				?.disabled,
		).toBe(true)
		await flush(() => button('Cancel')!.click())
		expect(p.onClose).not.toHaveBeenCalled()
	})
	it('puts stale review feedback first and offers a fresh check instead of publishing', async () => {
		const p = await render(
			props({
				phase: 'blocked',
				result: { status: 'blocked', reason: 'review-stale' },
			}),
		)
		const notice = document.querySelector('[role="alert"]')!
		expect(notice.textContent).toContain('Review out of date')
		expect(button('Publish')?.disabled).toBe(true)
		await flush(() => button('Review latest changes')!.click())
		expect(p.onReview).toHaveBeenCalledOnce()
		expect(p.onPublish).not.toHaveBeenCalled()
	})
	it('offers retry for failed checks without closing the review', async () => {
		const p = await render(
			props({
				phase: 'blocked',
				result: { status: 'blocked', reason: 'request-failed' },
			}),
		)
		await flush(() => button('Retry checks')!.click())
		expect(p.onReview).toHaveBeenCalledOnce()
		expect(p.onClose).not.toHaveBeenCalled()
	})
	it('displays the known conflicting URL without exposing a raw document ID', async () => {
		await render(
			props({
				phase: 'blocked',
				result: {
					status: 'blocked',
					reason: 'url-collision',
					planFailure: {
						ok: false,
						reason: 'url-collision',
						pathname: '/blog/first',
						conflictingDocumentId: 'private-technical-id',
					},
				},
			}),
		)
		expect(document.querySelector('[role="alert"]')?.textContent).toContain(
			'/blog/first',
		)
		expect(document.body.textContent).not.toContain('private-technical-id')
		expect(button('Publish')?.disabled).toBe(true)
	})
	it('shows missing and unverified access using the shared native notice', async () => {
		await render(
			props({
				phase: 'blocked',
				result: {
					status: 'blocked',
					reason: 'read-access-unverified',
					accessIssues: [
						{
							key: 'settings',
							label: 'Read collection settings',
							status: 'missing',
						},
						{
							key: 'redirects',
							label: 'Read existing redirects',
							status: 'unverified',
						},
					],
				},
			}),
		)
		expect(document.body.textContent).toContain('Missing read access')
		expect(document.body.textContent).toContain('Read collection settings')
		expect(document.body.textContent).toContain(
			'Read access could not be verified',
		)
		expect(document.body.textContent).toContain('Read existing redirects')
	})
	it('keeps an uncertain save separate from another publish attempt', async () => {
		const state: CollectionPrefixDialogState = {
			phase: 'unconfirmed',
			result: { status: 'unknown', operationId: 'change-1' },
			receipt: { oldPrefix: '/journal', newPrefix: '/blog' },
		}
		const p = await render(props(state))
		expect(document.body.textContent).toContain('The save may have succeeded')
		expect(document.body.textContent).toContain(
			'checking does not repeat the save',
		)
		expect(button('Publish')).toBeUndefined()
		await flush(() => button('Check publish status')!.click())
		expect(p.onCheckStatus).toHaveBeenCalledOnce()
		expect(p.onPublish).not.toHaveBeenCalled()
		await render({ ...p, state: { ...state, phase: 'checking-status' } })
		expect(button('Checking result…')?.disabled).toBe(true)
		expect(button('Close')?.disabled).toBe(false)
	})
	it('also treats the writer pending-operation block as recovery, never as a retryable write', async () => {
		await render(
			props({
				phase: 'blocked',
				result: { status: 'blocked', reason: 'outcome-unknown' },
			}),
		)
		expect(button('Publish')).toBeUndefined()
		expect(document.body.textContent).toContain(
			'Check collection settings save',
		)
		expect(document.body.textContent).not.toContain(
			'Publish Journal URL change',
		)
		expect(button('Check publish status')).toBeDefined()
		expect(button('Retry checks')).toBeUndefined()
	})
	it('keeps unreadable recovery information blocked without suggesting a resend', async () => {
		await render(
			props({
				phase: 'blocked',
				result: { status: 'blocked', reason: 'recovery-invalid' },
			}),
		)
		expect(document.body.textContent).toContain('before clearing recovery data')
		expect(button('Publish')?.disabled).toBe(true)
		expect(button('Retry checks')).toBeUndefined()
	})
	it('identifies the conflicting URL and both documents', async () => {
		const p = await render(
			props({
				phase: 'blocked',
				result: {
					status: 'blocked',
					reason: 'url-collision',
					planFailure: {
						ok: false,
						reason: 'url-collision',
						pathname: '/blog/first',
						documents: [
							{ id: 'post', schemaType: 'post', title: 'First article' },
							{ id: 'page', schemaType: 'page', title: 'Blog introduction' },
						],
					},
				},
			}),
		)
		expect(document.body.textContent).toContain('URL in conflict')
		expect(document.body.textContent).toContain('Documents using this URL')
		await flush(() => button('Blog introduction /blog/first')!.click())
		expect(p.onClose).toHaveBeenCalledOnce()
	})
	it('names the release and affected document', async () => {
		releaseDetails.release = { metadata: { title: 'Winter launch' } }
		await render(
			props({
				phase: 'blocked',
				result: {
					status: 'blocked',
					reason: 'release-version',
					planFailure: {
						ok: false,
						reason: 'release-version',
						release: {
							id: 'winter',
							currentPublishedPathname: '/journal/first',
							document: {
								id: 'post',
								schemaType: 'post',
								title: 'First article',
							},
						},
					},
				},
			}),
		)
		expect(document.body.textContent).toContain('Winter launch')
		expect(document.body.textContent).toContain('Affected document')
		expect(button('First article /journal/first')).toBeDefined()
	})
	it('keeps the release identifiable when its display name is unavailable', async () => {
		releaseDetails.release = undefined
		await render(
			props({
				phase: 'blocked',
				result: {
					status: 'blocked',
					reason: 'release-version',
					planFailure: {
						ok: false,
						reason: 'release-version',
						release: {
							id: 'winter',
							document: {
								id: 'post',
								schemaType: 'post',
								title: 'First article',
							},
						},
					},
				},
			}),
		)
		expect(document.body.textContent).toContain('Release winter')
		expect(document.body.textContent).toContain('release name is unavailable')
	})
	it('does not imply draft items are published when the collection has no live items', async () => {
		await render(
			props({
				phase: 'ready',
				review: {
					...review,
					plan: {
						...review.plan,
						liveChanges: [],
						redirects: { creates: [], updates: [] },
					},
				},
			}),
		)
		expect(document.body.textContent).toContain(
			'No published item URLs will change. Draft items remain unpublished.',
		)
		expect(
			document.querySelector('[aria-label="Published item URL changes"]'),
		).toBeNull()
	})
})
