import { describe, it, expect } from 'vitest'
import {
	visibleTreeRows,
	pageRows,
} from '../../src/studio/pages/visible-rows.js'
import type {
	NavigationNode,
	NavigationPage,
} from '../../src/studio/pages/navigation.js'

const page = (id: string): NavigationPage => ({
	kind: 'page',
	key: `page:${id}`,
	pathname: `/${id}`,
	document: { _id: id, _type: 'page', title: id, pathname: `/${id}` },
})
const nodes: NavigationNode[] = [
	{
		kind: 'folder',
		key: 'folder:/a',
		name: 'a',
		pathname: '/a',
		children: [
			page('a'),
			{
				kind: 'folder',
				key: 'folder:/a/b',
				name: 'b',
				pathname: '/a/b',
				children: [page('b')],
			},
			page('c'),
		],
	},
	{
		kind: 'collection',
		key: 'collection:posts',
		name: 'posts',
		title: 'Posts',
		pathname: '/posts',
		indexPages: [page('index')],
		children: [page('nested')],
	},
	page('last'),
]
describe('visible navigator order', () => {
	it('preserves preorder, native index placement, recent blocks and ancestor spacing', () => {
		const rows = visibleTreeRows(nodes, [])
		expect(rows.map((row) => [row.key, row.depth])).toEqual([
			['folder:/a', 0],
			['page:a', 1],
			['folder:/a/b', 1],
			['page:b', 2],
			['page:c', 1],
			['collection:posts', 0],
			['page:index', 1],
			['page:nested', 1],
			['collection:posts:recent', 1],
			['page:last', 0],
		])
		expect(rows.find((row) => row.key === 'page:b')!.spacing[1]).toBe(16)
		expect(rows.find((row) => row.key === 'page:c')!.spacing[0]).toBe(16)
		expect(rows.find((row) => row.key === 'page:last')!.spacing).toEqual([])
	})
	it('removes collapsed descendants and subscriptions without losing stable identities', () => {
		const rows = visibleTreeRows(nodes, ['folder:/a', 'collection:posts'])
		expect(rows.map((row) => row.key)).toEqual([
			'folder:/a',
			'collection:posts',
			'page:last',
		])
		expect(rows[0]!.spacing).toEqual([4])
		expect(rows.some((row) => row.kind === 'recent')).toBe(false)
	})
	it('keeps missing URLs and unusual URLs under separate headings, and search keys match tree keys', () => {
		const missing = { ...page('missing'), pathname: undefined }
		const odd = { ...page('odd'), pathname: '/odd//' }
		const rows = visibleTreeRows([], [], [odd, missing])
		expect(rows.map((row) => row.key)).toEqual([
			'heading:Pages without URLs',
			'page:missing',
			'heading:Ungrouped pages',
			'page:odd',
		])
		expect(
			pageRows([missing.document, odd.document]).map((row) => row.key),
		).toEqual(['page:missing', 'page:odd'])
	})
})
