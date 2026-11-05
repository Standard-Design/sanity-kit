// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PagesCreateOptions } from '../../src/studio/pages/runtime.js'
import { createPagesRegistry } from '../../src/url/registry.js'
import {
	usePageCreationOptions,
	type PageCreationContext,
} from '../../src/studio/pages/creation-options.js'

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
		{
			type: { name: string }
			title?: string
			liveEdit?: boolean
			fields?: unknown[]
		}
	>(),
	permissions: undefined as
		| Array<{
				id: string
				templateId: string
				schemaType: string
				granted: boolean
				parameters?: Record<string, unknown>
				resolvedInitialValue?: unknown
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
	let context: PageCreationContext | undefined
	function Probe() {
		result = usePageCreationOptions(choices, context)
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
		context = undefined
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

	function contextual(mode: 'page' | 'index' = 'page', pathname = '/about') {
		context = {
			registry: createPagesRegistry({
				pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
			}),
			mode,
			pathname,
		}
		native.types.get('page')!.fields = [
			{
				name: 'pathname',
				type: { name: 'slug', options: { __sanityKitUrlField: true } },
			},
		]
	}
	function resolveContext(initial: unknown = { _type: 'page' }) {
		render()
		const item = native.permissionHook.mock.lastCall![0].templateItems[0] as {
			parameters: Record<string, unknown>
		}
		native.permissions = [
			{
				id: 'pages-create-0',
				templateId: 'page',
				schemaType: 'page',
				granted: true,
				parameters: item.parameters,
				resolvedInitialValue: initial,
			},
		]
		return render()
	}

	it('passes only a folder hint to native parameters without inventing a page URL or ID', () => {
		contextual()
		const value = resolveContext({
			title: 'Template title',
			body: ['unchanged'],
		})
		expect(value.options[0]?.granted).toBe(true)
		expect(value.options[0]?.parameters).toEqual({
			sanityKitCreation: {
				version: 1,
				mode: 'page',
				pathname: '/about',
				schemaType: 'page',
				templateId: 'page',
				pathField: 'pathname.current',
			},
		})
		expect(native.permissions![0]!.resolvedInitialValue).toEqual({
			title: 'Template title',
			body: ['unchanged'],
		})
		expect(
			native.permissionHook.mock.lastCall![0].templateItems[0],
		).not.toHaveProperty('initialDocumentId')
	})

	it('does not reuse a create grant from another folder or creation mode', () => {
		contextual()
		expect(resolveContext().options[0]?.granted).toBe(true)
		context = { ...context!, pathname: '/other' }
		expect(render().options[0]?.granted).toBe(false)
		context = { ...context, pathname: '/about', mode: 'index' }
		expect(render().options[0]?.granted).toBe(false)
	})

	it('keeps contextual permission parameters stable on unrelated rerenders', () => {
		contextual()
		render()
		const first = native.permissionHook.mock.lastCall?.[0]
		context = { ...context! }
		render()
		expect(native.permissionHook.mock.lastCall?.[0]).toBe(first)
	})

	it('does not overwrite any nonempty template pathname when creating a child page', () => {
		contextual()
		const value = resolveContext({
			_type: 'page',
			pathname: { current: '/about' },
		})
		expect(value.options[0]?.granted).toBe(false)
		expect(value.options[0]?.reason).toContain('already sets')
	})

	it('allows an index template with the exact requested URL but rejects a different one', () => {
		contextual('index')
		expect(
			resolveContext({ _type: 'page', pathname: { current: '/about' } })
				.options[0]?.granted,
		).toBe(true)
		expect(
			resolveContext({ _type: 'page', pathname: { current: '/elsewhere' } })
				.options[0]?.granted,
		).toBe(false)
	})

	it('detects the empty native template-resolution failure fallback', () => {
		contextual()
		const value = resolveContext({})
		expect(value.options[0]?.granted).toBe(false)
		expect(value.options[0]?.reason).toContain('could not be prepared')
	})

	it('allows missing, null and empty initial URL values', () => {
		contextual()
		for (const current of [undefined, null, '']) {
			expect(
				resolveContext({ _type: 'page', pathname: { current } }).options[0]
					?.granted,
			).toBe(true)
		}
	})

	it('does not let invalid contextual choices disable another usable choice', () => {
		contextual()
		choices = [...choices, { schemaType: 'page', templateId: 'missing' }]
		const value = resolveContext()
		expect(value.options[0]?.granted).toBe(true)
		expect(value.configurationErrors[0]).toContain('not registered')
	})

	it('omits unmanaged fields and collection types from contextual choices', () => {
		contextual()
		native.types.get('page')!.fields = [
			{ name: 'pathname', type: { name: 'slug' } },
		]
		expect(render().options).toEqual([])
		contextual()
		context = {
			...context!,
			registry: {
				...context!.registry,
				types: [{ ...context!.registry.types[0]!, collection: 'journal' }],
			},
		}
		expect(render().options).toEqual([])
	})

	it('finds a managed URL field nested in an object', () => {
		contextual()
		context = {
			...context!,
			registry: createPagesRegistry({
				pages: [
					{ schemaType: 'page', pathnameField: 'routing.pathname.current' },
				],
			}),
		}
		native.types.get('page')!.fields = [
			{
				name: 'routing',
				type: {
					fields: [
						{
							name: 'pathname',
							type: { name: 'slug', options: { __sanityKitUrlField: true } },
						},
					],
				},
			},
		]
		const value = resolveContext({
			_type: 'page',
			routing: { pathname: { current: '' } },
		})
		expect(value.options[0]?.granted).toBe(true)
	})
	it('rejects a malformed intermediate URL field without overwriting template content', () => {
		contextual()
		expect(
			resolveContext({ _type: 'page', pathname: 'invalid object' }).options[0]
				?.granted,
		).toBe(false)
	})

	it('does not send malformed folder hints to native template resolution', () => {
		contextual('page', '/about/')
		const value = render()
		expect(value.options).toEqual([])
		expect(value.configurationErrors[0]).toContain('valid folder path')
	})
})
