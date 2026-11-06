import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'
import {
	COLLECTION_ROUTE_TYPE,
	MAX_COLLECTION_PREFIX_LENGTH,
	MAX_SETTINGS_DOCUMENTS,
	createCollectionRouting,
	type CollectionRoutingConfig,
	type CollectionRoutingResult,
	type RoutingPerspective,
} from '../../src/url/settings/resolve.js'

const config = {
	pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
	collections: [
		{
			name: 'journal',
			title: 'Journal',
			itemsTitle: 'Posts',
			settingsDocumentId: 'journal-routing',
			index: { schemaType: 'page', pathname: '/insights' },
			items: [{ schemaType: 'post', slugField: 'slug.current' }],
		},
		{
			name: 'news',
			title: 'News',
			routePrefix: '/news',
			index: { schemaType: 'page', pathname: '/latest' },
			items: [{ schemaType: 'newsItem', slugField: 'slug.current' }],
		},
	],
	excludePaths: ['/reserved'],
} satisfies CollectionRoutingConfig

function settings(prefix = '/journal', id = 'journal-routing') {
	return {
		_id: id,
		_rev: 'revision-1',
		_type: COLLECTION_ROUTE_TYPE,
		collection: 'journal',
		prefix: { _type: 'slug', current: prefix },
	}
}
const snapshot = (documents: unknown[]) => ({
	status: 'available',
	perspective: 'raw',
	coverage: 'published-and-drafts',
	complete: true,
	documents,
})
function success(result: CollectionRoutingResult) {
	if (!result.ok) throw new Error(`Expected success, received ${result.reason}`)
	return result.value
}

describe('private collection routing settings', () => {
	it('supports an editable name and omitted prefix using one collection-level binding', () => {
		const routing = createCollectionRouting({
			pages: config.pages,
			collections: [
				{
					name: 'journal',
					settingsDocumentId: 'journal-routing',
					displayName: { mode: 'default', value: 'Articles' },
					index: config.collections[0]!.index,
					items: config.collections[0]!.items,
				},
			],
		})
		expect(routing.documentIds).toEqual(['journal-routing'])
		expect(routing.resolve(snapshot([]), 'published')).toMatchObject({
			ok: false,
			reason: 'settings-missing',
		})
		const resolved = success(
			routing.resolve(snapshot([settings('/blog')]), 'published'),
		)
		expect(resolved.routes.collections?.[0]).toMatchObject({
			title: 'Articles',
			routePrefix: '/blog',
		})
	})

	it('allows both locked fields without a settings document or redundant title', () => {
		const routing = createCollectionRouting({
			pages: config.pages,
			collections: [
				{
					name: 'journal',
					displayName: { mode: 'locked', value: 'Articles' },
					routePrefix: { mode: 'locked', value: '/articles' },
					index: config.collections[0]!.index,
					items: config.collections[0]!.items,
				},
			],
		})
		expect(routing.documentIds).toEqual([])
		expect(
			success(routing.resolve(undefined, 'published')).routes.collections?.[0],
		).toMatchObject({ title: 'Articles', routePrefix: '/articles' })
	})

	it('uses title then stable name when no display-name policy is supplied', () => {
		const collection = {
			name: 'journal',
			routePrefix: '/journal',
			index: config.collections[0]!.index,
			items: config.collections[0]!.items,
		}
		for (const [definition, title] of [
			[collection, 'journal'],
			[{ ...collection, title: 'Journal' }, 'Journal'],
		] as const) {
			const routing = createCollectionRouting({
				pages: config.pages,
				collections: [definition],
			})
			expect(
				success(routing.resolve(undefined, 'published')).routes.collections?.[0]
					?.title,
			).toBe(title)
		}
	})

	it.each([
		{},
		{ routePrefix: { mode: 'default', value: '/journal' } },
		{
			routePrefix: '/journal',
			displayName: { mode: 'default', value: 'Articles' },
		},
		{
			routePrefix: { mode: 'locked', value: '/journal' },
			displayName: { mode: 'default', value: 'Articles' },
		},
	])(
		'requires a settings ID when configuration requests editable fields: %j',
		(fields) => {
			expect(() =>
				createCollectionRouting({
					pages: config.pages,
					collections: [
						{
							name: 'journal',
							index: config.collections[0]!.index,
							items: config.collections[0]!.items,
							...fields,
						},
					],
				} as CollectionRoutingConfig),
			).toThrow('require settingsDocumentId')
		},
	)

	it.each([
		{ documentId: 'journal-routing' },
		{ documentId: 'journal-routing', mode: 'default', value: '/journal' },
		{ documentId: 'journal-routing', mode: 'locked', value: '/journal' },
	])('rejects the superseded nested settings identity: %j', (routePrefix) => {
		expect(() =>
			createCollectionRouting({
				pages: config.pages,
				collections: [
					{
						...config.collections[0]!,
						routePrefix,
					},
				],
			} as CollectionRoutingConfig),
		).toThrow('prefixes need')
	})

	it('keeps explicit locked settings independent of stored values and read availability', () => {
		const routing = createCollectionRouting({
			...config,
			collections: [
				{
					...config.collections[0]!,
					displayName: { mode: 'locked', value: 'Articles' },
					settingsDocumentId: 'journal-routing',
					routePrefix: {
						mode: 'locked',
						value: '/articles',
					},
				},
			],
		})
		expect(routing.documentIds).toEqual([])
		for (const perspective of ['published', 'drafts'] as const) {
			for (const input of [
				undefined,
				{ status: 'unavailable' },
				snapshot([
					{ ...settings('/changed'), displayName: 'Changed' },
					{
						...settings('/', 'drafts.journal-routing'),
						displayName: 'Draft name',
					},
				]),
			]) {
				const result = success(routing.resolve(input, perspective))
				expect(result.routes.collections?.[0]).toMatchObject({
					title: 'Articles',
					routePrefix: '/articles',
				})
				expect(
					result.resolveUrl({ _type: 'post', slug: { current: 'story' } }),
				).toMatchObject({ ok: true, value: { pathname: '/articles/story' } })
				expect(result.settings).toEqual([])
			}
		}
	})

	it('uses configured defaults only to seed Studio, never as missing or invalid routing data', () => {
		const routing = createCollectionRouting({
			...config,
			collections: [
				{
					...config.collections[0]!,
					displayName: { mode: 'default', value: 'Articles' },
					settingsDocumentId: 'journal-routing',
					routePrefix: {
						mode: 'default',
						value: '/initial',
					},
				},
			],
		})
		expect(routing.documentIds).toEqual(['journal-routing'])
		expect(routing.resolve(undefined, 'published')).toMatchObject({
			ok: false,
			reason: 'settings-unavailable',
		})
		expect(routing.resolve(snapshot([]), 'published')).toMatchObject({
			ok: false,
			reason: 'settings-missing',
		})
		expect(
			routing.resolve(
				snapshot([settings('/', 'journal-routing')]),
				'published',
			),
		).toMatchObject({ ok: false, reason: 'settings-invalid' })
		expect(
			routing.resolve(
				snapshot([settings('/draft', 'drafts.journal-routing')]),
				'published',
			),
		).toMatchObject({ ok: false, reason: 'settings-missing' })
		const result = success(
			routing.resolve(
				snapshot([
					{ ...settings('/saved'), displayName: 'Stored Studio label' },
					settings('/preview', 'drafts.journal-routing'),
				]),
				'published',
			),
		)
		expect(result.routes.collections?.[0]).toMatchObject({
			title: 'Articles',
			routePrefix: '/saved',
		})
		expect(
			success(
				routing.resolve(
					snapshot([settings('/preview', 'drafts.journal-routing')]),
					'drafts',
				),
			).routes.collections?.[0]?.routePrefix,
		).toBe('/preview')
	})

	it.each(['default', 'locked'] as const)(
		'allows %s names independently of locked or editable prefixes',
		(mode) => {
			for (const prefixMode of ['default', 'locked'] as const) {
				const routing = createCollectionRouting({
					...config,
					collections: [
						{
							...config.collections[0]!,
							displayName: { mode, value: 'Articles' },
							settingsDocumentId: 'journal-routing',
							routePrefix: {
								mode: prefixMode,
								value: '/articles',
							},
						},
					],
				})
				const result = success(
					routing.resolve(snapshot([settings('/saved')]), 'published'),
				)
				expect(result.routes.collections?.[0]?.title).toBe('Articles')
				expect(result.routes.collections?.[0]?.routePrefix).toBe(
					prefixMode === 'locked' ? '/articles' : '/saved',
				)
			}
		},
	)

	it.each([
		{ mode: 'default', value: '' },
		{ mode: 'locked', value: '  ' },
		{ mode: 'locked', value: 'x'.repeat(101) },
		{ mode: 'editable', value: 'Articles' },
		{ mode: 'default' },
		{ value: 'Articles' },
		'Articles',
		null,
	])('rejects invalid display-name policy %j', (displayName) => {
		expect(() =>
			createCollectionRouting({
				...config,
				collections: [{ ...config.collections[0]!, displayName }],
			} as CollectionRoutingConfig),
		).toThrow('display names need')
	})

	it.each([
		{ mode: 'default', value: '/' },
		{ mode: 'locked', value: '/bad//path' },
		{ mode: 'default', value: '/bad/' },
		{ mode: 'editable', value: '/articles' },
		{ mode: 'default' },
		{ value: '/articles' },
		{ mode: undefined, value: undefined },
	])('rejects invalid prefix policy %j', (policy) => {
		expect(() =>
			createCollectionRouting({
				...config,
				collections: [
					{
						...config.collections[0]!,
						settingsDocumentId: 'journal-routing',
						routePrefix: policy,
					},
				],
			} as CollectionRoutingConfig),
		).toThrow('prefixes need')
	})

	it('validates identities and slug-only items even when a binding is locked', () => {
		const locked = {
			...config.collections[0]!,
			settingsDocumentId: 'journal-routing',
			routePrefix: {
				mode: 'locked' as const,
				value: '/articles',
			},
		}
		expect(() =>
			createCollectionRouting({
				...config,
				collections: [
					locked,
					{
						...config.collections[1]!,
						settingsDocumentId: 'journal-routing',
					},
				],
			}),
		).toThrow('own settings document')
		expect(() =>
			createCollectionRouting({
				...config,
				collections: [
					{
						...locked,
						settingsDocumentId: 'drafts.journal-routing',
					},
				],
			}),
		).toThrow('non-dotted published document ID')
		expect(() =>
			createCollectionRouting({
				...config,
				collections: [
					{
						...locked,
						items: [{ schemaType: 'post', pathnameField: 'pathname.current' }],
					},
				],
			}),
		).toThrow('slug-only')
	})

	it('checks overlap between explicit locks, string prefixes, and resolved defaults', () => {
		const locked = {
			...config.collections[0]!,
			settingsDocumentId: 'journal-routing',
			routePrefix: {
				mode: 'locked' as const,
				value: '/news',
			},
		}
		expect(() =>
			createCollectionRouting({
				...config,
				collections: [locked, config.collections[1]!],
			}),
		).toThrow('overlapping routePrefix')
		const routing = createCollectionRouting({
			...config,
			collections: [
				{
					...config.collections[0]!,
					settingsDocumentId: 'journal-routing',
					routePrefix: {
						mode: 'default',
						value: '/initial',
					},
				},
				{
					...config.collections[1]!,
					settingsDocumentId: 'news-routing',
					routePrefix: {
						mode: 'locked',
						value: '/news',
					},
				},
			],
		})
		expect(routing.documentIds).toEqual(['journal-routing'])
		expect(
			routing.resolve(snapshot([settings('/news/nested')]), 'published'),
		).toEqual({ ok: false, reason: 'routing-conflict' })
	})

	it('snapshots explicit policy values before callers mutate them', () => {
		const displayName = { mode: 'locked' as const, value: 'Articles' }
		const routePrefix = {
			mode: 'locked' as const,
			value: '/articles',
		}
		const routing = createCollectionRouting({
			...config,
			collections: [{ ...config.collections[0]!, displayName, routePrefix }],
		})
		displayName.value = 'Changed'
		routePrefix.value = '/changed'
		expect(
			success(routing.resolve(undefined, 'published')).routes.collections?.[0],
		).toMatchObject({ title: 'Articles', routePrefix: '/articles' })
	})

	it('accepts a public published snapshot but requires confirmed draft coverage for preview', () => {
		const routing = createCollectionRouting(config)
		const publicSnapshot = { ...snapshot([settings()]), coverage: 'published' }
		expect(routing.resolve(publicSnapshot, 'published').ok).toBe(true)
		expect(routing.resolve(publicSnapshot, 'drafts')).toEqual({
			ok: false,
			reason: 'settings-unavailable',
		})
		for (const coverage of [undefined, 'drafts', true, {}]) {
			expect(
				routing.resolve({ ...publicSnapshot, coverage }, 'published'),
			).toEqual({
				ok: false,
				reason: 'settings-unavailable',
			})
		}
	})

	it('bounds stored and fixed prefixes without shortening them', () => {
		const routing = createCollectionRouting(config)
		const limit = `/${'a'.repeat(MAX_COLLECTION_PREFIX_LENGTH - 1)}`
		expect(routing.resolve(snapshot([settings(limit)]), 'published').ok).toBe(
			true,
		)
		expect(
			routing.resolve(snapshot([settings(`${limit}a`)]), 'published'),
		).toMatchObject({
			ok: false,
			reason: 'settings-invalid',
		})
		expect(() =>
			createCollectionRouting({
				...config,
				collections: [{ ...config.collections[0]!, routePrefix: `${limit}a` }],
			}),
		).toThrow('canonical')
	})

	it('refuses selected merged identities while ignoring malformed unselected draft content', () => {
		const routing = createCollectionRouting(config)
		expect(
			routing.resolve(
				snapshot([{ ...settings(), _originalId: 'drafts.journal-routing' }]),
				'published',
			),
		).toMatchObject({
			ok: false,
			reason: 'settings-invalid',
		})
		const input = snapshot([settings(), { _id: 'drafts.journal-routing' }])
		expect(routing.resolve(input, 'published').ok).toBe(true)
		expect(routing.resolve(input, 'drafts')).toMatchObject({
			ok: false,
			reason: 'settings-invalid',
		})
	})
	it('combines stored slugs with settings without moving index pages or fixed prefixes', () => {
		const routing = createCollectionRouting(config)
		expect(routing.documentIds).toEqual(['journal-routing'])
		const record = settings('/blog')
		const post = { _type: 'post', slug: { current: 'first-post' } }
		const before = structuredClone({ record, post, config })
		const result = success(routing.resolve(snapshot([record]), 'published'))
		expect(result.resolveUrl(post)).toEqual({
			ok: true,
			value: {
				pathname: '/blog/first-post',
				prefix: '/blog',
				slug: 'first-post',
			},
		})
		expect(
			result.resolveUrl({ _type: 'page', pathname: { current: '/insights' } }),
		).toMatchObject({ ok: true, value: { pathname: '/insights' } })
		expect(
			result.resolveUrl({ _type: 'newsItem', slug: { current: 'story' } }),
		).toMatchObject({ ok: true, value: { pathname: '/news/story' } })
		expect(result.routes.collections?.[0]?.index.pathname).toBe('/insights')
		expect(result.routes.collections?.[0]?.routePrefix).toBe('/blog')
		expect(result.settings).toEqual([
			{
				collection: 'journal',
				documentId: 'journal-routing',
				revision: 'revision-1',
				prefix: '/blog',
			},
		])
		expect({ record, post, config }).toEqual(before)
	})

	it('separates live and preview settings using exact raw identities', () => {
		const routing = createCollectionRouting(config)
		const input = snapshot([
			settings('/journal'),
			settings('/blog', 'drafts.journal-routing'),
			settings('/future', 'versions.launch.journal-routing'),
		])
		expect(
			success(routing.resolve(input, 'published')).routes.collections?.[0]
				?.routePrefix,
		).toBe('/journal')
		const preview = success(routing.resolve(input, 'drafts'))
		expect(preview.routes.collections?.[0]?.routePrefix).toBe('/blog')
		expect(preview.settings[0]?.documentId).toBe('drafts.journal-routing')
	})

	it('falls back to published only when there is no draft, not when a draft is invalid', () => {
		const routing = createCollectionRouting(config)
		expect(
			success(routing.resolve(snapshot([settings()]), 'drafts')).settings[0]
				?.documentId,
		).toBe('journal-routing')
		const broken = settings('/', 'drafts.journal-routing')
		expect(routing.resolve(snapshot([settings(), broken]), 'drafts')).toEqual({
			ok: false,
			reason: 'settings-invalid',
			collection: 'journal',
		})
		expect(
			routing.resolve(snapshot([settings(), broken]), 'published').ok,
		).toBe(true)
	})

	it('can preview a draft-only collection but cannot invent its published prefix', () => {
		const routing = createCollectionRouting(config)
		const input = snapshot([settings('/new', 'drafts.journal-routing')])
		expect(routing.resolve(input, 'published')).toEqual({
			ok: false,
			reason: 'settings-missing',
			collection: 'journal',
		})
		expect(routing.resolve(input, 'drafts').ok).toBe(true)
	})

	it('resolves independent settings for multiple collections', () => {
		const input = structuredClone(config)
		const second = {
			...input.collections[1]!,
			settingsDocumentId: 'news-routing',
			routePrefix: { mode: 'default' as const, value: '/news' },
		}
		const routing = createCollectionRouting({
			...input,
			collections: [input.collections[0]!, second],
		})
		const news = {
			...settings('/announcements', 'news-routing'),
			collection: 'news',
		}
		const result = success(
			routing.resolve(snapshot([settings('/blog'), news]), 'published'),
		)
		expect(
			result.routes.collections?.map((collection) => collection.routePrefix),
		).toEqual(['/blog', '/announcements'])
		expect(
			result.resolveUrl({ _type: 'newsItem', slug: { current: 'story' } }),
		).toMatchObject({ ok: true, value: { pathname: '/announcements/story' } })
	})

	it.each([
		'/news',
		'/news/nested',
		'/blog/../news',
		'/journal/',
		'/journal//nested',
		'/',
		'//host',
		'/path?query',
		'/path#hash',
		'/encoded%2fseparator',
		'/café',
		'journal',
		'',
	])(
		'refuses unsafe, noncanonical, or overlapping settings prefix %j',
		(prefix) => {
			const routing = createCollectionRouting(config)
			const result = routing.resolve(snapshot([settings(prefix)]), 'published')
			expect(result).toMatchObject({
				ok: false,
				reason:
					prefix === '/news' || prefix === '/news/nested'
						? 'routing-conflict'
						: 'settings-invalid',
			})
		},
	)

	it('rejects overlapping dynamic prefixes and ancestor overlaps with fixed collections', () => {
		const dynamic = {
			...config.collections[1]!,
			settingsDocumentId: 'news-routing',
			routePrefix: { mode: 'default' as const, value: '/news' },
		}
		const routing = createCollectionRouting({
			...config,
			collections: [config.collections[0]!, dynamic],
		})
		const news = {
			...settings('/blog/nested', 'news-routing'),
			collection: 'news',
		}
		expect(
			routing.resolve(snapshot([settings('/blog'), news]), 'published'),
		).toEqual({ ok: false, reason: 'routing-conflict' })
		const parent = createCollectionRouting({
			...config,
			collections: [
				config.collections[0]!,
				{ ...config.collections[1]!, routePrefix: '/company/news' },
			],
		})
		expect(
			parent.resolve(snapshot([settings('/company')]), 'published'),
		).toEqual({ ok: false, reason: 'routing-conflict' })
	})

	it.each([
		{ _type: 'other' },
		{ collection: 'news' },
		{ _rev: '' },
		{ prefix: '/blog' },
		{ prefix: { current: '/blog' } },
		{ prefix: { _type: 'string', current: '/blog' } },
		{ prefix: { _type: 'slug', current: 42 } },
	])('validates selected settings metadata and storage: %j', (overrides) => {
		expect(
			createCollectionRouting(config).resolve(
				snapshot([{ ...settings(), ...overrides }]),
				'published',
			),
		).toEqual({ ok: false, reason: 'settings-invalid', collection: 'journal' })
	})

	it('does not infer the configured settings identity from its type or collection name', () => {
		expect(
			createCollectionRouting(config).resolve(
				snapshot([settings('/blog', 'wrong-id')]),
				'published',
			),
		).toEqual({ ok: false, reason: 'settings-missing', collection: 'journal' })
	})

	it.each(['published', 'drafts'] as const)(
		'refuses duplicate selected %s records',
		(perspective) => {
			const id =
				perspective === 'drafts' ? 'drafts.journal-routing' : 'journal-routing'
			const input = snapshot([settings('/one', id), settings('/two', id)])
			expect(
				createCollectionRouting(config).resolve(input, perspective),
			).toEqual({
				ok: false,
				reason: 'settings-ambiguous',
				collection: 'journal',
			})
		},
	)

	it.each([
		undefined,
		null,
		{ status: 'unavailable' },
		{
			status: 'available',
			perspective: 'drafts',
			complete: true,
			documents: [],
		},
		{ status: 'available', perspective: 'raw', complete: false, documents: [] },
	])('refuses absent or incomplete raw snapshot %j', (input) => {
		expect(createCollectionRouting(config).resolve(input, 'published')).toEqual(
			{ ok: false, reason: 'settings-unavailable' },
		)
	})

	it.each(
		[
			null,
			{},
			[null],
			[{}],
			[{ _id: 42 }],
			Array.from({ length: MAX_SETTINGS_DOCUMENTS + 1 }, (_, i) => ({
				_id: `doc-${i}`,
			})),
		].map((documents) => ({ documents })),
	)('refuses malformed or oversized document snapshots', ({ documents }) => {
		expect(
			createCollectionRouting(config).resolve(
				{ ...snapshot([]), documents },
				'published',
			),
		).toEqual({ ok: false, reason: 'settings-invalid' })
	})

	it.each(
		['raw', 'release-id', ['release-id'], undefined].map((perspective) => ({
			perspective,
		})),
	)(
		'does not treat unsupported perspective %j as published',
		({ perspective }) => {
			expect(
				createCollectionRouting(config).resolve(
					snapshot([settings()]),
					perspective as RoutingPerspective,
				),
			).toEqual({ ok: false, reason: 'unsupported-perspective' })
		},
	)

	it('does not need settings for locked code-fixed collection prefixes', () => {
		const fixed = createCollectionRouting({
			...config,
			collections: [
				{ ...config.collections[0]!, routePrefix: '/journal' },
				config.collections[1]!,
			],
		})
		for (const input of [
			undefined,
			null,
			{ status: 'unavailable' },
			snapshot([settings('/changed')]),
		]) {
			const result = success(fixed.resolve(input, 'published'))
			expect(result.routes.collections?.[0]?.routePrefix).toBe('/journal')
			expect(result.settings).toEqual([])
		}
		expect(fixed.documentIds).toEqual([])
	})

	it('preserves fixed legacy full-path collection support but refuses to change it through settings', () => {
		const legacy = {
			...config.collections[0]!,
			items: [{ schemaType: 'post', pathnameField: 'pathname.current' }],
		}
		expect(() =>
			createCollectionRouting({ ...config, collections: [legacy] }),
		).toThrow('slug-only')
		const fixed = createCollectionRouting({
			...config,
			collections: [
				{
					...config.collections[1]!,
					name: 'journal',
					index: legacy.index,
					items: legacy.items,
					routePrefix: '/journal',
				},
			],
		})
		expect(
			success(fixed.resolve(null, 'published')).resolveUrl({
				_type: 'post',
				pathname: { current: '/journal/archive/story' },
			}),
		).toMatchObject({ ok: true, value: { pathname: '/journal/archive/story' } })
	})

	it.each([
		'',
		'name.with.dots',
		'drafts.settings',
		'versions.launch.settings',
		'-bad',
		'bad id',
		'a'.repeat(122),
	])('rejects invalid/publicly unreadable binding ID %j', (documentId) => {
		expect(() =>
			createCollectionRouting({
				...config,
				collections: [
					{ ...config.collections[0]!, settingsDocumentId: documentId },
				],
			}),
		).toThrow('non-dotted published document ID')
	})

	it('rejects duplicate settings bindings and invalid shared registry configuration', () => {
		expect(() =>
			createCollectionRouting({
				...config,
				collections: [
					config.collections[0]!,
					{
						...config.collections[1]!,
						settingsDocumentId: 'journal-routing',
					},
				],
			}),
		).toThrow('own settings document')
		expect(() => createCollectionRouting({ ...config, pages: [] })).toThrow(
			'at least one',
		)
		expect(() =>
			createCollectionRouting({
				...config,
				pages: [{ schemaType: 'page', pathnameField: '__proto__.url' }],
			}),
		).toThrow('dotted field path')
		expect(() =>
			createCollectionRouting({
				...config,
				collections: [
					{ ...config.collections[0]!, routePrefix: '/bad//prefix' },
				],
			}),
		).toThrow('canonical')
	})

	it('bounds the number of settings-backed collections', () => {
		const collections = Array.from({ length: 101 }, (_, i) => ({
			...config.collections[0]!,
			name: `collection${i}`,
			index: { schemaType: 'page', pathname: `/index${i}` },
			settingsDocumentId: `routing${i}`,
			items: [{ schemaType: `item${i}`, slugField: 'slug.current' }],
		}))
		expect(() => createCollectionRouting({ ...config, collections })).toThrow(
			'At most 100',
		)
	})

	it('does not leak setup placeholders or collide with a legitimate fixed prefix matching one', () => {
		const routing = createCollectionRouting({
			...config,
			collections: [
				config.collections[0]!,
				{ ...config.collections[1]!, routePrefix: '/_sanity-kit-settings-0' },
			],
		})
		const result = success(
			routing.resolve(snapshot([settings('/blog')]), 'published'),
		)
		expect(
			result.routes.collections?.map((collection) => collection.routePrefix),
		).toEqual(['/blog', '/_sanity-kit-settings-0'])
	})

	it('carries prefix reservations through resolved collection settings', () => {
		const routing = createCollectionRouting({
			...config,
			reservedPathPrefixes: ['/account', '/blog/private'],
		})
		const result = success(
			routing.resolve(snapshot([settings('/blog')]), 'published'),
		)
		expect(result.routes.reservedPathPrefixes).toEqual([
			'/account',
			'/blog/private',
		])
		expect(
			result.resolveUrl({
				_type: 'page',
				pathname: { current: '/account/settings' },
			}),
		).toEqual({ ok: false, reason: 'disallowed-path' })
		expect(
			result.resolveUrl({ _type: 'post', slug: { current: 'private' } }),
		).toEqual({ ok: false, reason: 'disallowed-path' })
		expect(
			result.resolveUrl({ _type: 'post', slug: { current: 'private-story' } })
				.ok,
		).toBe(true)
	})
	it('snapshots configuration and returns immutable contexts independent of later document changes', () => {
		const mutable = structuredClone(config)
		const routing = createCollectionRouting(mutable)
		mutable.collections[0]!.settingsDocumentId = 'changed'
		mutable.collections[0]!.index.pathname = '/changed'
		mutable.excludePaths.push('/blog/story')
		const document = settings('/blog')
		const result = success(routing.resolve(snapshot([document]), 'published'))
		document.prefix.current = '/changed'
		expect(
			result.resolveUrl({ _type: 'post', slug: { current: 'story' } }),
		).toMatchObject({ ok: true, value: { pathname: '/blog/story' } })
		expect(result.routes.collections?.[0]?.index.pathname).toBe('/insights')
		expect(Object.isFrozen(result.routes.collections?.[0])).toBe(true)
		expect(Object.isFrozen(result.settings)).toBe(true)
		expect(Object.isFrozen(routing.documentIds)).toBe(true)
		expect(
			success(routing.resolve(snapshot([settings('/next')]), 'published'))
				.routes.collections?.[0]?.routePrefix,
		).toBe('/next')
	})

	it('does not accept inherited settings properties', () => {
		const inherited: unknown = Object.create(settings())
		expect(
			createCollectionRouting(config).resolve(
				snapshot([inherited]),
				'published',
			),
		).toEqual({ ok: false, reason: 'settings-invalid' })
	})

	it('bundles as pure logic without Studio, React, router, or network client creation', async () => {
		const bundle = await build({
			entryPoints: ['src/url/settings/resolve.ts'],
			bundle: true,
			write: false,
			platform: 'browser',
			format: 'esm',
			metafile: true,
		})
		for (const path of Object.keys(bundle.metafile.inputs)) {
			expect(path).not.toMatch(/src\/studio\//u)
			expect(path).not.toMatch(
				/node_modules\/(?:sanity|react|react-dom|react-router|@sanity\/ui)\//u,
			)
		}
	})
})
