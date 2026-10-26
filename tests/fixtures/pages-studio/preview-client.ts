/** Tiny real frontend for exercising Presentation's native navigation and overlays. */
import {
	createDataAttribute,
	enableVisualEditing,
	type HistoryAdapterNavigate,
} from '@sanity/visual-editing'
import type { ClientPerspective } from '@sanity/client'

interface PreviewDocument {
	_id: string
	_type: string
	title: string | null
	body: string | null
	pathname: string
	shared: {
		_id: string
		_type: string
		title: string | null
		body: string | null
	} | null
}

let perspective: ClientPerspective = 'drafts'
let pending: AbortController | undefined
let reportNavigation: HistoryAdapterNavigate | undefined

function moveTo(path: string, replace = false) {
	const target = new URL(path, location.href)
	// Ignore echoes of a location that this frontend already reported to Studio.
	if (target.origin !== location.origin || target.href === location.href) return
	if (replace) history.replaceState(null, '', target)
	else history.pushState(null, '', target)
	reportNavigation?.({
		type: replace ? 'replace' : 'push',
		url: `${location.pathname}${location.search}${location.hash}`,
	})
	void refresh()
}

window.addEventListener('popstate', () => {
	reportNavigation?.({
		type: 'pop',
		url: `${location.pathname}${location.search}${location.hash}`,
	})
	void refresh()
})

async function refresh() {
	pending?.abort()
	const request = new AbortController()
	pending = request
	try {
		const response = await fetch(
			`/fixture-data?path=${encodeURIComponent(location.pathname)}&perspective=${encodeURIComponent(JSON.stringify(perspective))}`,
			{ signal: request.signal },
		)
		if (!response.ok)
			throw new Error(
				'Preview data unavailable. Check the local server and read token.',
			)
		const data = (await response.json()) as {
			projectId: string
			dataset: string
			page: PreviewDocument | null
			links: { title: string | null; pathname: string }[]
		}
		if (request.signal.aborted) return
		const main = document.createElement('main')
		const nav = document.createElement('nav')
		nav.setAttribute('aria-label', 'Fixture pages')
		for (const link of data.links) {
			const anchor = document.createElement('a')
			anchor.href = link.pathname
			anchor.textContent = link.title ?? 'Untitled'
			anchor.addEventListener('click', (event) => {
				if (
					event.button !== 0 ||
					event.metaKey ||
					event.ctrlKey ||
					event.altKey ||
					event.shiftKey
				)
					return
				event.preventDefault()
				moveTo(link.pathname)
			})
			nav.append(anchor, ' · ')
		}
		main.append(nav)
		if (data.page) {
			const { page } = data
			const attribute = createDataAttribute({
				projectId: data.projectId,
				dataset: data.dataset,
				id: page._id,
				type: page._type,
			})
			const heading = document.createElement('h1')
			heading.textContent = page.title ?? 'Untitled'
			heading.dataset.sanity = attribute.scope('title').toString()
			const body = document.createElement('p')
			body.textContent = page.body ?? 'Add body text in Studio.'
			body.dataset.sanity = attribute.scope('body').toString()
			main.append(heading, body)
			if (page.shared) {
				const footer = document.createElement('footer')
				footer.textContent = `Shared content: ${page.shared.body ?? page.shared.title ?? 'Untitled'}`
				footer.dataset.sanity = createDataAttribute({
					projectId: data.projectId,
					dataset: data.dataset,
					id: page.shared._id,
					type: page.shared._type,
					path: 'body',
				}).toString()
				main.append(footer)
			}
		} else {
			const heading = document.createElement('h1')
			heading.textContent = 'No fixture page at this URL'
			main.append(heading)
		}
		document.querySelector('main')?.replaceWith(main)
	} catch (error) {
		if (!request.signal.aborted) {
			const main = document.querySelector('main')
			if (main)
				main.textContent =
					error instanceof Error ? error.message : 'Preview unavailable'
		}
	}
}

enableVisualEditing({
	history: {
		subscribe: (notify) => {
			reportNavigation = notify
			notify({
				type: 'replace',
				url: `${location.pathname}${location.search}${location.hash}`,
			})
			return () => {
				reportNavigation = undefined
			}
		},
		update: (update) => {
			if (update.type === 'pop') history.back()
			else moveTo(update.url, update.type === 'replace')
		},
	},
	refresh,
	onPerspectiveChange: (next) => {
		perspective = next
		void refresh()
	},
})
void refresh()
