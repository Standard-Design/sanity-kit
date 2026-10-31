import { describe, expect, it, vi } from 'vitest'
import {
	createFolderPlanner,
	FOLDER_LIMITS,
	type FolderInventory,
} from '../../src/studio/folders/planner.js'
import type { PagesRouteConfig } from '../../src/url/index.js'

const routes = {
	pages: [
		{ schemaType: 'page', pathnameField: 'pathname.current' },
		{ schemaType: 'landing', pathnameField: 'path' },
	],
	collections: [
		{
			name: 'journal',
			title: 'Journal',
			routePrefix: '/posts',
			overview: { schemaType: 'page', pathname: '/content/journal' },
			items: [
				{ schemaType: 'post', slugField: 'slug.current' },
				{ schemaType: 'legacyPost', pathnameField: 'path' },
			],
		},
	],
	excludePaths: ['/reserved'],
} satisfies PagesRouteConfig
const planner = createFolderPlanner({ routes })
const inventory = (documents: unknown[] = []): FolderInventory => ({
	perspective: 'raw',
	complete: true,
	readAccess: 'all-registered-versions',
	documents,
})
const page = (_id: string, path: unknown) => ({
	_id,
	_type: 'page',
	_rev: 'r1',
	pathname: { current: path },
})
const stored = (...paths: string[]) => ({
	_id: planner.id,
	_type: 'sanityKitFolderRegistry',
	schemaVersion: 1,
	_rev: 'registry-r1',
	folders: paths.map((pathname, index) => ({ _key: `key-${index}`, pathname })),
})
const keys = () => {
	let count = 0
	return vi.fn(() => `new-${count++}`)
}

describe('private folder registry plans', () => {
	it('uses one fixed metadata identity for the configured project/dataset', () => {
		expect(planner.id).toBe('sanityKit.folders')
	})
	it('requires canonical collection configuration', () => {
		const changed = structuredClone(routes)
		changed.collections[0]!.overview.pathname = '/content//journal'
		expect(() => createFolderPlanner({ routes: changed })).toThrow(
			'canonical collection',
		)
	})
	it('distinguishes a verified missing registry from an unknown read', () => {
		expect(planner.validateRegistry(null)).toMatchObject({
			ok: true,
			value: { guard: { kind: 'absent' }, document: { folders: [] } },
		})
		expect(planner.validateRegistry(undefined)).toEqual({
			ok: false,
			reason: 'invalid-registry',
		})
	})
	it('plans ancestor creation and supplies an absence guard without writing', () => {
		const result = planner.planCreate(null, '/about/company/team', keys())
		expect(result).toEqual({
			ok: true,
			value: {
				operation: 'create',
				guard: { kind: 'absent' },
				document: {
					_id: planner.id,
					_type: 'sanityKitFolderRegistry',
					schemaVersion: 1,
					folders: [
						{ _key: 'new-0', pathname: '/about' },
						{ _key: 'new-1', pathname: '/about/company' },
						{ _key: 'new-2', pathname: '/about/company/team' },
					],
				},
				added: [
					{ _key: 'new-0', pathname: '/about' },
					{ _key: 'new-1', pathname: '/about/company' },
					{ _key: 'new-2', pathname: '/about/company/team' },
				],
				removed: [],
			},
		})
	})
	it('validates copies of owned fields without changing source metadata', () => {
		const current = { ...stored('/about'), unrelated: { enabled: true } }
		Object.freeze(current.folders[0])
		Object.freeze(current.folders)
		Object.freeze(current.unrelated)
		Object.freeze(current)
		const before = structuredClone(current)
		const result = planner.validateRegistry(current)
		expect(current).toEqual(before)
		expect(result).toMatchObject({
			ok: true,
			value: { guard: { kind: 'revision', revision: 'registry-r1' } },
		})
		if (!result.ok) throw new Error('Expected validation')
		expect(result.value.document).not.toHaveProperty('unrelated')
		expect(result.value.document).not.toHaveProperty('_rev')
		Object.assign(result.value.document.folders[0]!, { pathname: '/changed' })
		expect(current).toEqual(before)
	})
	it('preserves existing keys, input records, and registry revision', () => {
		const current = stored('/about'),
			before = structuredClone(current),
			createKey = keys()
		const result = planner.planCreate(current, '/about/team', createKey)
		expect(result).toMatchObject({
			ok: true,
			value: {
				operation: 'update',
				guard: { kind: 'revision', revision: 'registry-r1' },
				document: {
					folders: [
						current.folders[0],
						{ _key: 'new-0', pathname: '/about/team' },
					],
				},
			},
		})
		expect(createKey).toHaveBeenCalledTimes(1)
		expect(current).toEqual(before)
		if (!result.ok) throw new Error('Expected plan')
		Object.assign(result.value.document.folders[0]!, { pathname: '/changed' })
		expect(current).toEqual(before)
	})
	it('returns unchanged without inventing keys or writes', () => {
		const createKey = keys()
		expect(
			planner.planCreate(stored('/about'), '/about', createKey),
		).toMatchObject({
			ok: true,
			value: { operation: 'unchanged', added: [], removed: [] },
		})
		expect(createKey).not.toHaveBeenCalled()
	})
	it.each([
		'/',
		'/about/',
		'/about//team',
		'//host',
		'/a?b',
		'/a#b',
		'/a\\b',
		'/a/../b',
		'/%2fhost',
		'/bad%zz',
		'/café',
		'/a b',
		'/' + 'a'.repeat(2048),
	])('does not repair invalid folder paths %j', (path) => {
		expect(planner.planCreate(null, path, keys())).toEqual({
			ok: false,
			reason: 'invalid-folder',
		})
	})
	it('allows safe percent-encoded segments without decoding them', () => {
		expect(planner.planCreate(null, '/caf%C3%A9', keys())).toMatchObject({
			ok: true,
			value: { document: { folders: [{ pathname: '/caf%C3%A9' }] } },
		})
	})
	it('keeps collection groups separate but permits ordinary folders beneath them', () => {
		expect(planner.planCreate(null, '/content/journal', keys())).toEqual({
			ok: false,
			reason: 'collection-group',
		})
		const result = planner.planCreate(null, '/content/journal/about', keys())
		expect(result).toMatchObject({
			ok: true,
			value: {
				document: {
					folders: [
						{ pathname: '/content' },
						{ pathname: '/content/journal/about' },
					],
				},
			},
		})
		if (!result.ok) throw new Error('Expected plan')
		expect(
			planner.validateRegistry({ ...result.value.document, _rev: 'r' }).ok,
		).toBe(true)
	})
	it.each([
		{ _id: 'drafts.sanityKit.folders' },
		{ _id: 'sanityKit.folders.other' },
		{ _type: 'page' },
		{ schemaVersion: 2 },
		{ _rev: '' },
		{ folders: null },
		{ folders: [{ _key: 'one', pathname: '/' }] },
		{ folders: [{ _key: 'one', pathname: '/content/journal' }] },
		{ folders: [{ _key: 'one', pathname: '/about/team' }] },
		{ folders: [{ _key: 'one', pathname: '/about/' }] },
		{
			folders: [
				{ _key: 'one', pathname: '/a' },
				{ _key: 'one', pathname: '/b' },
			],
		},
		{
			folders: [
				{ _key: 'one', pathname: '/a' },
				{ _key: 'two', pathname: '/a' },
			],
		},
	])('rejects malformed registry state %j', (override) => {
		expect(planner.validateRegistry({ ...stored(), ...override })).toEqual({
			ok: false,
			reason: 'invalid-registry',
		})
	})
	it.each([
		() => '',
		() => 'invalid.key',
		() => 'key-0',
		() => {
			throw new Error('failed')
		},
	])('refuses invalid or colliding generated keys', (createKey) => {
		expect(
			planner.planCreate(stored('/about'), '/about/team', createKey),
		).toEqual({ ok: false, reason: 'invalid-key' })
	})
	it('refuses duplicate newly generated keys without a partial plan', () => {
		expect(planner.planCreate(null, '/about/team', () => 'same')).toEqual({
			ok: false,
			reason: 'invalid-key',
		})
	})
	it('adopts ancestors additively across raw versions, never collection items', () => {
		const current = stored('/empty')
		const result = planner.planSynchronize(
			current,
			inventory([
				page('a', '/about/team/name'),
				page('drafts.a', '/about/company/name'),
				page('versions.launch.a', '/future/name'),
				{ _id: 'post', _type: 'post', _rev: 'r', slug: { current: 'story' } },
				{
					_id: 'old-post',
					_type: 'legacyPost',
					_rev: 'r',
					path: '/posts/archive/story',
				},
				page('overview-child', '/content/journal/about/team'),
				page('prefix-child', '/posts/ordinary/page'),
				page('missing', null),
				{ _type: 'shared' },
			]),
			keys(),
		)
		if (!result.ok) throw new Error('Expected plan')
		expect(
			result.value.document.folders.map((folder) => folder.pathname),
		).toEqual([
			'/empty',
			'/about',
			'/about/team',
			'/about/company',
			'/future',
			'/content',
			'/content/journal/about',
			'/posts',
			'/posts/ordinary',
		])
		expect(result.value.removed).toEqual([])
		expect(current).toEqual(stored('/empty'))
	})
	it('adopts only parents, not an ordinary leaf page as a folder', () => {
		const simple = createFolderPlanner({
			routes: { pages: routes.pages },
		})
		expect(
			simple.planSynchronize(
				null,
				inventory([page('about', '/about'), page('home', '/')]),
				keys(),
			),
		).toMatchObject({ ok: true, value: { operation: 'unchanged', added: [] } })
	})
	it('retains ancestors required by collection groups even without overview documents', () => {
		expect(planner.planSynchronize(null, inventory(), keys())).toMatchObject({
			ok: true,
			value: { document: { folders: [{ pathname: '/content' }] } },
		})
		expect(
			planner.planRemove(stored('/content'), '/content', inventory()),
		).toEqual({ ok: false, reason: 'folder-not-empty' })
	})
	it.each([
		{ complete: false },
		{ perspective: 'published' },
		{ readAccess: 'unknown' },
	])('refuses insufficient inventory evidence %j', (override) => {
		const evidence = { ...inventory(), ...override } as FolderInventory
		expect(planner.planSynchronize(null, evidence, keys())).toEqual({
			ok: false,
			reason: 'incomplete-inventory',
		})
		expect(planner.planRemove(stored('/empty'), '/empty', evidence)).toEqual({
			ok: false,
			reason: 'incomplete-inventory',
		})
	})
	it.each(
		[
			[null],
			[{}],
			[{ ...page('a', '/a'), _rev: '' }],
			[page('a', '/a'), page('a', '/b')],
			[page('a', '/about//team')],
			[page('a', 12)],
			[{ ...page('a', '/a'), _originalId: 'drafts.a' }],
			[{ _id: 'post', _type: 'post', _rev: 'r', slug: { current: '/wrong' } }],
		].map((documents) => ({ documents })),
	)(
		'refuses malformed or effective-perspective inventory %j',
		({ documents }) => {
			expect(
				planner.planRemove(stored('/empty'), '/empty', inventory(documents)),
			).toEqual({ ok: false, reason: 'invalid-inventory' })
		},
	)
	it.each(['page', 'drafts.page', 'versions.launch.page'])(
		'blocks removal for an index in raw version %s',
		(id) => {
			expect(
				planner.planRemove(
					stored('/about'),
					'/about',
					inventory([page(id, '/about')]),
				),
			).toEqual({ ok: false, reason: 'folder-not-empty' })
		},
	)
	it('blocks descendants, saved subfolders, and a malformed-owner collection document', () => {
		for (const documents of [
			[page('a', '/about/team')],
			[
				{
					_id: 'post',
					_type: 'legacyPost',
					_rev: 'r',
					path: '/about/bad-owner',
				},
			],
		])
			expect(
				planner.planRemove(stored('/about'), '/about', inventory(documents)),
			).toEqual({ ok: false, reason: 'folder-not-empty' })
		expect(
			planner.planRemove(
				stored('/about', '/about/team'),
				'/about',
				inventory(),
			),
		).toEqual({ ok: false, reason: 'folder-not-empty' })
	})
	it('removes only an empty record, leaving pages and sibling folder keys alone', () => {
		const current = stored('/about', '/about/team', '/about/teamwork'),
			documents = [page('other', '/about/teamwork/page')]
		const before = structuredClone({ current, documents })
		expect(
			planner.planRemove(current, '/about/team', inventory(documents)),
		).toMatchObject({
			ok: true,
			value: {
				operation: 'update',
				guard: { kind: 'revision', revision: 'registry-r1' },
				document: { folders: [current.folders[0], current.folders[2]] },
				added: [],
				removed: [current.folders[1]],
			},
		})
		expect({ current, documents }).toEqual(before)
	})
	it('refuses removing root, collection groups, or missing folders', () => {
		expect(planner.planRemove(stored(), '/', inventory())).toEqual({
			ok: false,
			reason: 'invalid-folder',
		})
		expect(
			planner.planRemove(stored(), '/content/journal', inventory()),
		).toEqual({ ok: false, reason: 'collection-group' })
		expect(planner.planRemove(null, '/missing', inventory())).toEqual({
			ok: false,
			reason: 'folder-not-found',
		})
	})
	it('bounds folder count, registry bytes, and raw inventory size', () => {
		const full = stored(
			...Array.from({ length: FOLDER_LIMITS.folders }, (_, i) => `/p${i}`),
		)
		expect(planner.planCreate(full, '/new', keys())).toEqual({
			ok: false,
			reason: 'limit-exceeded',
		})
		expect(
			planner.validateRegistry(
				stored(...Array.from({ length: 1001 }, (_, i) => `/p${i}`)),
			),
		).toEqual({ ok: false, reason: 'limit-exceeded' })
		expect(
			planner.planSynchronize(
				null,
				inventory(
					Array.from({ length: 300 }, (_, i) =>
						page(`long-${i}`, `/${i}-${'a'.repeat(1900)}/leaf`),
					),
				),
				keys(),
			),
		).toEqual({ ok: false, reason: 'limit-exceeded' })
		expect(
			planner.validateRegistry(
				stored(
					...Array.from({ length: 300 }, (_, i) => `/${i}-${'a'.repeat(1900)}`),
				),
			),
		).toEqual({ ok: false, reason: 'limit-exceeded' })
		expect(
			planner.planSynchronize(
				null,
				inventory(Array.from({ length: 10001 }, (_, i) => page(`p${i}`, '/a'))),
				keys(),
			),
		).toEqual({ ok: false, reason: 'limit-exceeded' })
		expect(
			planner.planSynchronize(
				null,
				inventory(
					Array.from({ length: 1001 }, (_, i) =>
						page(`p${i}`, `/folder${i}/page`),
					),
				),
				keys(),
			),
		).toEqual({ ok: false, reason: 'limit-exceeded' })
	})
	it('snapshots route configuration', () => {
		const mutable = structuredClone(routes),
			model = createFolderPlanner({ routes: mutable })
		mutable.collections[0]!.overview.pathname = '/elsewhere'
		expect(model.planCreate(null, '/content/journal', keys())).toEqual({
			ok: false,
			reason: 'collection-group',
		})
	})
})
