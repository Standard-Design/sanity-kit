import { evaluate, parse } from 'groq-js'
import { describe, expect, it } from 'vitest'
import { createPagesRuntime } from '../../src/studio/pages/runtime.js'
import type { PageQueryPlan } from '../../src/studio/pages/data-source.js'
import type { PageDocument } from '../../src/studio/pages/model.js'

const { model } = createPagesRuntime({
	previewUrl: 'https://preview.test',
	pages: [
		{ schemaType: 'page', pathnameField: 'url.current', titleField: 'heading' },
		{ schemaType: 'landing', pathnameField: 'path' },
	],
	collections: [
		{
			name: 'journal',
			title: 'Journal',
			routePrefix: '/journal',
			overview: { schemaType: 'page', pathname: '/journal' },
			items: [{ schemaType: 'post', pathnameField: 'path' }],
		},
	],
	excludePaths: ['/private'],
})
const page = (id: string, path: string) => ({
	_id: id,
	_type: 'page',
	heading: `Page ${id}`,
	url: { current: path },
})
async function read(
	plan: PageQueryPlan | undefined,
	dataset: object[],
): Promise<PageDocument[]> {
	if (!plan) return []
	return (
		await evaluate(parse(plan.query), { dataset, params: plan.params })
	).get() as Promise<PageDocument[]>
}

describe('Targeted Pages header identity', () => {
	it('finds an older page without sorting or reading the newest documents', async () => {
		const plan = model.previewQuery(
			'https://preview.test/old?perspective=drafts#section',
		)
		const dataset = [
			...Array.from({ length: 100 }, (_, i) => page(`${i}`, `/page-${i}`)),
			page('old', '/old'),
		]
		expect(await read(plan, dataset)).toEqual([
			{ _id: 'old', _type: 'page', title: 'Page old', pathname: '/old' },
		])
		expect(plan?.query).not.toContain('order(')
		expect(plan).toEqual(model.previewQuery('/old'))
	})
	it('returns at most two matching documents and treats cross-type collisions as ambiguous', async () => {
		const dataset = [
			page('a', '/about'),
			{ _id: 'b', _type: 'landing', path: '/about' },
			page('c', '/about'),
		]
		const documents = await read(model.previewQuery('/about'), dataset)
		expect(documents).toHaveLength(2)
		expect(model.previewedDocument(documents, '/about')).toBeUndefined()
	})
	it('honors collection ownership while ignoring shared and unregistered types', async () => {
		const dataset = [
			page('overview', '/journal'),
			{ _id: 'wrong', _type: 'landing', path: '/journal' },
			{ _id: 'shared', _type: 'shared', path: '/journal' },
			{ _id: 'post', _type: 'post', path: '/journal/story' },
			{ _id: 'outside', _type: 'post', path: '/outside' },
		]
		expect(await read(model.previewQuery('/journal'), dataset)).toMatchObject([
			{ _id: 'overview' },
		])
		expect(
			await read(model.previewQuery('/journal/story'), dataset),
		).toMatchObject([{ _id: 'post' }])
		expect(await read(model.previewQuery('/outside'), dataset)).toEqual([])
	})
	it.each([undefined, '', 'https://[invalid', '/private', '/bad%zz'])(
		'does not query an absent, invalid, or excluded preview: %s',
		(preview) => {
			expect(model.previewQuery(preview)).toBeUndefined()
		},
	)
	it.each(['old', 'drafts.old', 'versions.release-id.old'])(
		'looks up the effective document for %s even without a URL',
		async (id) => {
			expect(
				await read(model.documentQuery(id, 'page'), [
					{ _id: 'old', _type: 'page', heading: 'Unfinished' },
				]),
			).toEqual([
				{ _id: 'old', _type: 'page', title: 'Unfinished', pathname: null },
			])
		},
	)
	it('requires a registered edited type and exact ID/type agreement', async () => {
		expect(model.documentQuery('shared', 'shared')).toBeUndefined()
		expect(model.documentQuery(undefined, 'page')).toBeUndefined()
		expect(model.documentQuery('old')).toBeUndefined()
		expect(
			await read(model.documentQuery('old', 'landing'), [page('old', '/old')]),
		).toEqual([])
	})
})
