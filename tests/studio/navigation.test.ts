import { describe, expect, it } from 'vitest'
import {
	buildNavigationTree,
	type NavigationNode,
} from '../../src/studio/pages/navigation.js'
import { createPagesRegistry } from '../../src/studio/pages/registry.js'
import type { PageDocument } from '../../src/studio/pages/model.js'

const registry = createPagesRegistry({
	pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
	collections: [
		{
			name: 'journal',
			title: 'Journal',
			overview: { schemaType: 'page', pathname: '/journal' },
			routePrefix: '/journal',
			items: [{ schemaType: 'post', pathnameField: 'path' }],
		},
	],
})
const page = (
	id: string,
	pathname: string | null,
	title = id,
): PageDocument => ({ _id: id, _type: 'page', title, pathname })
function allPages(nodes: NavigationNode[]): string[] {
	return nodes.flatMap((node) =>
		node.kind === 'page'
			? [node.document._id]
			: node.kind === 'folder'
				? allPages(node.children)
				: [...allPages(node.overviews), ...allPages(node.children)],
	)
}

describe('Pages navigator hierarchy', () => {
	it('infers missing ancestors without making index documents or a Site root row', () => {
		const { roots } = buildNavigationTree(registry, [
			page('team', '/about/company/team'),
		])
		expect(roots[0]).toMatchObject({
			kind: 'folder',
			pathname: '/about',
			name: 'about',
			children: [
				{
					kind: 'folder',
					pathname: '/about/company',
					children: [{ kind: 'page', document: { _id: 'team' } }],
				},
			],
		})
		expect(allPages(roots)).toEqual(['team'])
		expect(roots.some((node) => node.pathname === '/')).toBe(false)
	})
	it('puts the named index first under its folder, with folders before sibling pages', () => {
		const { roots } = buildNavigationTree(registry, [
			page('team', '/about/team'),
			page('about', '/about', 'Our company'),
			page('home', '/'),
			page('lead', '/about/company/leadership'),
		])
		expect(roots[0]).toMatchObject({ kind: 'page', document: { _id: 'home' } })
		expect(roots[1]).toMatchObject({
			kind: 'folder',
			pathname: '/about',
			children: [
				{ kind: 'page', document: { _id: 'about', title: 'Our company' } },
				{ kind: 'folder', name: 'company' },
				{ kind: 'page', document: { _id: 'team' } },
			],
		})
	})
	it('leaves a leaf page as a page rather than inventing an empty folder', () => {
		const { roots } = buildNavigationTree(registry, [page('about', '/about')])
		expect(roots.find((node) => node.pathname === '/about')).toMatchObject({
			kind: 'page',
		})
	})
	it('keeps overview and posts out of the generic page list', () => {
		const { roots } = buildNavigationTree(registry, [
			page('journal', '/journal'),
			{ ...page('post', '/journal/post'), _type: 'post' },
		])
		expect(roots).toHaveLength(1)
		expect(roots[0]).toMatchObject({
			kind: 'collection',
			name: 'journal',
			overviews: [{ document: { _id: 'journal' } }],
		})
		expect(allPages(roots)).toEqual(['journal'])
	})
	it('does not duplicate a collection group when ordinary pages live beneath its overview', () => {
		const { roots } = buildNavigationTree(registry, [
			page('journal', '/journal'),
			page('authors', '/journal/authors'),
			page('person', '/journal/authors/alice'),
		])
		expect(roots).toHaveLength(1)
		expect(roots[0]).toMatchObject({
			kind: 'collection',
			children: [{ kind: 'folder', name: 'authors' }],
		})
		expect(allPages(roots)).toEqual(['journal', 'authors', 'person'])
	})
	it('represents missing and duplicate overviews without inventing or choosing a document', () => {
		const empty = buildNavigationTree(registry, [])
		expect(empty.roots).toMatchObject([{ kind: 'collection', overviews: [] }])
		const duplicate = buildNavigationTree(registry, [
			page('b', '/journal'),
			page('a', '/journal'),
		])
		expect(allPages(duplicate.roots)).toEqual(['a', 'b'])
	})
	it('keeps every colliding ordinary page visible', () => {
		const { roots } = buildNavigationTree(registry, [
			page('b', '/about'),
			page('a', '/about'),
			page('child', '/about/child'),
		])
		expect(allPages(roots)).toEqual(['a', 'b', 'child'])
	})
	it('preserves document keys when paths or titles change', () => {
		const before = buildNavigationTree(registry, [page('a', '/before')])
		const after = buildNavigationTree(registry, [
			page('a', '/after', 'New name'),
		])
		expect(before.roots.find((node) => node.kind === 'page')?.key).toBe(
			'page:a',
		)
		expect(after.roots.find((node) => node.kind === 'page')?.key).toBe('page:a')
	})
	it('keeps pathless, invalid, excluded, and ungroupable paths in an editable unfiled list', () => {
		const excluding = createPagesRegistry({
			pages: [{ schemaType: 'page', pathnameField: 'pathname' }],
			excludePaths: ['/'],
		})
		const input = [
			page('blank', null),
			page('invalid', 'https://other.test'),
			page('home', '/'),
			page('repeated', '/a//b'),
			page('trailing', '/a/'),
		]
		const { roots, unfiled } = buildNavigationTree(excluding, input)
		expect(roots).toEqual([])
		expect(unfiled).toHaveLength(5)
		expect(
			unfiled.find((node) => node.document._id === 'repeated')?.pathname,
		).toBe('/a//b')
		expect(
			unfiled.find((node) => node.document._id === 'home')?.pathname,
		).toBeUndefined()
		expect(input[3]?.pathname).toBe('/a//b')
	})
	it('ignores unregistered documents and wrong-type overview paths stay unfiled', () => {
		const alternate = createPagesRegistry({
			pages: [
				{ schemaType: 'page', pathnameField: 'path' },
				{ schemaType: 'landing', pathnameField: 'route' },
			],
			collections: registry.collections,
		})
		const result = buildNavigationTree(alternate, [
			{ ...page('shared', null), _type: 'shared' },
			{ ...page('wrong', '/journal'), _type: 'landing' },
		])
		expect(allPages(result.roots)).toEqual([])
		expect(result.unfiled.map((entry) => entry.document._id)).toEqual(['wrong'])
	})
	it.each(['drafts.a', 'versions.release.a'])(
		'rejects raw version %s rather than guessing precedence',
		(id) => {
			expect(() => buildNavigationTree(registry, [page(id, '/about')])).toThrow(
				'effective document',
			)
		},
	)
	it('rejects duplicate effective IDs', () => {
		expect(() =>
			buildNavigationTree(registry, [page('a', '/a'), page('a', '/b')]),
		).toThrow('effective document')
	})
	it('is deterministic without mutating input order', () => {
		const input = [
			page('b', '/b', 'Same title'),
			page('a', '/a', 'Same title'),
			page('z', '/z/child'),
		]
		expect(buildNavigationTree(registry, input)).toEqual(
			buildNavigationTree(registry, [...input].reverse()),
		)
		expect(input.map((document) => document._id)).toEqual(['b', 'a', 'z'])
	})
	it.each(['/', '/news/journal', '/news/journal/'])(
		'handles overview path %s independently of the item prefix',
		(pathname) => {
			const custom = createPagesRegistry({
				pages: [{ schemaType: 'page', pathnameField: 'path' }],
				collections: [
					{
						...registry.collections[0]!,
						overview: { schemaType: 'page', pathname },
						routePrefix: '/posts',
					},
				],
			})
			const { roots } = buildNavigationTree(custom, [
				page('overview', pathname),
				page('about', '/about'),
			])
			expect(allPages(roots).sort()).toEqual(['about', 'overview'])
		},
	)
})
