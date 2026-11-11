// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'

const editing = vi.hoisted(() => ({ enable: vi.fn() }))
vi.mock('@sanity/visual-editing', () => ({
	enableVisualEditing: editing.enable,
	createDataAttribute: vi.fn(),
}))
afterEach(() => {
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

it('uses published reads and full document navigation without enabling overlays', async () => {
	document.documentElement.dataset.fixtureMode = 'published'
	document.body.innerHTML = '<main>Loading</main>'
	const fetch = vi.fn(() =>
		Promise.resolve({
			ok: true,
			json: () =>
				Promise.resolve({
					projectId: 'proof123',
					dataset: 'development',
					page: null,
					links: [{ title: 'Old page', pathname: '/old' }],
				}),
		}),
	)
	vi.stubGlobal('fetch', fetch)
	// This module normally lives for one browser document; avoid retaining its
	// history listener in the test environment after the module has run.
	const listener = vi.spyOn(window, 'addEventListener')
	await import('../fixtures/pages-studio/preview-client.js')
	await vi.waitFor(() =>
		expect(document.querySelector('a')?.textContent).toBe('Old page'),
	)
	expect(editing.enable).not.toHaveBeenCalled()
	expect(fetch).toHaveBeenCalledWith(
		expect.stringContaining('perspective=%22published%22'),
		expect.anything(),
	)
	const anchor = document.querySelector('a')!
	let intercepted: boolean | undefined
	anchor.addEventListener('click', (event) => {
		intercepted = event.defaultPrevented
		// Stop jsdom's unimplemented browser navigation after observing whether
		// the fixture itself intercepted the click.
		event.preventDefault()
	})
	anchor.dispatchEvent(
		new MouseEvent('click', { button: 0, bubbles: true, cancelable: true }),
	)
	expect(intercepted).toBe(false)
	expect(fetch).toHaveBeenCalledOnce()
	for (const [type, callback, options] of listener.mock.calls)
		window.removeEventListener(type, callback, options)
})
