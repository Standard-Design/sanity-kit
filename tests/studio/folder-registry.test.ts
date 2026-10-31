import { evaluate, parse } from 'groq-js'
import { describe, expect, it } from 'vitest'
import { FOLDER_LIMITS } from '../../src/studio/folders/planner.js'
import {
	folderRegistryQuery,
	readNavigationFolders,
} from '../../src/studio/pages/folder-registry.js'
import { createPagesRegistry } from '../../src/studio/pages/registry.js'

const routes = createPagesRegistry({
	pages: [{ schemaType: 'page', pathnameField: 'path' }],
})
const saved = () => ({
	_id: 'sanityKit.folders',
	_type: 'sanityKitFolderRegistry',
	_rev: 'revision-1',
	schemaVersion: 1,
	folders: [{ _key: 'about', pathname: '/about' }],
})

describe('saved-folder display reads', () => {
	it('reads only the exact singleton and preserves an overflow sentinel', async () => {
		const many = {
			...saved(),
			folders: Array.from({ length: FOLDER_LIMITS.folders + 5 }, (_, i) => ({
				_key: `key-${i}`,
				pathname: `/folder-${i}`,
			})),
		}
		const result: unknown = await (
			await evaluate(parse(folderRegistryQuery), {
				dataset: [
					many,
					{ ...saved(), _id: 'drafts.sanityKit.folders' },
					{ ...saved(), _id: 'versions.release.sanityKit.folders' },
				],
				params: { registryId: 'sanityKit.folders' },
			})
		).get()
		expect(result).toMatchObject({ _id: 'sanityKit.folders' })
		expect((result as { folders: unknown[] }).folders).toHaveLength(
			FOLDER_LIMITS.folders + 1,
		)
		expect(() => readNavigationFolders(routes, result)).toThrow(
			'limit-exceeded',
		)
	})
	it('returns copied display records and treats null only as no visible metadata', () => {
		const input = saved()
		const folders = readNavigationFolders(routes, input)
		expect(folders).toEqual(input.folders)
		expect(folders).not.toBe(input.folders)
		input.folders[0]!.pathname = '/changed'
		expect(folders[0]!.pathname).toBe('/about')
		expect(readNavigationFolders(routes, null)).toEqual([])
	})
	it.each([
		undefined,
		{ ...saved(), _type: 'page' },
		{ ...saved(), schemaVersion: 2 },
		{ ...saved(), _originalId: 'drafts.sanityKit.folders' },
		{ ...saved(), folders: [{ _key: 'broken', pathname: '/about//team' }] },
		{
			...saved(),
			folders: [{ _key: 'missing-parent', pathname: '/about/team' }],
		},
		{ ...saved(), folders: 'invalid' },
	])(
		'rejects malformed metadata rather than displaying a subset: %j',
		(input) => {
			expect(() => readNavigationFolders(routes, input)).toThrow()
		},
	)
	it('does not reject legacy page navigation merely because no persistent folders are visible', () => {
		const legacy = createPagesRegistry({
			pages: [{ schemaType: 'page', pathnameField: 'path' }],
			collections: [
				{
					name: 'journal',
					title: 'Journal',
					routePrefix: '/journal',
					overview: { schemaType: 'page', pathname: '/journal/' },
					items: [{ schemaType: 'post', pathnameField: 'path' }],
				},
			],
		})
		expect(readNavigationFolders(legacy, null)).toEqual([])
		expect(() => readNavigationFolders(legacy, saved())).toThrow(
			'canonical collection paths',
		)
	})
})
