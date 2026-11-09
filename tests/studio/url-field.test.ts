import { createClient } from '@sanity/client'
import { evaluate, parse } from 'groq-js'
import {
	createSchema,
	defineType,
	validateDocument,
	type LocaleSource,
	type SanityDocument,
	type ValidationContext,
} from 'sanity'
import { describe, expect, it, vi } from 'vitest'
import {
	defineSanityUrlField,
	type SanityUrlFieldDefinition,
} from '../../src/studio/url/field.js'
import type { PagesRouteConfig } from '../../src/url/index.js'

// This suite exercises the native schema/validation boundary, not input hooks.
vi.mock('../../src/studio/url/input.js', () => ({ SanityUrlInput: () => null }))

const routes: PagesRouteConfig = {
	pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
	collections: [
		{
			name: 'journal',
			title: 'Journal',
			routePrefix: '/journal',
			index: { schemaType: 'page', pathname: '/journal' },
			items: [{ schemaType: 'post', slugField: 'slug.current' }],
		},
	],
	excludePaths: ['/reserved'],
}
function document(
	type: string,
	field: string,
	current?: unknown,
): SanityDocument {
	return {
		_id: 'drafts.current',
		_type: type,
		_rev: 'r1',
		_createdAt: '2026-10-31T00:00:00Z',
		_updatedAt: '2026-10-31T00:00:00Z',
		...(current === undefined ? {} : { [field]: { _type: 'slug', current } }),
	}
}
function fixture(
	options: Partial<SanityUrlFieldDefinition> = {},
	records: object[] = [],
) {
	const field = defineSanityUrlField({ name: 'pathname', routes, ...options })
	const schema = createSchema({
		name: 'url-field-test',
		types: [
			defineType({ name: 'page', type: 'document', fields: [field] }),
			defineType({
				name: 'post',
				type: 'document',
				fields: [
					defineSanityUrlField({
						name: 'slug',
						routes: options.routes ?? routes,
						...(options.collectionRouting
							? { collectionRouting: options.collectionRouting }
							: {}),
					}),
				],
			}),
		],
	})
	const client = createClient({
		projectId: 'fixture',
		dataset: 'test',
		apiVersion: '2026-10-01',
		useCdn: false,
	})
	const fetch = vi.fn(
		async (query: string, params: Record<string, unknown>) =>
			(
				await evaluate(parse(query), { dataset: records, params })
			).get() as Promise<unknown>,
	)
	vi.spyOn(client, 'withConfig').mockReturnValue(client)
	vi.spyOn(client, 'request').mockResolvedValue([
		{ filter: 'true', permissions: ['read'] },
	])
	vi.spyOn(client, 'fetch').mockImplementation(fetch as typeof client.fetch)
	return {
		field,
		fetch,
		validate: (value: SanityDocument) =>
			validateDocument({
				document: value,
				workspace: {
					schema,
					getClient: () =>
						client as unknown as ReturnType<ValidationContext['getClient']>,
					i18n: {
						t: (key: string) => key,
						loadNamespaces: () => Promise.resolve(),
					} as unknown as LocaleSource,
				},
				environment: 'studio',
			}),
	}
}

describe('native URL field definition', () => {
	it('keeps native slug storage and format validation with the text input option', async () => {
		const { field, validate } = fixture({ inputMode: 'text' })
		expect(field.type).toBe('slug')
		expect(
			await validate(document('page', 'pathname', '/company/team')),
		).toEqual([])
		expect(
			await validate(document('page', 'pathname', '/company//team/')),
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					message: 'Remove repeated or trailing slashes from this URL.',
				}),
			]),
		)
	})
	it('marks the compiled field as able to consume guarded creation hints', () => {
		const { field } = fixture()
		const schema = createSchema({
			name: 'creation-marker',
			types: [defineType({ name: 'page', type: 'document', fields: [field] })],
		})
		const page = schema.get('page')
		expect(
			page && 'fields' in page ? page.fields[0]?.type.options : undefined,
		).toMatchObject({ __sanityKitUrlField: true })
	})
	it('accepts full page paths, the homepage, and collection slugs through native validation', async () => {
		const { validate } = fixture()
		for (const value of [
			document('page', 'pathname', '/'),
			document('page', 'pathname', '/company/team'),
			document('post', 'slug', 'story'),
		])
			expect(await validate(value)).toEqual([])
	})

	it('preserves prefix reservations through the native field configuration snapshot', async () => {
		const { validate } = fixture({
			routes: { ...routes, reservedPathPrefixes: ['/account'] },
		})
		for (const path of ['/account', '/account/settings'])
			expect(await validate(document('page', 'pathname', path))).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						message:
							'This URL is outside the paths allowed for this document type.',
					}),
				]),
			)
		expect(await validate(document('page', 'pathname', '/accounting'))).toEqual(
			[],
		)
	})
	it('leaves an absent value optional and composes an app-required rule', async () => {
		expect(await fixture().validate(document('page', 'pathname'))).toEqual([])
		const required = fixture({ validation: (rule) => rule.required() })
		expect(await required.validate(document('page', 'pathname'))).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: 'value.required' }),
			]),
		)
	})
	it('does not let app validation suppress format checks or clean stored paths', async () => {
		const { validate } = fixture({
			validation: (rule) => rule.custom(() => true),
		})
		const value = document('page', 'pathname', '/about//team/')
		expect(await validate(value)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					message: 'Remove repeated or trailing slashes from this URL.',
				}),
			]),
		)
		expect(value.pathname).toEqual({ _type: 'slug', current: '/about//team/' })
		expect(await validate(document('page', 'pathname', '/reserved'))).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					message:
						'This URL is outside the paths allowed for this document type.',
				}),
			]),
		)
	})
	it('rejects collection slugs with nested segments and malformed stored values', async () => {
		const { validate } = fixture()
		expect(await validate(document('post', 'slug', 'nested/story'))).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					message: 'Enter one valid URL segment without slashes.',
				}),
			]),
		)
		expect(await validate(document('page', 'pathname', 17))).not.toEqual([])
	})
	it('uses native uniqueness validation across collection and page storage forms', async () => {
		const { validate, fetch } = fixture({}, [
			{
				_id: 'other',
				_type: 'post',
				_rev: 'other-r',
				slug: { current: 'story' },
			},
		])
		const failures = await validate(
			document('page', 'pathname', '/journal/story'),
		)
		expect(failures).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: 'slug.not-unique' }),
			]),
		)
		expect(fetch).toHaveBeenCalled()
	})
	it('refuses mounting the field at an unrelated slug-object path', async () => {
		const { validate } = fixture({ name: 'other' })
		expect(await validate(document('page', 'other', '/about'))).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					message:
						'Use the URL field at the slug-object path registered for this document type.',
				}),
			]),
		)
	})
	it('preserves native read-only, source callbacks, and generation options', () => {
		const readOnly = vi.fn(() => true)
		const source = vi.fn(() => 'Current title')
		const slugify = vi.fn(() => 'custom-slug')
		const { field } = fixture({
			readOnly,
			options: { source, slugify, maxLength: 48 },
		})
		expect(field.readOnly).toBe(readOnly)
		expect(field.options).toMatchObject({ source, slugify, maxLength: 48 })
		expect(source).not.toHaveBeenCalled()
		expect(slugify).not.toHaveBeenCalled()
	})
	it('takes an isolated route snapshot for validation', async () => {
		const mutable = {
			pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
		}
		const { validate } = fixture({ routes: mutable })
		mutable.pages[0]!.pathnameField = 'other.current'
		expect(await validate(document('page', 'pathname', '/about'))).toEqual([])
	})
})

describe('settings-aware native URL field validation', () => {
	const collectionRouting = {
		pages: routes.pages,
		excludePaths: routes.excludePaths ?? [],
		collections: [
			{
				name: 'journal',
				title: 'Journal',
				settingsDocumentId: 'journal-settings',
				index: { schemaType: 'page', pathname: '/journal' },
				items: [{ schemaType: 'post', slugField: 'slug.current' }],
			},
		],
	}
	const settings = [
		{
			_id: 'journal-settings',
			_rev: 's1',
			_type: 'sanityKitCollectionRoute',
			collection: 'journal',
			prefix: { _type: 'slug', current: '/journal' },
		},
		{
			_id: 'drafts.journal-settings',
			_rev: 's2',
			_type: 'sanityKitCollectionRoute',
			collection: 'journal',
			prefix: { _type: 'slug', current: '/blog' },
		},
	]
	it('validates the same native slug object against live and preview collection URLs', async () => {
		const { validate } = fixture({ collectionRouting }, [
			...settings,
			{ _id: 'post-1', _type: 'post', _rev: 'p1', slug: { current: 'taken' } },
		])
		for (const pathname of ['/journal/taken', '/blog/taken'])
			expect(await validate(document('page', 'pathname', pathname))).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ code: 'slug.not-unique' }),
				]),
			)
		expect(await validate(document('page', 'pathname', '/available'))).toEqual(
			[],
		)
	})
	it('keeps collection slug storage while checking a live-only page collision', async () => {
		const { validate } = fixture({ collectionRouting }, [
			...settings,
			{
				_id: 'page-1',
				_type: 'page',
				_rev: 'p1',
				pathname: { current: '/journal/taken' },
			},
		])
		expect(await validate(document('post', 'slug', 'taken'))).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: 'slug.not-unique' }),
			]),
		)
		expect(await validate(document('post', 'slug', 'available'))).toEqual([])
	})
	it('does not validate a current collection slug against the obsolete configured prefix', async () => {
		const moved = settings.map((row) => ({
			...row,
			prefix: { _type: 'slug', current: '/blog' },
		}))
		const reservations = ['/journal/example']
		const dynamic = { ...collectionRouting, excludePaths: reservations }
		const configured = { ...routes, excludePaths: reservations }
		const field = defineSanityUrlField({
			name: 'slug',
			routes: configured,
			collectionRouting: dynamic,
		})
		const rule = { custom: vi.fn((callback: unknown) => callback) }
		const check = field.validation(rule as never, {} as never) as unknown as (
			value: unknown,
			context: unknown,
		) => unknown
		expect(
			check(
				{ _type: 'slug', current: 'example' },
				{ document: { _type: 'post' }, path: ['slug'] },
			),
		).toBe(true)
		const { validate } = fixture(
			{ routes: configured, collectionRouting: dynamic },
			moved,
		)
		expect(await validate(document('post', 'slug', 'example'))).toEqual([])
	})
	it('rejects mismatched registration instead of validating one field and editing another', () => {
		expect(() =>
			fixture({
				collectionRouting: {
					...collectionRouting,
					pages: [{ schemaType: 'page', pathnameField: 'other.current' }],
				},
			}),
		).toThrow('same document types')
	})
	it('does not allow missing settings to silently validate against configured defaults', async () => {
		const { validate } = fixture({ collectionRouting })
		expect(
			await validate(document('page', 'pathname', '/available')),
		).not.toEqual([])
	})
})
