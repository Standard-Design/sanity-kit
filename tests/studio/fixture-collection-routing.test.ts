import { describe, expect, it } from 'vitest'
import { loadFixtureArticlePrefix } from '../fixtures/pages-studio/preview-routing.js'

function client(records: { _id: string; prefix: { current: string } }[]) {
	return {
		withConfig: () => ({
			fetch: (_query: string, { ids }: { ids: string[] }) =>
				Promise.resolve(
					records
						.filter((record) => ids.includes(record._id))
						.map((record) => ({
							...record,
							_type: 'sanityKitCollectionRoute',
							_rev: `revision-${record._id}`,
							collection: 'articles',
							prefix: { _type: 'slug', ...record.prefix },
						})),
				),
		}),
	}
}

describe('fixture website collection routing', () => {
	it('uses the requested perspective for its article query prefix', async () => {
		const source = client([
			{ _id: 'kitProofArticleRouting', prefix: { current: '/articles' } },
			{ _id: 'drafts.kitProofArticleRouting', prefix: { current: '/stories' } },
		])
		expect(await loadFixtureArticlePrefix(source, 'published')).toBe(
			'/articles',
		)
		expect(await loadFixtureArticlePrefix(source, 'drafts')).toBe('/stories')
		expect(
			await loadFixtureArticlePrefix(source, ['drafts', 'published']),
		).toBe('/stories')
	})
	it('does not invent a live prefix when only draft settings exist', async () => {
		const source = client([
			{ _id: 'drafts.kitProofArticleRouting', prefix: { current: '/stories' } },
		])
		await expect(loadFixtureArticlePrefix(source, 'published')).rejects.toThrow(
			'settings-missing',
		)
		expect(await loadFixtureArticlePrefix(source, 'drafts')).toBe('/stories')
	})
	it('does not treat a release perspective as ordinary draft settings', async () => {
		await expect(
			loadFixtureArticlePrefix(client([]), ['release-id', 'drafts']),
		).rejects.toThrow('published and draft routing only')
	})
})
