// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PagesCreateOptions } from '../../src/studio/pages/runtime.js'
import { usePageCreationOptions } from '../../src/studio/pages/creation-options.js'

const native = vi.hoisted(() => ({
	templates: [] as Array<{
		id: string
		schemaType: string
		title?: string
		parameters?: unknown[]
		singleton?: string
	}>,
	types: new Map<
		string,
		{ type: { name: string }; title?: string; liveEdit?: boolean }
	>(),
	permissions: undefined as
		| Array<{
				id: string
				templateId: string
				schemaType: string
				granted: boolean
		  }>
		| undefined,
	loading: false,
	permissionHook: vi.fn<(options: { templateItems: unknown[] }) => void>(),
}))
vi.mock('sanity', () => {
	const schema = { get: (name: string) => native.types.get(name) }
	return {
		useSchema: () => schema,
		useTemplates: () => native.templates,
		useTemplatePermissions: (options: { templateItems: unknown[] }) => {
			native.permissionHook(options)
			return [native.permissions, native.loading]
		},
	}
})

describe('native page creation eligibility', () => {
	let root: Root
	let container: HTMLDivElement
	let result: ReturnType<typeof usePageCreationOptions>
	let choices: readonly PagesCreateOptions[]
	function Probe() {
		result = usePageCreationOptions(choices)
		return null
	}
	function render() {
		act(() => root.render(<Probe />))
		return result
	}
	beforeEach(() => {
		Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
		container = document.createElement('div')
		document.body.append(container)
		root = createRoot(container)
		choices = [{ schemaType: 'page', templateId: 'page' }]
		native.templates = [
			{ id: 'page', schemaType: 'page', title: 'Standard page' },
		]
		native.types.clear()
		native.types.set('page', { type: { name: 'document' }, title: 'Page' })
		native.permissions = [
			{
				id: 'pages-create-0',
				templateId: 'page',
				schemaType: 'page',
				granted: true,
			},
		]
		native.loading = false
		native.permissionHook.mockReset()
	})
	afterEach(() => {
		act(() => root.unmount())
		container.remove()
	})

	it('checks only explicitly configured templates and uses native titles', () => {
		native.templates.push({
			id: 'unregistered',
			schemaType: 'page',
			title: 'Hidden choice',
		})
		expect(render()).toEqual({
			options: [
				{
					id: 'pages-create-0',
					schemaType: 'page',
					templateId: 'page',
					title: 'Standard page',
					granted: true,
				},
			],
			loading: false,
			configurationErrors: [],
		})
		expect(native.permissionHook.mock.lastCall?.[0].templateItems).toEqual([
			{
				type: 'initialValueTemplateItem',
				id: 'pages-create-0',
				schemaType: 'page',
				templateId: 'page',
				title: 'Standard page',
			},
		])
	})

	it('uses a configured title without changing native creation identity', () => {
		choices = [
			{ schemaType: 'page', templateId: 'page', title: 'Marketing page' },
		]
		expect(render().options[0]).toMatchObject({
			title: 'Marketing page',
			templateId: 'page',
			schemaType: 'page',
		})
	})

	it('keeps native permission arguments stable across unrelated rerenders', () => {
		render()
		const first = native.permissionHook.mock.lastCall?.[0]
		render()
		expect(native.permissionHook.mock.lastCall?.[0]).toBe(first)
	})

	it('never grants creation while native results load or are unavailable', () => {
		native.loading = true
		expect(render().options[0]?.granted).toBe(false)
		native.loading = false
		native.permissions = undefined
		expect(render().options[0]?.granted).toBe(false)
	})

	it('does not reuse grants from a different template at the same position', () => {
		render()
		native.templates.push({
			id: 'landing',
			schemaType: 'page',
			title: 'Landing',
		})
		choices = [{ schemaType: 'page', templateId: 'landing' }]
		expect(render().options[0]?.granted).toBe(false)
	})

	it('does not reuse grants for another schema type or denied results', () => {
		native.permissions![0]!.schemaType = 'other'
		expect(render().options[0]?.granted).toBe(false)
		native.permissions = [
			{
				id: 'pages-create-0',
				templateId: 'page',
				schemaType: 'page',
				granted: false,
			},
		]
		expect(render().options[0]?.granted).toBe(false)
	})

	it.each([
		[
			'missing template',
			() => {
				native.templates = []
			},
			'not registered',
		],
		[
			'missing schema',
			() => {
				native.types.clear()
			},
			'document schema',
		],
		[
			'non-document schema',
			() => {
				native.types.set('page', { type: { name: 'object' } })
			},
			'document schema',
		],
		[
			'mismatched schema',
			() => {
				native.templates[0]!.schemaType = 'post'
			},
			'creates "post"',
		],
		[
			'live editing',
			() => {
				native.types.get('page')!.liveEdit = true
			},
			'saves drafts',
		],
		[
			'singleton template',
			() => {
				native.templates[0]!.singleton = 'home'
			},
			'singleton',
		],
		[
			'parameterized template',
			() => {
				native.templates[0]!.parameters = [{ name: 'parent' }]
			},
			'parameters',
		],
	] as const)(
		'refuses %s before asking native permissions',
		(_name, setup, message) => {
			setup()
			const value = render()
			expect(value.options).toEqual([])
			expect(value.configurationErrors).toHaveLength(1)
			expect(value.configurationErrors[0]).toContain(message)
			expect(native.permissionHook.mock.lastCall?.[0].templateItems).toEqual([])
		},
	)

	it('disables even valid choices when another configured choice is invalid', () => {
		choices = [...choices, { schemaType: 'page', templateId: 'missing' }]
		const value = render()
		expect(value.options).toHaveLength(1)
		expect(value.options[0]?.granted).toBe(false)
		expect(value.configurationErrors).toHaveLength(1)
	})
})
