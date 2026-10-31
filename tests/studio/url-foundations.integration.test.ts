import { evaluate, parse } from 'groq-js'
import { describe, expect, it } from 'vitest'
import { compileRedirectSnapshot } from '../../src/redirect/snapshot.js'
import { createFolderPlanner } from '../../src/studio/folders/planner.js'
import type { PagesClient } from '../../src/studio/pages/data-source.js'
import { createUrlConflictChecker } from '../../src/studio/url/conflicts.js'
import { createUrlAuthoring } from '../../src/url/authoring.js'
import { createCollectionRouting } from '../../src/url/settings/resolve.js'

const routing = createCollectionRouting({
	pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
	collections: [
		{
			name: 'journal',
			title: 'Journal',
			routePrefix: { documentId: 'journal-routing' },
			overview: { schemaType: 'page', pathname: '/insights' },
			items: [{ schemaType: 'post', slugField: 'slug.current' }],
		},
	],
})
const settings = (_id: string, prefix: string) => ({
	_id,
	_type: 'sanityKitCollectionRoute',
	_rev: 'r1',
	collection: 'journal',
	prefix: { _type: 'slug', current: prefix },
})
function context(mode: 'published' | 'drafts') {
	const result = routing.resolve(
		{
			status: 'available',
			perspective: 'raw',
			coverage: 'published-and-drafts',
			complete: true,
			documents: [
				settings('journal-routing', '/journal'),
				settings('drafts.journal-routing', '/blog'),
			],
		},
		mode,
	)
	if (!result.ok) throw new Error(result.reason)
	return result.value
}
const post = {
	_id: 'story',
	_type: 'post',
	_rev: 'r1',
	slug: { current: 'story' },
}
const page = {
	_id: 'team',
	_type: 'page',
	_rev: 'r2',
	pathname: { current: '/about/team' },
}

describe('private URL foundations together', () => {
	it('uses the selected settings for both authoring and real conflict queries', async () => {
		const before = structuredClone(post)
		const dataset = [{ ...page, pathname: { current: '/blog/story' } }]
		const client = {
			withConfig: () => ({
				fetch: async (
					query: string,
					params: Record<string, unknown>,
				): Promise<unknown> =>
					(await evaluate(parse(query), { dataset, params })).get(),
			}),
		} as unknown as Pick<PagesClient, 'withConfig'>
		for (const mode of ['published', 'drafts'] as const) {
			const selected = context(mode)
			const prefix = mode === 'published' ? '/journal' : '/blog'
			expect(
				createUrlAuthoring(selected.routes).prepareParts('post', {
					prefix,
					slug: 'story',
				}),
			).toMatchObject({
				ok: true,
				value: { storedValue: 'story', url: { pathname: `${prefix}/story` } },
			})
			const result = await createUrlConflictChecker(
				selected.routes,
				client,
			)({ schemaType: 'post', storedValue: 'story', documentId: 'story' })
			if (result.status !== 'checked') throw new Error(result.status)
			expect(result.conflicts.map(({ documentId }) => documentId)).toEqual(
				mode === 'published' ? [] : ['team'],
			)
		}
		expect(post).toEqual(before)
	})

	it('keeps collection prefixes out of inferred folders and leaves overview URLs alone', () => {
		for (const mode of ['published', 'drafts'] as const) {
			const selected = context(mode)
			const result = createFolderPlanner({
				site: 'main',
				routes: selected.routes,
			}).planSynchronize(
				null,
				{
					site: 'main',
					perspective: 'raw',
					complete: true,
					readAccess: 'all-registered-versions',
					documents: [page, post],
				},
				() => 'about-key',
			)
			expect(result).toMatchObject({
				ok: true,
				value: { added: [{ _key: 'about-key', pathname: '/about' }] },
			})
			expect(
				selected.resolveUrl({ ...page, pathname: { current: '/insights' } }),
			).toMatchObject({ ok: true, value: { pathname: '/insights' } })
		}
	})

	it('can validate a proposed alias from resolved URLs without writing or publishing the change', () => {
		const oldUrl = context('published').resolveUrl(post)
		const proposedUrl = context('drafts').resolveUrl(post)
		if (!oldUrl.ok || !proposedUrl.ok) throw new Error('Expected URL parts')
		// This models a future publication review, not an already published prefix.
		const envelope = {
			site: 'main',
			perspective: 'published',
			complete: true,
			records: [
				{
					_id: 'redirect-story',
					_type: 'sanityKitRedirect',
					site: 'main',
					enabled: true,
					source: oldUrl.value.pathname,
					destination: proposedUrl.value.pathname,
					status: 301,
				},
			],
		}
		const options = {
			site: 'main',
			destinations: [proposedUrl.value.pathname],
			occupiedPaths: [proposedUrl.value.pathname],
		}
		const result = compileRedirectSnapshot(envelope, options)
		if (!result.ok) throw new Error(result.reason)
		expect(result.value.match('/journal/story')).toEqual({
			kind: 'redirect',
			status: 301,
			location: '/blog/story',
		})
		expect(
			compileRedirectSnapshot(envelope, {
				...options,
				occupiedPaths: ['/journal/story'],
			}),
		).toMatchObject({ ok: false, reason: 'occupied-source' })
		expect(context('published').resolveUrl(post)).toMatchObject({
			ok: true,
			value: { pathname: '/journal/story' },
		})
	})
})
