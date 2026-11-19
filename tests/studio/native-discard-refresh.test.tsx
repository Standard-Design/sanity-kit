// @vitest-environment jsdom

/**
 * Isolated upstream regression: executes Sanity's installed component source,
 * not a copy of its notification logic. Only its document-store hooks are fake.
 * Expected failures track missing native refresh messages, not kit behavior.
 */
import { execFileSync } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import * as React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { act, useSyncExternalStore, type ComponentType } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest'

interface Document {
	_id: string
	_type: string
	_rev: string
	title: string
}
interface EditState {
	draft: Document | null
	published: Document | null
	version: Document | null
	ready: boolean
}
interface Refresh {
	source: 'mutation'
	livePreviewEnabled: boolean
	document: Pick<Document, '_id' | '_type' | '_rev'>
}
interface Props {
	id: string
	type: string
	comlink: { post: (event: string, payload: Refresh) => void }
	previewKitConnection: string
	loadersConnection: string
}

let NativeRefresh: ComponentType<Props>
let state: EditState
const listeners = new Set<() => void>()
const getSnapshot = () => state
const subscribe = (listener: () => void) => {
	listeners.add(listener)
	return () => listeners.delete(listener)
}
const useEditState = vi.fn(() =>
	useSyncExternalStore(subscribe, getSnapshot, getSnapshot),
)
let release: string | undefined

beforeAll(async () => {
	const require = createRequire(import.meta.url)
	// Optional override permits the same fixture against an unpacked npm release,
	// without installing it or changing the consumer/workspace dependencies.
	const packageRoot =
		process.env.SANITY_NATIVE_REFRESH_PACKAGE ??
		dirname(require.resolve('sanity/package.json'))
	const files = await readdir(join(packageRoot, 'lib'))
	const mapName = files.find((name) =>
		/^PostMessageRefreshMutations-.*\.js\.map$/u.test(name),
	)
	if (!mapName)
		throw new Error(
			'Native refresh source map was not found; review the upstream fixture on this Sanity upgrade',
		)
	const map = JSON.parse(
		await readFile(join(packageRoot, 'lib', mapName), 'utf8'),
	) as { sources: string[]; sourcesContent: string[] }
	const index = map.sources.findIndex((name) =>
		name.endsWith('/PostMessageRefreshMutations.tsx'),
	)
	const source = map.sourcesContent[index]
	if (!source)
		throw new Error('Native refresh source was not included in its map')
	// Compile in a Node process: jsdom's typed-array realm is incompatible with
	// esbuild's TextEncoder invariant. The source is passed on stdin, not a shell.
	const code = execFileSync(
		process.execPath,
		[
			'--input-type=module',
			'-e',
			"import {readFileSync} from 'node:fs'; import {transformSync} from 'esbuild'; process.stdout.write(transformSync(readFileSync(0, 'utf8'), {loader: 'tsx', format: 'cjs', jsx: 'automatic'}).code)",
		],
		{
			cwd: process.cwd(),
			input: source,
			encoding: 'utf8',
		},
	)
	const module = { exports: {} as { default: ComponentType<Props> } }
	// Deliberately execute trusted installed package source with only the store
	// hooks replaced. Production code never imports or patches this private file.
	// eslint-disable-next-line @typescript-eslint/no-implied-eval
	const execute = new Function('require', 'module', 'exports', code) as (
		require: (name: string) => unknown,
		moduleValue: typeof module,
		exports: unknown,
	) => void
	execute(
		(name) => {
			if (name === 'react') return React
			if (name === 'react/jsx-runtime') return jsxRuntime
			if (name === 'sanity')
				return {
					getPublishedId: (id: string) =>
						id.replace(/^drafts\./u, '').replace(/^versions\.[^.]+\./u, ''),
					useEditState,
					usePerspective: () => ({ selectedReleaseId: release }),
				}
			throw new Error(
				`Unexpected dependency in isolated native refresh fixture: ${name}`,
			)
		},
		module,
		module.exports,
	)
	NativeRefresh = module.exports.default
})

describe('native Presentation draft-removal refresh', () => {
	let root: Root
	let container: HTMLDivElement
	let siteName: string
	let props: Props
	const published: Document = {
		_id: 'settings',
		_type: 'settings',
		_rev: 'published-1',
		title: 'Original site',
	}
	const draft = (revision = 'draft-1', title = 'Temporary site'): Document => ({
		...published,
		_id: 'drafts.settings',
		_rev: revision,
		title,
	})
	const post = vi.fn((event: string, payload: Refresh) => {
		void event
		void payload
		// Model the loader read caused by an emitted refresh, independently of the
		// page being previewed. No data source or navigation is changed by this stub.
		siteName =
			state.version?.title ??
			state.draft?.title ??
			state.published?.title ??
			'(missing)'
	})
	beforeEach(() => {
		Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
		state = { draft: null, published, version: null, ready: true }
		release = undefined
		siteName = published.title
		post.mockClear()
		useEditState.mockClear()
		props = {
			id: 'settings',
			type: 'settings',
			comlink: { post },
			previewKitConnection: 'disconnected',
			loadersConnection: 'disconnected',
		}
		container = document.createElement('div')
		document.body.append(container)
		root = createRoot(container)
	})
	afterEach(async () => {
		await act(async () => {
			root.unmount()
			await Promise.resolve()
		})
		container.remove()
		listeners.clear()
	})
	async function render() {
		await act(async () => {
			root.render(<NativeRefresh {...props} />)
			await Promise.resolve()
		})
	}
	async function update(next: Partial<EditState>) {
		await act(async () => {
			state = { ...state, ...next }
			for (const listener of listeners) listener()
			await Promise.resolve()
		})
	}
	it('refreshes for ordinary draft edits and restoring the published value through a field', async () => {
		await render()
		expect(post).not.toHaveBeenCalled()
		await update({ draft: draft() })
		expect(post.mock.calls.at(-1)?.[0]).toBe('presentation/refresh')
		expect(post.mock.calls.at(-1)?.[1].document).toMatchObject({
			_id: 'drafts.settings',
			_rev: 'draft-1',
		})
		expect(siteName).toBe('Temporary site')
		await update({ draft: draft('draft-2', published.title) })
		expect(siteName).toBe(published.title)
		expect(post).toHaveBeenCalledTimes(2)
	})
	it('isolates the missing notification to draft removal with an unchanged published revision', async () => {
		await render()
		await update({ draft: draft() })
		post.mockClear()
		await update({ draft: null })
		expect(state.published).toBe(published)
		expect(state.draft).toBeNull()
		expect(post).not.toHaveBeenCalled()
		expect(siteName).toBe('Temporary site')
		await render()
		expect(post).not.toHaveBeenCalled()
		// A fresh read already sees the published value; only notification is missing.
		expect(state.published?.title).toBe('Original site')
	})
	it.fails(
		'refreshes the preview when Discard changes falls back to the unchanged published document',
		async () => {
			await render()
			await update({ draft: draft() })
			post.mockClear()
			await update({ draft: null })
			expect(post).toHaveBeenCalledWith(
				'presentation/refresh',
				expect.objectContaining({ source: 'mutation' }),
			)
			expect(siteName).toBe('Original site')
		},
	)
	it('does refresh when publishing removes the draft AND changes the published revision', async () => {
		await render()
		await update({ draft: draft() })
		post.mockClear()
		await update({
			draft: null,
			published: {
				...published,
				_rev: 'published-2',
				title: 'Published update',
			},
		})
		expect(post).toHaveBeenCalledTimes(1)
		expect(siteName).toBe('Published update')
	})
	it('does not treat selection of another edited document as a mutation', async () => {
		await render()
		await update({ draft: draft() })
		post.mockClear()
		props = { ...props, id: 'another-settings' }
		state = {
			...state,
			draft: null,
			published: { ...published, _id: 'another-settings', _rev: 'other-1' },
		}
		await render()
		expect(post).not.toHaveBeenCalled()
		expect(useEditState).toHaveBeenLastCalledWith(
			'another-settings',
			'settings',
			'low',
			undefined,
		)
	})
	it('also misses removal of a release version when the draft and published revisions stay unchanged', async () => {
		release = 'launch'
		state = {
			...state,
			draft: draft(),
			version: {
				...published,
				_id: 'versions.launch.settings',
				_rev: 'release-1',
				title: 'Release title',
			},
		}
		await render()
		expect(useEditState).toHaveBeenCalledWith(
			'settings',
			'settings',
			'low',
			'launch',
		)
		await update({ version: { ...state.version!, _rev: 'release-2' } })
		expect(siteName).toBe('Release title')
		post.mockClear()
		await update({ version: null })
		expect(post).not.toHaveBeenCalled()
		expect(siteName).toBe('Release title')
	})
	it('also misses removal of a published document when no fallback remains', async () => {
		await render()
		await update({
			published: {
				...published,
				_rev: 'published-2',
				title: 'Updated live site',
			},
		})
		post.mockClear()
		await update({ published: null })
		expect(post).not.toHaveBeenCalled()
		expect(siteName).toBe('Updated live site')
	})
	it('also misses published removal while an unchanged draft remains', async () => {
		state = { ...state, draft: draft() }
		await render()
		await update({ published: null })
		expect(post).not.toHaveBeenCalled()
	})

	it('sends no notification when deleting the last draft-only document unmounts its notifier', async () => {
		state = { ...state, published: null, draft: draft() }
		await render()
		await update({ draft: draft('draft-2') })
		post.mockClear()
		await update({ draft: null })
		expect(post).not.toHaveBeenCalled()
	})
})
