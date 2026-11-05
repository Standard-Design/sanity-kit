import { describe, expect, it } from 'vitest'
import {
	createPagesRuntime,
	type PagesToolOptions,
} from '../../src/studio/pages/runtime.js'

const options: PagesToolOptions = {
	pages: [
		{ schemaType: 'page', pathnameField: 'pathname' },
		{ schemaType: 'landing', pathnameField: 'pathname' },
	],
	previewUrl: 'http://localhost:3334',
}

describe('Pages creation registration', () => {
	it('keeps the existing one-template configuration as a single choice', () => {
		const runtime = createPagesRuntime({
			...options,
			create: { schemaType: 'page', templateId: 'page' },
		})
		expect(runtime.createChoices).toEqual([
			{ schemaType: 'page', templateId: 'page' },
		])
	})

	it('copies ordered choices so later configuration edits cannot change the tool', () => {
		const choices = [
			{ schemaType: 'landing', templateId: 'campaign', title: 'Campaign page' },
			{ schemaType: 'page', templateId: 'page' },
		]
		const runtime = createPagesRuntime({ ...options, create: choices })
		choices[0]!.title = 'Changed'
		choices.reverse()
		choices.push({ schemaType: 'page', templateId: 'special' })
		expect(runtime.createChoices).toEqual([
			{ schemaType: 'landing', templateId: 'campaign', title: 'Campaign page' },
			{ schemaType: 'page', templateId: 'page' },
		])
		expect(Object.isFrozen(runtime.createChoices)).toBe(true)
		expect(runtime.createChoices.every(Object.isFrozen)).toBe(true)
	})

	it('allows different templates for one schema type without picking a default', () => {
		const runtime = createPagesRuntime({
			...options,
			create: [
				{ schemaType: 'page', templateId: 'page' },
				{ schemaType: 'page', templateId: 'campaign' },
			],
		})
		expect(runtime.createChoices.map((choice) => choice.templateId)).toEqual([
			'page',
			'campaign',
		])
		expect(runtime).not.toHaveProperty('create')
	})

	it.each([undefined, []])(
		'supports no creation controls with %j',
		(create) => {
			const runtime = createPagesRuntime({
				...options,
				...(create === undefined ? {} : { create }),
			})
			expect(runtime.createChoices).toEqual([])
		},
	)

	it.each([
		[null, 'registered schemaType'],
		['page', 'registered schemaType'],
		[[null], 'registered schemaType'],
		[[[]], 'registered schemaType'],
		[[{ schemaType: 'missing', templateId: 'page' }], 'registered schemaType'],
		[[{ schemaType: 'page', templateId: ' ' }], 'templateId'],
		[[{ schemaType: 'page', templateId: 'page', title: ' ' }], 'title'],
		[[{ schemaType: 'page', templateId: 'page', title: 1 }], 'title'],
		[
			[
				{ schemaType: 'page', templateId: 'page' },
				{ schemaType: 'page', templateId: 'page', title: 'Different title' },
			],
			'must not repeat',
		],
		[
			[
				{
					schemaType: 'page',
					templateId: 'page',
					parameters: { prefix: '/about' },
				},
			],
			'only support',
		],
		[
			[{ schemaType: 'page', templateId: 'page', documentId: 'fixed-id' }],
			'only support',
		],
	])(
		'rejects invalid or silently ignored creation configuration %#',
		(create, message) => {
			expect(() =>
				createPagesRuntime({ ...options, create } as PagesToolOptions),
			).toThrow(message)
		},
	)
})
