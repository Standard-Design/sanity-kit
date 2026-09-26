import { describe, expect, it } from 'vitest'
import { defineSanityConfig } from '../src/core/index.js'
import { createSanityImageTools } from '../src/image/index.js'
import { createSanityKit } from '../src/react-router/server/index.js'

const publicConfig = {
	projectId: 'project123',
	dataset: 'production',
	apiVersion: '2026-09-19',
	studioUrl: 'https://studio.example.com',
}
const serverConfig = {
	...publicConfig,
	readToken: 'private-read-token',
	sessionSecret: 'private-session-secret-with-at-least-32-characters',
}
// Cast only at the test boundary to model untyped JavaScript and missing env values.
const factories = [
	{
		name: 'defineSanityConfig',
		create: (config: Record<string, unknown>) =>
			defineSanityConfig(config as unknown as typeof publicConfig),
		valid: publicConfig,
		required: ['projectId', 'dataset', 'apiVersion'],
		optional: ['studioUrl'],
	},
	{
		name: 'createSanityKit',
		create: (config: Record<string, unknown>) =>
			createSanityKit(config as unknown as typeof serverConfig),
		valid: serverConfig,
		required: [
			'projectId',
			'dataset',
			'apiVersion',
			'studioUrl',
			'readToken',
			'sessionSecret',
		],
		optional: [],
	},
	{
		name: 'createSanityImageTools',
		create: (config: Record<string, unknown>) =>
			createSanityImageTools(config as unknown as typeof publicConfig),
		valid: { projectId: publicConfig.projectId, dataset: publicConfig.dataset },
		required: ['projectId', 'dataset'],
		optional: [],
	},
]
const nonStrings: { name: string; value: unknown }[] = [
	{ name: 'null', value: null },
	{ name: 'number', value: 12345 },
	{ name: 'boolean', value: false },
	{ name: 'array', value: ['private-supplied-value'] },
	{ name: 'object', value: { secret: 'private-supplied-value' } },
	{ name: 'symbol', value: Symbol('private-supplied-value') },
	{
		name: 'string-like object',
		value: {
			trim: () => {
				throw new Error('Value must not be trimmed')
			},
			toString: () => {
				throw new Error('Value must not be coerced')
			},
		},
	},
]

describe.each(factories)(
	'$name runtime configuration',
	({ create, valid, required, optional }) => {
		it('accepts valid configuration without mutating it', () => {
			const input = { ...valid }
			expect(() => create(input)).not.toThrow()
			expect(input).toEqual(valid)
		})

		it.each(required)('rejects missing or undefined %s', (field) => {
			const config: Record<string, unknown> = { ...valid }
			delete config[field]
			const error = new TypeError(`[sanity-kit] \`${field}\` must be a string.`)
			expect(() => create(config)).toThrow(error)
			expect(() => create({ ...valid, [field]: undefined })).toThrow(error)
		})

		it.each(optional)('allows omitted or undefined optional %s', (field) => {
			const config: Record<string, unknown> = { ...valid }
			delete config[field]
			expect(() => create(config)).not.toThrow()
			expect(() => create({ ...valid, [field]: undefined })).not.toThrow()
		})

		describe.each([...required, ...optional])('%s', (field) => {
			it.each(nonStrings)(
				'rejects $name without exposing or coercing its value',
				({ value }) => {
					expect(() => create({ ...valid, [field]: value })).toThrow(
						new TypeError(`[sanity-kit] \`${field}\` must be a string.`),
					)
				},
			)
			it.each(['', ' ', '\t\n', ' '.repeat(32)])(
				'rejects blank string %j',
				(value) => {
					expect(() => create({ ...valid, [field]: value })).toThrow(
						new TypeError(`[sanity-kit] \`${field}\` must not be empty.`),
					)
				},
			)
		})
	},
)

describe('sessionSecret length', () => {
	it.each(['private-short-secret', 's'.repeat(31), ` ${'s'.repeat(31)} `])(
		'rejects short secret %j without exposing its value',
		(sessionSecret) => {
			expect(() => createSanityKit({ ...serverConfig, sessionSecret })).toThrow(
				new TypeError(
					'[sanity-kit] `sessionSecret` must contain at least 32 characters.',
				),
			)
		},
	)
	it('accepts exactly 32 non-whitespace characters', () => {
		expect(() =>
			createSanityKit({ ...serverConfig, sessionSecret: 's'.repeat(32) }),
		).not.toThrow()
	})
})
