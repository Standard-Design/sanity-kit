/** Real browser layout/performance harness. Studio hooks and data are synthetic. */
import { createRoot } from 'react-dom/client'
import { Profiler, useMemo, useState, type ContextType } from 'react'
import { Card, ThemeProvider } from '@sanity/ui'
import { buildTheme } from '@sanity/ui/theme'
import type { PreviewHeaderProps } from 'sanity/presentation'
import {
	BrowserContext,
	type BrowserState,
} from '../../../src/studio/pages/browser-context.js'
import { createPagesRuntime } from '../../../src/studio/pages/runtime.js'
import { createPagesDataStore } from '../../../src/studio/pages/data-store.js'
import { PagesBrowser } from '../../../src/studio/pages/browser.js'
import { PagesHeader } from '../../../src/studio/pages/header.js'
import { fixture } from './native.js'

type Scene = 'labels' | 'collection' | 'ordinary'
const scene = (new URLSearchParams(location.search).get('scene') ??
	'labels') as Scene
const long = 'exceptionally-long-folder-name-with-no-shortened-path-segments'
const page = (id: string, pathname: string, title = id) => ({
	_id: id,
	_type: 'page',
	_updatedAt: '2026-11-11T12:00:00Z',
	pathname: { current: pathname },
	title,
})
fixture.documents = [
	page('home', '/', 'Home'),
	page('journal-index', '/journal', 'Journal'),
]
if (scene === 'labels') {
	for (let depth = 1; depth <= 6; depth++)
		fixture.documents.push(
			page(
				`deep-${depth}`,
				`/${Array(depth).fill(long).join('/')}/page`,
				'An exceptionally long page title that should ellipsize while its complete path wraps',
			),
		)
} else if (scene === 'ordinary') {
	for (let index = 0; index < 1000; index++)
		fixture.documents.push(
			page(
				`page-${String(index).padStart(4, '0')}`,
				`/pages/page-${index}`,
				`Page ${index}`,
			),
		)
}
for (let index = 0; index < (scene === 'collection' ? 5000 : 8); index++)
	fixture.documents.push({
		_id: `post-${String(index).padStart(5, '0')}`,
		_type: 'post',
		_updatedAt: '2026-11-11T12:00:00Z',
		title: `Post ${index}`,
		pathname: { current: `/journal/post-${index}` },
	})
const metrics = {
	commits: 0,
	renderMilliseconds: 0,
	largestCommitMilliseconds: 0,
}
const theme = buildTheme()
const noop = () => {}
function App() {
	const [width, setWidth] = useState(280)
	const [navigatorEnabled, setNavigatorEnabled] = useState(true)
	const [pickerOpen, setPickerOpen] = useState(false)
	const [state, setState] = useState<BrowserState>({
		query: '',
		scrollTop: 0,
		collapsed: [],
		collectionQueries: {},
		collectionScroll: {},
	})
	const runtime = useMemo(
		() =>
			createPagesRuntime({
				name: 'acceptance',
				title: 'Pages',
				previewUrl: 'http://localhost:3346',
				pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
				collections: [
					{
						name: 'journal',
						title:
							scene === 'labels'
								? 'Exceptionally long collection display name for editorial navigation testing'
								: 'Journal',
						itemsTitle: 'Posts',
						routePrefix: '/journal',
						index: { schemaType: 'page', pathname: '/journal' },
						items: [{ schemaType: 'post', pathnameField: 'pathname.current' }],
					},
				],
			}),
		[],
	)
	const dataStore = useMemo(() => createPagesDataStore(runtime), [runtime])
	const value = {
		runtime,
		dataStore,
		state,
		setState,
		pickerOpen,
		setPickerOpen,
		folderSync: {} as NonNullable<
			ContextType<typeof BrowserContext>
		>['folderSync'],
		showPageCreate: noop,
		showCollectionCreate: noop,
		pageCreateOpen: false,
		showFolderSync: noop,
		showFolderRemove: noop,
		showFolderRename: noop,
		renameAvailable: false,
		renamePending: false,
		showFolderCreate: noop,
	}
	const [report, setReport] = useState(
		'Select Measure after an interaction settles.',
	)
	const measure = () => {
		const root =
			document.querySelector('[role=dialog][aria-label="Choose page"]') ??
			document.querySelector('[data-harness-navigator]')!
		const scroll = root.querySelector<HTMLElement>('[data-pages-scroll]')
		setReport(
			JSON.stringify(
				{
					scene,
					build: document
						.querySelector('meta[name=harness-mode]')
						?.getAttribute('content'),
					width,
					metrics,
					queries: fixture.queries,
					queryMilliseconds: Math.round(fixture.queryMilliseconds),
					buttons: root.querySelectorAll('button').length,
					itemRows: root.querySelectorAll('button[aria-label^="Post "]').length,
					scrollWidth: scroll?.scrollWidth,
					clientWidth: scroll?.clientWidth,
					scrollTop: scroll?.scrollTop,
					scrollHeight: scroll?.scrollHeight,
					viewportHeight: scroll?.clientHeight,
				},
				null,
				2,
			),
		)
	}
	return (
		<ThemeProvider theme={theme} scheme="dark">
			<Card
				style={{
					padding: 16,
					color: '#ddd',
					background: '#101115',
					minHeight: '100vh',
					boxSizing: 'border-box',
					font: '14px system-ui',
				}}
			>
				<h1 style={{ fontSize: 18 }}>Navigator acceptance — {scene}</h1>
				<p>
					Real kit rows, Sanity UI, menus and picker. Synthetic
					hooks/data/status; no writes. Local GROQ time is not network latency.
				</p>
				<nav>
					<a href="?scene=labels">Extreme labels</a> ·{' '}
					<a href="?scene=collection">5,000 collection items</a> ·{' '}
					<a href="?scene=ordinary">1,000 ordinary pages</a>
				</nav>
				<div style={{ display: 'flex', gap: 8, padding: '12px 0' }}>
					{[240, 280, 320].map((size) => (
						<button key={size} onClick={() => setWidth(size)}>
							{size}px sidebar
						</button>
					))}
					<button onClick={() => setNavigatorEnabled((v) => !v)}>
						Switch sidebar / picker
					</button>
					<button onClick={measure}>Measure</button>
					<button
						onClick={() => {
							metrics.commits = 0
							metrics.renderMilliseconds = 0
							metrics.largestCommitMilliseconds = 0
							fixture.queries = 0
							fixture.queryMilliseconds = 0
						}}
					>
						Reset measurements
					</button>
				</div>
				<div style={{ display: 'flex', alignItems: 'flex-start', gap: 24 }}>
					<div
						data-harness-navigator
						style={{
							width,
							height: 620,
							border: '1px solid #444',
							minWidth: 0,
						}}
					>
						<BrowserContext.Provider value={value}>
							<Profiler
								id="navigator"
								onRender={(_id, _phase, actual) => {
									metrics.commits++
									metrics.renderMilliseconds += actual
									metrics.largestCommitMilliseconds = Math.max(
										metrics.largestCommitMilliseconds,
										actual,
									)
								}}
							>
								<PagesHeader
									{...({
										navigatorEnabled,
										toggleNavigator: () => setNavigatorEnabled((v) => !v),
										renderDefault: () => null,
									} as unknown as PreviewHeaderProps)}
								/>
								{navigatorEnabled && <PagesBrowser />}
							</Profiler>
						</BrowserContext.Provider>
					</div>
					<pre
						aria-label="Measurements"
						style={{ margin: 0, whiteSpace: 'pre-wrap', maxWidth: 480 }}
					>
						{report}
					</pre>
				</div>
			</Card>
		</ThemeProvider>
	)
}
createRoot(document.getElementById('root')!).render(<App />)
