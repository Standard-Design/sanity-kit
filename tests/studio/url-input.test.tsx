// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ThemeProvider } from '@sanity/ui'
import { buildTheme } from '@sanity/ui/theme'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { URL_AUTOSAVE_DELAY_MS } from '../../src/studio/url/autosave.js'
import type { SanityUrlInputProps } from '../../src/studio/url/input.js'

const native = vi.hoisted(() => {
	const document: Record<string, unknown> = {}
	return {
		document,
		client: {},
		workspace: { projectId: 'project', dataset: 'test', getClient: vi.fn() },
		schema: { get: vi.fn(() => ({})) },
		onChange: vi.fn(),
		load: vi.fn(),
		prepare: vi.fn(),
		createFolder: vi.fn(),
		invalidate: vi.fn(),
	}
})
vi.mock('sanity', () => ({
	useFormValue: () => native.document,
	useClient: () => native.client,
	useWorkspace: () => native.workspace,
	useSchema: () => native.schema,
	useCurrentUser: () => null,
	set: (value: unknown, path: unknown) => ({ type: 'set', value, path }),
	setIfMissing: (value: unknown) => ({ type: 'setIfMissing', value }),
}))
vi.mock('../../src/studio/url/edit.js', () => ({
	createUrlEditController: vi.fn(() => ({
		load: native.load,
		prepare: native.prepare,
		createFolder: native.createFolder,
		invalidate: native.invalidate,
	})),
}))
// Folder modal interactions have their own real-UI tests. Keep this harness
// focused on native patches, generation, and stale asynchronous field actions.
vi.mock('../../src/studio/url/folder-picker.js', () => ({
	FolderPicker: ({
		value,
		readOnly,
		onChange,
	}: {
		value: string
		readOnly: boolean
		onChange: (value: string) => void
	}) => (
		<button disabled={readOnly} onClick={() => onChange('/company')}>
			Folder {value}
		</button>
	),
}))
import { SanityUrlInput } from '../../src/studio/url/input.js'
import { createUrlEditController } from '../../src/studio/url/edit.js'
import { getUrlPublicationBlocked } from '../../src/studio/url/publication-state.js'

async function flush(action: () => void) {
	await act(async () => {
		action()
		await Promise.resolve()
	})
}

const routes = {
	pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
	collections: [
		{
			name: 'journal',
			title: 'Journal',
			routePrefix: '/journal',
			overview: { schemaType: 'page', pathname: '/journal' },
			items: [{ schemaType: 'post', slugField: 'slug.current' }],
		},
	],
}
const theme = buildTheme()
const publicationScope = {
	projectId: 'project',
	dataset: 'test',
	documentId: 'page1',
}
describe('URL input draft workflow', () => {
	let host: HTMLDivElement
	let root: Root
	let props: SanityUrlInputProps
	beforeEach(() => {
		vi.clearAllMocks()
		vi.useFakeTimers()
		native.schema.get.mockReturnValue({})
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
		native.document = {
			_id: 'drafts.page1',
			_type: 'page',
			_rev: 'r1',
			title: 'Hello World',
			pathname: { current: '/about/team' },
		}
		native.load.mockResolvedValue({
			status: 'loaded',
			folders: [{ pathname: '/about' }],
			editable: true,
		})
		native.prepare.mockImplementation(
			({ storedValue }: { storedValue: string }) =>
				Promise.resolve({
					status: 'ready',
					candidate: {
						storedValue,
						fieldPath: 'pathname.current',
						url: {
							pathname: storedValue,
							prefix: '/about',
							slug: 'leadership',
						},
					},
				}),
		)
		props = {
			routes,
			value: { _type: 'slug', current: '/about/team' },
			schemaType: {
				name: 'slug',
				jsonType: 'object',
				options: { source: 'title' },
			},
			path: ['pathname'],
			readOnly: false,
			onChange: native.onChange,
			elementProps: { id: 'url' },
		} as unknown as SanityUrlInputProps
		host = document.createElement('div')
		document.body.append(host)
		root = createRoot(host)
	})
	afterEach(async () => {
		await flush(() => root.unmount())
		host.remove()
		vi.unstubAllGlobals()
		vi.useRealTimers()
	})
	async function save() {
		await act(async () => {
			await vi.advanceTimersByTimeAsync(URL_AUTOSAVE_DELAY_MS)
		})
	}
	async function render() {
		await flush(() => {
			root.render(
				<ThemeProvider theme={theme}>
					<SanityUrlInput {...props} />
				</ThemeProvider>,
			)
		})
	}
	function button(text: string) {
		const result = [...document.querySelectorAll('button')].find(
			(node) =>
				node.getAttribute('aria-label') === text || node.textContent === text,
		)
		if (!result) throw new Error(`Missing ${text}`)
		return result
	}
	async function click(text: string) {
		await flush(() => button(text).click())
	}
	async function type(value: string) {
		const input = host.querySelector('input')!
		await flush(() => {
			Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				'value',
			)!.set!.call(input, value)
			input.dispatchEvent(new Event('input', { bubbles: true }))
		})
	}
	it('does not turn a missing URL into home after failed generation', async () => {
		native.document = { _id: 'drafts.page1', _type: 'page' }
		props = { ...props, value: undefined }
		await render()
		await save()
		expect(native.onChange).not.toHaveBeenCalled()
		await click('Generate')
		expect(host.textContent).toContain('Add a title or name')
		await save()
		expect(native.onChange).not.toHaveBeenCalled()
		expect(button('Copy URL').disabled).toBe(true)
	})
	it('autosaves after a pause and patches only current, preserving slug metadata', async () => {
		await render()
		await type('leadership')
		expect(host.querySelector('input')!.getAttribute('aria-busy')).toBe('true')
		expect(host.querySelector('[aria-label="Saving URL"]')).not.toBeNull()
		expect(native.onChange).not.toHaveBeenCalled()
		await save()
		expect(host.querySelector('[aria-label="Saving URL"]')).toBeNull()
		expect(native.prepare).toHaveBeenCalledWith(
			{
				document: native.document,
				storedValue: '/about/leadership',
				readOnly: false,
			},
			expect.any(AbortSignal),
		)
		expect(native.onChange).toHaveBeenCalledWith([
			{ type: 'setIfMissing', value: { _type: 'slug' } },
			{ type: 'set', value: '/about/leadership', path: ['current'] },
		])
	})
	it('blocks patches when occupancy checks fail', async () => {
		native.prepare.mockResolvedValue({
			status: 'blocked',
			reason: 'url-in-use',
		})
		await render()
		await type('leadership')
		await save()
		expect(native.onChange).not.toHaveBeenCalled()
		expect(host.textContent).toContain('Another document already uses this URL')
	})
	it('discards an async save if the field becomes read-only', async () => {
		let finish!: (result: unknown) => void
		native.prepare.mockReturnValue(
			new Promise((resolve) => {
				finish = resolve
			}),
		)
		await render()
		await type('leadership')
		await save()
		props = { ...props, readOnly: true }
		await render()
		await flush(() =>
			finish({
				status: 'ready',
				candidate: { storedValue: '/about/leadership' },
			}),
		)
		expect(native.onChange).not.toHaveBeenCalled()
	})
	it('discards an async save if the document changes remotely', async () => {
		let finish!: (result: unknown) => void
		native.prepare.mockReturnValue(
			new Promise((resolve) => {
				finish = resolve
			}),
		)
		await render()
		await type('leadership')
		await save()
		native.document = { ...native.document, title: 'Changed remotely' }
		await render()
		await flush(() =>
			finish({
				status: 'ready',
				candidate: { storedValue: '/about/leadership' },
			}),
		)
		expect(native.onChange).not.toHaveBeenCalled()
	})
	it('honors whole-field read-only while leaving copy available', async () => {
		props = { ...props, readOnly: true }
		await render()
		expect(host.querySelector('input')!.readOnly).toBe(true)
		expect(button('Generate').disabled).toBe(true)
		expect(button('Folder /about').disabled).toBe(true)
		expect(button('Copy URL').disabled).toBe(false)
	})
	it('blocks liveEdit schemas even before the first publication', async () => {
		native.schema.get.mockReturnValue({ liveEdit: true })
		await render()
		expect(button('Generate').disabled).toBe(true)
		expect(host.textContent).toContain('draft-based documents only')
	})
	it('explains why published URL editing needs the publication integration', async () => {
		native.load.mockResolvedValue({
			status: 'loaded',
			folders: [],
			editable: false,
			reason: 'published-document',
		})
		await render()
		expect(button('Generate').disabled).toBe(true)
		expect(host.textContent).toContain('URL-change publishing workflow')
		expect(createUrlEditController).toHaveBeenLastCalledWith(
			routes,
			native.client,
			{ allowPublishedDrafts: false },
		)
	})
	it('opts into draft editing and invalidates an in-flight save when publication integration is removed', async () => {
		props = { ...props, allowPublishedDrafts: true }
		let finish!: (value: unknown) => void
		native.prepare.mockReturnValue(
			new Promise((resolve) => {
				finish = resolve
			}),
		)
		await render()
		expect(createUrlEditController).toHaveBeenLastCalledWith(
			routes,
			native.client,
			{ allowPublishedDrafts: true },
		)
		await type('leadership')
		await save()
		props = { ...props, allowPublishedDrafts: false }
		await render()
		expect(createUrlEditController).toHaveBeenLastCalledWith(
			routes,
			native.client,
			{ allowPublishedDrafts: false },
		)
		await flush(() =>
			finish({
				status: 'ready',
				candidate: { storedValue: '/about/leadership' },
			}),
		)
		expect(native.onChange).not.toHaveBeenCalled()
	})
	it('blocks publishing from the first local edit until the accepted URL appears in native form state', async () => {
		props = { ...props, allowPublishedDrafts: true }
		await render()
		expect(getUrlPublicationBlocked(publicationScope)).toBe(false)
		await type('leadership')
		expect(getUrlPublicationBlocked(publicationScope)).toBe(true)
		await save()
		expect(native.onChange).toHaveBeenCalledOnce()
		// The server check has finished, but the action still must not publish the
		// previous draft value while the native patch is waiting to echo back.
		expect(getUrlPublicationBlocked(publicationScope)).toBe(true)
		props = {
			...props,
			value: { _type: 'slug', current: '/about/leadership' },
		}
		native.document = {
			...native.document,
			pathname: { current: '/about/leadership' },
		}
		await render()
		expect(getUrlPublicationBlocked(publicationScope)).toBe(false)
	})
	it('keeps a local URL proposal when another field creates the published page’s first draft', async () => {
		props = { ...props, allowPublishedDrafts: true }
		native.document = { ...native.document, _id: 'page1' }
		await render()
		await type('leadership')
		expect(getUrlPublicationBlocked(publicationScope)).toBe(true)
		// Body/title edits create the native draft before the URL debounce finishes.
		// The stored URL is unchanged, so this must not discard the local proposal.
		native.document = {
			...native.document,
			_id: 'drafts.page1',
			_rev: 'draft-created',
			body: 'New draft body',
		}
		await render()
		expect(host.querySelector('input')!.value).toBe('leadership')
		expect(host.querySelector('input')!.readOnly).toBe(false)
		expect(native.load).toHaveBeenCalledOnce()
		expect(getUrlPublicationBlocked(publicationScope)).toBe(true)
		await save()
		expect(native.prepare).toHaveBeenLastCalledWith(
			{
				document: native.document,
				storedValue: '/about/leadership',
				readOnly: false,
			},
			expect.any(AbortSignal),
		)
		expect(native.onChange).toHaveBeenCalledWith([
			{ type: 'setIfMissing', value: { _type: 'slug' } },
			{ type: 'set', value: '/about/leadership', path: ['current'] },
		])
	})
	it('still replaces a local proposal when the stored URL changes during first-draft creation', async () => {
		props = { ...props, allowPublishedDrafts: true }
		native.document = { ...native.document, _id: 'page1' }
		await render()
		await type('leadership')
		native.document = {
			...native.document,
			_id: 'drafts.page1',
			pathname: { current: '/company/remote' },
		}
		props = { ...props, value: { _type: 'slug', current: '/company/remote' } }
		await render()
		expect(host.querySelector('input')!.value).toBe('remote')
		expect(getUrlPublicationBlocked(publicationScope)).toBe(false)
		await save()
		expect(native.onChange).not.toHaveBeenCalled()
	})
	it('discards the local URL proposal when navigating to a different document with the same stored URL', async () => {
		props = { ...props, allowPublishedDrafts: true }
		await render()
		await type('leadership')
		native.document = { ...native.document, _id: 'drafts.page2' }
		await render()
		expect(host.querySelector('input')!.value).toBe('team')
		expect(getUrlPublicationBlocked(publicationScope)).toBe(false)
		expect(
			getUrlPublicationBlocked({ ...publicationScope, documentId: 'page2' }),
		).toBe(false)
		await save()
		expect(native.onChange).not.toHaveBeenCalled()
	})
	it('keeps invalid local proposals from publishing, then clears the block on correction or unmount', async () => {
		props = { ...props, allowPublishedDrafts: true }
		await render()
		await type('not a slug')
		await save()
		expect(getUrlPublicationBlocked(publicationScope)).toBe(true)
		expect(native.onChange).not.toHaveBeenCalled()
		await type('team')
		expect(getUrlPublicationBlocked(publicationScope)).toBe(false)
		await type('another invalid slug')
		expect(getUrlPublicationBlocked(publicationScope)).toBe(true)
		await flush(() => root.render(null))
		expect(getUrlPublicationBlocked(publicationScope)).toBe(false)
	})
	it('replaces the slug directly and autosaves when Generate is clicked', async () => {
		await render()
		await click('Generate')
		expect(document.querySelector('[role=dialog]')).toBeNull()
		expect(native.onChange).not.toHaveBeenCalled()
		expect(host.querySelector('input')!.value).toBe('hello-world')
		expect(native.onChange).not.toHaveBeenCalled()
		await save()
		expect(native.onChange).toHaveBeenCalledOnce()
	})
	it('does not save again when Generate returns the already stored slug', async () => {
		props = {
			...props,
			value: { _type: 'slug', current: '/about/hello-world' },
		}
		native.document = {
			...native.document,
			pathname: { current: '/about/hello-world' },
		}
		await render()
		await click('Generate')
		await save()
		expect(host.querySelector('input')!.value).toBe('hello-world')
		expect(native.prepare).not.toHaveBeenCalled()
		expect(native.onChange).not.toHaveBeenCalled()
	})
	it('briefly crossfades the copy label without replacing its layout footprint', async () => {
		const writeText = vi.fn().mockResolvedValue(undefined)
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: { writeText },
		})
		await render()
		await click('Copy URL')
		expect(writeText).toHaveBeenCalledWith('/about/team')
		const copy = button('Copy URL')
		const labels = copy.querySelector('[aria-live=polite]')!
		expect(labels.children[0]!.getAttribute('aria-hidden')).toBe('true')
		expect(labels.children[1]!.getAttribute('aria-hidden')).toBe('false')
		expect(host.textContent).not.toContain('URL copied.')
		await act(async () => {
			await vi.advanceTimersByTimeAsync(2500)
		})
		expect(labels.children[0]!.getAttribute('aria-hidden')).toBe('false')
		expect(labels.children[1]!.getAttribute('aria-hidden')).toBe('true')
	})

	it('shows a locked collection prefix while storing only its slug', async () => {
		native.document = {
			_id: 'drafts.post1',
			_type: 'post',
			title: 'Post',
			slug: { current: 'first' },
		}
		props = {
			...props,
			path: ['slug'],
			value: { _type: 'slug', current: 'first' },
		}
		await render()
		expect(host.textContent).toContain('/journal/')
		expect(host.textContent).not.toContain('Folder ')
		await type('second')
		await save()
		expect(native.prepare).toHaveBeenCalledWith(
			{
				document: native.document,
				storedValue: 'second',
				readOnly: false,
			},
			expect.any(AbortSignal),
		)
	})
	it('refuses slash-separated slugs rather than silently moving a page', async () => {
		await render()
		await type('other/child')
		await save()
		expect(native.prepare).not.toHaveBeenCalled()
		expect(native.onChange).not.toHaveBeenCalled()
	})
	it('lets an editor explicitly repair a malformed stored pathname', async () => {
		props = { ...props, value: { _type: 'slug', current: 'bad-path' } }
		await render()
		expect(host.querySelector('input')!.getAttribute('aria-label')).toBe(
			'Full pathname',
		)
		await type('/about//leadership/')
		await save()
		expect(native.prepare).toHaveBeenCalledWith(
			{
				document: native.document,
				storedValue: '/about/leadership',
				readOnly: false,
			},
			expect.any(AbortSignal),
		)
	})
	it('does not clean a stored URL merely by opening its document', async () => {
		props = { ...props, value: { _type: 'slug', current: '/about//team/' } }
		await render()
		await save()
		expect(native.prepare).not.toHaveBeenCalled()
		expect(native.onChange).not.toHaveBeenCalled()
	})
	it('retains newer typing when an earlier native patch echoes back', async () => {
		await render()
		await type('first')
		await save()
		await type('second')
		native.document = {
			...native.document,
			pathname: { current: '/about/first' },
		}
		props = { ...props, value: { _type: 'slug', current: '/about/first' } }
		await render()
		expect(host.querySelector('input')!.value).toBe('second')
		await save()
		expect(native.onChange).toHaveBeenLastCalledWith([
			{ type: 'setIfMissing', value: { _type: 'slug' } },
			{ type: 'set', value: '/about/second', path: ['current'] },
		])
	})
	it('marks duplicate URLs invalid without retry, then clears the error after editing', async () => {
		native.prepare.mockResolvedValueOnce({
			status: 'blocked',
			reason: 'url-in-use',
		})
		await render()
		await type('taken-team')
		await save()
		const input = host.querySelector('input')!
		expect(input.validity.customError).toBe(true)
		expect(input.getAttribute('aria-invalid')).toBe('true')
		expect(host.querySelector('[role="alert"]')?.textContent).toContain(
			'Another document already uses this URL',
		)
		expect(input.getAttribute('aria-describedby')).toContain(
			host.querySelector('[role="alert"]')!.id,
		)
		expect(host.textContent).not.toContain('Retry saving URL')
		expect(native.onChange).not.toHaveBeenCalled()
		await type('unique-team')
		await save()
		expect(input.validity.customError).toBe(false)
		expect(host.querySelector('[role="alert"]')).toBeNull()
		expect(native.onChange).toHaveBeenCalledOnce()
	})
	it('shows specific access requirements on load and clears them after reloading', async () => {
		native.load.mockResolvedValueOnce({
			status: 'blocked',
			reason: 'unknown-read-access',
			accessIssues: [
				{
					key: 'folders',
					label: 'Read the folder registry',
					status: 'missing',
				},
				{
					key: 'pages:releases',
					label: 'Read all page documents — release versions',
					status: 'unverified',
				},
			],
		})
		await render()
		const alert = host.querySelector('[role="alert"]')
		expect(alert?.getAttribute('data-tone')).toBe('critical')
		expect(alert?.textContent).toContain('Missing read access')
		expect(alert?.textContent).toContain('Read the folder registry')
		expect(alert?.textContent).toContain('Read access could not be verified')
		expect(alert?.textContent).toContain(
			'Read all page documents — release versions',
		)
		expect(native.onChange).not.toHaveBeenCalled()
		await click('Reload URL information')
		expect(host.querySelector('[role="alert"]')).toBeNull()
		await type('leadership')
		await save()
		expect(native.onChange).toHaveBeenCalledOnce()
	})
	it('preserves access details in native field validation and clears them after the next successful check', async () => {
		native.prepare.mockResolvedValueOnce({
			status: 'blocked',
			reason: 'unknown-read-access',
			accessIssues: [
				{
					key: 'pages:drafts',
					label: 'Read all page documents — drafts',
					status: 'unverified',
				},
			],
		})
		await render()
		await type('leadership')
		await save()
		const input = host.querySelector('input')!
		expect(input.validationMessage).toContain(
			'Read access could not be verified: Read all page documents — drafts',
		)
		expect(input.validationMessage).toContain(
			'Contact someone who manages project permissions',
		)
		expect(host.querySelector('[role="alert"]')?.textContent).toContain(
			input.validationMessage,
		)
		expect(host.textContent).not.toContain('Retry saving URL')
		expect(native.onChange).not.toHaveBeenCalled()
		await type('leadership-team')
		await save()
		expect(input.validity.customError).toBe(false)
		expect(host.querySelector('[role="alert"]')).toBeNull()
		expect(native.onChange).toHaveBeenCalledOnce()
	})
	it('marks malformed local values invalid without retry or preparing a save', async () => {
		await render()
		await type('invalid?query')
		expect(host.querySelector('input')!.validity.customError).toBe(true)
		expect(host.querySelector('[role="alert"]')).not.toBeNull()
		expect(host.textContent).not.toContain('Retry saving URL')
		await save()
		expect(native.prepare).not.toHaveBeenCalled()
	})
	it('allows explicit retry after failed checks without an automatic retry loop', async () => {
		native.prepare.mockResolvedValueOnce({
			status: 'blocked',
			reason: 'request-failed',
		})
		await render()
		await type('leadership')
		await save()
		await save()
		expect(native.prepare).toHaveBeenCalledTimes(1)
		expect(host.querySelector('[role="alert"]')?.textContent).toContain(
			'The URL could not be prepared',
		)
		await click('Retry saving URL')
		await save()
		expect(native.onChange).toHaveBeenCalledOnce()
	})
	it('requires a deliberate homepage choice for a new empty URL', async () => {
		native.document = { _id: 'drafts.page1', _type: 'page' }
		props = { ...props, value: undefined }
		await render()
		await save()
		expect(native.onChange).not.toHaveBeenCalled()
		await click('Use as homepage')
		await save()
		expect(native.prepare).toHaveBeenCalledWith(
			{ document: native.document, storedValue: '/', readOnly: false },
			expect.any(AbortSignal),
		)
	})
})
