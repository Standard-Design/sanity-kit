import { describe, expect, it, vi } from 'vitest'
import {
	createPagesDataSource,
	type PagesClient,
} from '../../src/studio/pages/data-source.js'
import { createPagesDataStore } from '../../src/studio/pages/data-store.js'
import { createPagesRuntime } from '../../src/studio/pages/runtime.js'

function client() {
	const fetch = vi.fn().mockResolvedValue([])
	const unsubscribe = vi.fn()
	const subscribe = vi.fn().mockReturnValue({ unsubscribe })
	const listen = vi.fn().mockReturnValue({ subscribe })
	return {
		value: { fetch, listen } as unknown as PagesClient,
		fetch,
		listen,
		subscribe,
		unsubscribe,
	}
}
const runtime = createPagesRuntime({
	previewUrl: 'https://preview.test',
	pages: [{ schemaType: 'page', pathnameField: 'path' }],
})

describe('Studio data transport and isolation', () => {
	it('uses explicit authenticated-client fetch options and copies the perspective', async () => {
		const c = client()
		const view = ['release-id', 'drafts']
		const source = createPagesDataSource(c.value, view, ['page'])
		view.push('unexpected')
		const signal = new AbortController().signal
		await source.fetch({ query: '*[]', params: {} }, signal)
		expect(c.fetch).toHaveBeenCalledWith(
			'*[]',
			{},
			{
				perspective: ['release-id', 'drafts'],
				useCdn: false,
				stega: false,
				signal,
			},
		)
	})
	it('uses published for an empty stack and rejects raw', async () => {
		const c = client()
		await createPagesDataSource(c.value, [], ['page']).fetch(
			{ query: '*[]', params: {} },
			new AbortController().signal,
		)
		expect(c.fetch.mock.calls[0]?.[2]).toMatchObject({
			perspective: ['published'],
		})
		expect(() => createPagesDataSource(c.value, ['raw'], ['page'])).toThrow(
			'effective perspective',
		)
	})
	it('requests all versions, query visibility, welcome and reconnect without copying content bodies', () => {
		const c = client()
		const error = vi.fn()
		const next = vi.fn()
		createPagesDataSource(c.value, ['drafts'], ['page', 'post'])
			.listen({ next, error })
			.unsubscribe()
		expect(c.listen).toHaveBeenCalledWith(
			'*[_type in $types]',
			{ types: ['page', 'post'] },
			{
				includeResult: false,
				includeMutations: false,
				includeAllVersions: true,
				visibility: 'query',
				events: ['welcome', 'mutation', 'reconnect'],
			},
		)
		expect(c.subscribe).toHaveBeenCalledWith({ next, error, complete: error })
		expect(c.unsubscribe).toHaveBeenCalledOnce()
	})
	it('shares equivalent perspectives but isolates different clients, tools, and perspective order', () => {
		const c = client()
		const store = createPagesDataStore(runtime)
		const drafts = store.session(c.value, ['drafts'])
		expect(drafts).toBe(store.session(c.value, ['drafts']))
		expect(drafts).not.toBe(store.session(c.value, ['published']))
		expect(drafts).not.toBe(store.session(client().value, ['drafts']))
		expect(drafts).not.toBe(
			createPagesDataStore(runtime).session(c.value, ['drafts']),
		)
		expect(store.session(c.value, ['a', 'b', 'drafts'])).not.toBe(
			store.session(c.value, ['b', 'a', 'drafts']),
		)
		expect(c.fetch).not.toHaveBeenCalled()
		expect(c.listen).not.toHaveBeenCalled()
	})
})
