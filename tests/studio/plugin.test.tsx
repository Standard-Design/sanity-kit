import { describe, expect, it, vi } from 'vitest'
import type { ConfigContext, Tool } from 'sanity'
import type { PresentationPluginOptions } from 'sanity/presentation'
import {
	createPagesRuntime,
	type PagesToolOptions,
} from '../../src/studio/pages/runtime.js'
const native = vi.hoisted(() => ({
	presentation: vi.fn((options: PresentationPluginOptions) => ({
		name: options.name ?? 'native-presentation',
	})),
}))
vi.mock('sanity', () => ({ definePlugin: (factory: unknown) => factory }))
vi.mock('sanity/presentation', () => ({
	presentationTool: native.presentation,
}))
vi.mock('../../src/studio/pages/header.js', () => ({ PagesHeader: () => null }))
vi.mock('../../src/studio/pages/browser.js', () => ({
	PagesBrowser: () => null,
}))
import { pagesTool } from '../../src/studio/index.js'

const options: PagesToolOptions = {
	pages: [{ schemaType: 'page', pathnameField: 'path' }],
	previewUrl: 'http://localhost:3000',
}
const context = {
	projectId: 'project',
	dataset: 'test',
	schema: {
		get: (name: string) =>
			name === 'page'
				? {
						type: { name: 'document' },
						jsonType: 'object',
						fields: ['title', 'path'].map((name) => ({
							name,
							type: { jsonType: 'string' },
						})),
					}
				: undefined,
	},
} as unknown as ConfigContext
const tool = (name: string): Tool => ({
	name,
	title: name,
	component: () => null,
})

describe('Pages plugin foundation', () => {
	it('defaults names and snapshots routing independently for each tool', () => {
		const mutable = {
			...options,
			pages: [{ schemaType: 'page', pathnameField: 'path' }],
		}
		const first = createPagesRuntime(mutable)
		mutable.pages[0]!.pathnameField = 'other'
		const second = createPagesRuntime({ ...mutable, name: 'other-pages' })
		expect(first.name).toBe('pages')
		expect(first.title).toBe('Pages')
		expect(first.registry.types[0]?.pathnameField).toBe('path')
		expect(second.model.previewQuery('/')?.query).toContain('@["other"]')
		expect(first.model.previewQuery('/')?.query).not.toContain('@["other"]')
		expect(first.create).toBeUndefined()
	})
	it.each([
		[{ name: '' }, 'URL-safe'],
		[{ name: 'bad/path' }, 'URL-safe'],
		[{ title: ' ' }, 'title'],
		[{ previewUrl: undefined }, 'previewUrl'],
		[{ components: {} }, 'owns Presentation'],
		[{ locate: () => null }, 'resolve'],
		[
			{ create: { schemaType: 'missing', templateId: 'missing' } },
			'registered',
		],
		[{ create: { schemaType: 'page', templateId: ' ' } }, 'templateId'],
	])(
		'rejects invalid or unsupported plugin configuration %#',
		(overrides, error) => {
			expect(() =>
				createPagesRuntime({ ...options, ...overrides } as PagesToolOptions),
			).toThrow(error)
		},
	)
	it('composes native options and resolvers without leaking route metadata', () => {
		const resolve = { mainDocuments: [] }
		pagesTool({
			...options,
			name: 'custom',
			title: 'Custom',
			devMode: true,
			resolve,
		})
		const args = native.presentation.mock.calls.at(-1)?.[0]
		expect(args).toMatchObject({
			name: 'custom',
			title: 'Custom',
			devMode: true,
			previewUrl: options.previewUrl,
			resolve: { mainDocuments: [] },
		})
		expect(args).not.toHaveProperty('pages')
		expect(args?.resolve?.locations).toHaveProperty('page')
		expect(args).not.toHaveProperty('create')
		expect(args).toHaveProperty('components.unstable_header.component')
		expect(args).toHaveProperty('components.unstable_navigator.minWidth', 240)
	})
	it('wraps only its named tool and preserves native metadata and other tools', () => {
		const plugin = pagesTool(options)
		if (typeof plugin.tools !== 'function')
			throw new Error('Expected tools reducer')
		const pages = tool('pages'),
			other = tool('structure')
		const result = plugin.tools([pages, other], context)
		expect(result[1]).toBe(other)
		expect(result[0]?.name).toBe(pages.name)
		expect(result[0]?.component).not.toBe(pages.component)
		expect(
			() =>
				plugin.tools &&
				typeof plugin.tools === 'function' &&
				plugin.tools([pages, pages], context),
		).toThrow('exactly one')
	})
	it('checks compiled schema instead of accepting arbitrary route fields', () => {
		const plugin = pagesTool({
			...options,
			pages: [{ schemaType: 'page', pathnameField: 'absent' }],
		})
		if (typeof plugin.tools !== 'function')
			throw new Error('Expected tools reducer')
		expect(
			() =>
				typeof plugin.tools === 'function' &&
				plugin.tools([tool('pages')], context),
		).toThrow('resolve to a string')
	})
})
