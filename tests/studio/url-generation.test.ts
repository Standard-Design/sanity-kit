import type { SanityDocument, SlugSchemaType, SlugSourceContext } from 'sanity'
import { describe, expect, it, vi } from 'vitest'
import {
	createUrlGeneration,
	type UrlGenerationInput,
} from '../../src/studio/url/generate.js'
import type { PagesRouteConfig } from '../../src/url/index.js'

const routes = {
	pages: [
		{ schemaType: 'page', pathnameField: 'pathname.current' },
		{ schemaType: 'landing', pathnameField: 'seo.pathname.current' },
	],
	collections: [
		{
			name: 'journal',
			title: 'Journal',
			routePrefix: '/journal',
			overview: { schemaType: 'page', pathname: '/insights' },
			items: [{ schemaType: 'post', slugField: 'slug.current' }],
		},
	],
} satisfies PagesRouteConfig
const context = {
	projectId: 'test-project',
	dataset: 'test-data',
	currentUser: null,
	schema: { name: 'fixture' } as SlugSourceContext['schema'],
	getClient: vi.fn(),
} satisfies Omit<SlugSourceContext, 'parent' | 'parentPath'>
function input(
	overrides: Partial<UrlGenerationInput> = {},
): UrlGenerationInput {
	return {
		document: {
			_id: 'drafts.page',
			_type: 'page',
			_rev: 'r1',
			_createdAt: '2026-10-31T00:00:00Z',
			_updatedAt: '2026-10-31T00:00:00Z',
			title: 'Research & Development',
		},
		schemaType: {
			name: 'slug',
			jsonType: 'object',
			options: { source: 'title' },
		} as SlugSchemaType,
		path: ['pathname'],
		prefix: '/about',
		context,
		readOnly: false,
		...overrides,
	}
}
function schema(options: SlugSchemaType['options']): SlugSchemaType {
	return { ...input().schemaType, options } as SlugSchemaType
}
function deferred() {
	let resolve!: (value: string) => void
	let reject!: (error: Error) => void
	const promise = new Promise<string>((yes, no) => {
		resolve = yes
		reject = no
	})
	return { promise, resolve, reject }
}

describe('private Studio generation bridge', () => {
	it('generates a final segment using native options and preserves the selected folder', async () => {
		const request = input()
		const before = structuredClone(request.document)
		expect(await createUrlGeneration(routes).generate(request)).toEqual({
			ok: true,
			requiresConfirmation: false,
			value: {
				fieldPath: 'pathname.current',
				storedValue: '/about/research-and-development',
				url: {
					pathname: '/about/research-and-development',
					prefix: '/about',
					slug: 'research-and-development',
				},
			},
		})
		expect(request.document).toEqual(before)
		expect(context.getClient).not.toHaveBeenCalled()
	})
	it.each([
		['title', { title: 'Hello World' }],
		['seo.title', { seo: { title: 'Hello World' } }],
		[['seo', 'title'], { seo: { title: 'Hello World' } }],
		[['names', 0, 'title'], { names: [{ title: 'Hello World' }] }],
		[
			['names', { _key: 'english' }, 'title'],
			{ names: [{ _key: 'english', title: 'Hello World' }] },
		],
	] as const)(
		'reads native source path %j from the document root',
		async (source, values) => {
			const request = input({
				document: { ...input().document, ...values },
				schemaType: schema({
					source: typeof source === 'string' ? source : [...source],
				}),
			})
			expect(await createUrlGeneration(routes).generate(request)).toMatchObject(
				{ ok: true, value: { storedValue: '/about/hello-world' } },
			)
		},
	)
	it('passes native context and schema to callbacks, with nested parent and shared context identity', async () => {
		const source = vi.fn((document: SanityDocument, ctx: SlugSourceContext) => {
			expect(document._id).toBe('drafts.page')
			return Promise.resolve(
				String((ctx.parent as Record<string, unknown>).title),
			)
		})
		const slugify = vi.fn(
			(value: string, schemaType: SlugSchemaType, ctx: SlugSourceContext) => {
				expect(schemaType.options?.maxLength).toBe(2)
				expect(ctx.projectId).toBe('test-project')
				return Promise.resolve(value.toLowerCase())
			},
		)
		const request = input({
			document: {
				...input().document,
				_type: 'landing',
				seo: { title: 'LongName' },
			},
			path: ['seo', 'pathname'],
			schemaType: schema({ source, slugify, maxLength: 2 }),
		})
		expect(await createUrlGeneration(routes).generate(request)).toMatchObject({
			ok: true,
			value: { storedValue: '/about/longname' },
		})
		const sourceContext = source.mock.calls[0]![1]
		expect(sourceContext).toEqual({
			...context,
			parentPath: ['seo'],
			parent: request.document.seo,
		})
		expect(slugify.mock.calls[0]).toEqual([
			'LongName',
			request.schemaType,
			sourceContext,
		])
		expect(slugify.mock.calls[0]![2]).toBe(sourceContext)
	})
	it('uses the document as the parent of a root field', async () => {
		const source = vi.fn((_doc: SanityDocument, ctx: SlugSourceContext) => {
			expect(ctx.parentPath).toEqual([])
			return 'Root'
		})
		const request = input({ schemaType: schema({ source }), prefix: '/' })
		expect(await createUrlGeneration(routes).generate(request)).toMatchObject({
			ok: true,
			value: { storedValue: '/root' },
		})
		expect(source.mock.calls[0]![1].parent).toBe(request.document)
	})
	it('uses native default truncation while custom generation bypasses it', async () => {
		const request = input({
			document: { ...input().document, title: 'Hello wonderful world' },
			schemaType: schema({ source: 'title', maxLength: 10 }),
		})
		expect(await createUrlGeneration(routes).generate(request)).toMatchObject({
			ok: true,
			value: { url: { slug: 'hello' } },
		})
	})
	it('stores only the generated collection slug and enforces its resolved prefix', async () => {
		const request = input({
			document: { ...input().document, _type: 'post' },
			path: ['slug'],
			prefix: '/journal',
		})
		const controller = createUrlGeneration(routes)
		expect(await controller.generate(request)).toMatchObject({
			ok: true,
			value: {
				fieldPath: 'slug.current',
				storedValue: 'research-and-development',
				url: { prefix: '/journal' },
			},
		})
		expect(await controller.generate({ ...request, prefix: '/blog' })).toEqual({
			ok: false,
			reason: 'locked-prefix',
		})
	})
	it.each([
		[undefined, false],
		[null, false],
		['', false],
		['/old', true],
		['/about/research-and-development', false],
		[42, true],
	])(
		'requires explicit confirmation before changing existing value %j',
		async (current, requiresConfirmation) => {
			expect(
				await createUrlGeneration(routes).generate(
					input({ document: { ...input().document, pathname: { current } } }),
				),
			).toMatchObject({ ok: true, requiresConfirmation })
		},
	)
	it.each([true, false])(
		'does not invoke callbacks when read-only is enforced by input=%s',
		async (evaluated) => {
			const source = vi.fn(() => 'Title')
			const request = input({
				readOnly: evaluated,
				schemaType: { ...schema({ source }), readOnly: !evaluated },
			})
			expect(await createUrlGeneration(routes).generate(request)).toEqual({
				ok: false,
				reason: 'read-only',
			})
			expect(source).not.toHaveBeenCalled()
		},
	)
	it('does not generate just because the title changes', () => {
		const source = vi.fn(() => 'Title')
		const request = input({ schemaType: schema({ source }) })
		createUrlGeneration(routes)
		request.document.title = 'Changed'
		expect(source).not.toHaveBeenCalled()
	})
	it.each([
		[{ path: ['other'] }, 'invalid-field'],
		[{ path: ['pathname', 'current'] }, 'invalid-field'],
		[{ path: ['items', { _key: 'a' }, 'pathname'] }, 'invalid-field'],
		[
			{ document: { ...input().document, _type: 'other' } },
			'unregistered-type',
		],
		[
			{
				document: { ...input().document, _type: 'landing' },
				path: ['seo', 'pathname'],
			},
			'invalid-context',
		],
	] as const)('refuses wrong field context %j', async (override, reason) => {
		expect(
			await createUrlGeneration(routes).generate(
				input(override as Partial<UrlGenerationInput>),
			),
		).toEqual({ ok: false, reason })
	})
	it.each([
		[undefined, 'missing-source'],
		['', 'missing-source'],
		[[], 'invalid-source-path'],
		['missing', 'missing-source'],
		['constructor.name', 'invalid-source-path'],
		['names[0].title', 'invalid-source-path'],
		[['names', -1], 'invalid-source-path'],
		[['names', [0, 1]], 'invalid-source-path'],
	])(
		'handles missing or unsupported source path %j',
		async (source, reason) => {
			expect(
				await createUrlGeneration(routes).generate(
					input({
						schemaType: schema({ source } as SlugSchemaType['options']),
					}),
				),
			).toEqual({ ok: false, reason })
		},
	)
	it.each([
		[undefined, 'missing-source'],
		[42, 'invalid-source'],
		['', 'missing-source'],
	])('does not coerce source value %j', async (title, reason) => {
		expect(
			await createUrlGeneration(routes).generate(
				input({ document: { ...input().document, title } }),
			),
		).toEqual({ ok: false, reason })
	})
	it('requires arrays for numeric source segments rather than indexing an object', async () => {
		expect(
			await createUrlGeneration(routes).generate(
				input({
					document: {
						...input().document,
						names: { 0: { title: 'Not an array' } },
					},
					schemaType: schema({ source: ['names', 0, 'title'] }),
				}),
			),
		).toEqual({ ok: false, reason: 'missing-source' })
	})
	it.each(['source', 'slugify'] as const)(
		'reports %s callback rejection distinctly',
		async (kind) => {
			const callback = () => Promise.reject(new Error('Do not expose details'))
			expect(
				await createUrlGeneration(routes).generate(
					input({ schemaType: schema({ source: 'title', [kind]: callback }) }),
				),
			).toEqual({
				ok: false,
				reason: kind === 'source' ? 'source-failed' : 'generation-failed',
			})
		},
	)
	it.each(['nested/slug', 'bad%2Fslug', '', '//host'])(
		'refuses unsafe generated slug %j',
		async (slug) => {
			expect(
				await createUrlGeneration(routes).generate(
					input({
						schemaType: schema({ source: 'title', slugify: () => slug }),
					}),
				),
			).toEqual({ ok: false, reason: 'invalid-slug' })
		},
	)
	it('supersedes an older async source when a newer request finishes first', async () => {
		const slow = deferred()
		const slugify = vi.fn((text: string) => text)
		const controller = createUrlGeneration(routes)
		const first = controller.generate(
			input({ schemaType: schema({ source: () => slow.promise, slugify }) }),
		)
		expect(await controller.generate(input())).toMatchObject({ ok: true })
		slow.resolve('stale')
		expect(await first).toEqual({ ok: false, reason: 'superseded' })
		expect(slugify).not.toHaveBeenCalled()
	})
	it('invalidates pending slugify when the input reports a context change', async () => {
		const slow = deferred()
		const controller = createUrlGeneration(routes)
		const pending = controller.generate(
			input({
				schemaType: schema({ source: 'title', slugify: () => slow.promise }),
			}),
		)
		controller.invalidate()
		slow.resolve('stale')
		expect(await pending).toEqual({ ok: false, reason: 'superseded' })
	})
	it('discards stale callback failures too', async () => {
		const slow = deferred()
		const controller = createUrlGeneration(routes)
		const pending = controller.generate(
			input({ schemaType: schema({ source: () => slow.promise }) }),
		)
		controller.invalidate()
		slow.reject(new Error('Old source failed'))
		expect(await pending).toEqual({ ok: false, reason: 'superseded' })
	})
	it('honors cancellation before starting and after an async callback settles', async () => {
		const abort = new AbortController()
		const slow = deferred()
		const source = vi.fn(() => slow.promise)
		const controller = createUrlGeneration(routes)
		const request = input({
			signal: abort.signal,
			schemaType: schema({ source }),
		})
		const pending = controller.generate(request)
		abort.abort()
		slow.resolve('stale')
		expect(await pending).toEqual({ ok: false, reason: 'aborted' })
		expect(await controller.generate(request)).toEqual({
			ok: false,
			reason: 'aborted',
		})
		expect(source).toHaveBeenCalledTimes(1)
	})
	it('does not share cancellation epochs across mounted fields', async () => {
		const slow = deferred()
		const first = createUrlGeneration(routes)
		const second = createUrlGeneration(routes)
		const pending = first.generate(
			input({ schemaType: schema({ source: () => slow.promise }) }),
		)
		second.invalidate()
		slow.resolve('valid')
		expect(await pending).toMatchObject({ ok: true })
	})
})
