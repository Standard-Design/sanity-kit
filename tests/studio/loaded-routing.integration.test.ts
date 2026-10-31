import type { SanityClient } from '@sanity/client'
import { evaluate, parse } from 'groq-js'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { loadRedirectSnapshot } from '../../src/redirect/load.js'
import { createFolderLoader } from '../../src/studio/folders/load.js'
import { createFolderPlanner } from '../../src/studio/folders/planner.js'
import type { PagesClient } from '../../src/studio/pages/data-source.js'
import { createCollectionRoutingLoader } from '../../src/url/settings/load.js'
import type { CollectionRoutingConfig } from '../../src/url/settings/resolve.js'

const config = {
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
} satisfies CollectionRoutingConfig
const post = {
	_id: 'story',
	_type: 'post',
	_rev: 'p1',
	slug: { current: 'story' },
}
const page = {
	_id: 'team',
	_type: 'page',
	_rev: 'p2',
	pathname: { current: '/about/team' },
}
const setting = (_id: string, prefix: string) => ({
	_id,
	_type: 'sanityKitCollectionRoute',
	_rev: 'r1',
	collection: 'journal',
	prefix: { _type: 'slug', current: prefix },
})
const redirect = {
	_id: 'old-story',
	_type: 'sanityKitRedirect',
	enabled: true,
	source: '/old/story',
	destination: '/journal/story',
	status: 301,
}

function transport() {
	const documents = [
		post,
		page,
		setting('journal-routing', '/journal'),
		setting('drafts.journal-routing', '/blog'),
		redirect,
	]
	const fetch = vi.fn(
		async (query: string, params: Record<string, unknown>): Promise<unknown> =>
			(await evaluate(parse(query), { dataset: documents, params })).get(),
	)
	const client = { withConfig: () => ({ fetch }) }
	return { client, fetch, documents }
}

describe('loaded routing foundations', () => {
	it('accepts both application and Studio clients at the three read boundaries', () => {
		expectTypeOf<SanityClient>().toMatchTypeOf<
			Parameters<typeof createCollectionRoutingLoader>[1]
		>()
		expectTypeOf<PagesClient>().toMatchTypeOf<
			Parameters<typeof createCollectionRoutingLoader>[1]
		>()
		expectTypeOf<SanityClient>().toMatchTypeOf<
			Parameters<typeof createFolderLoader>[1]
		>()
		expectTypeOf<PagesClient>().toMatchTypeOf<
			Parameters<typeof createFolderLoader>[1]
		>()
		expectTypeOf<SanityClient>().toMatchTypeOf<
			Parameters<typeof loadRedirectSnapshot>[0]
		>()
		expectTypeOf<PagesClient>().toMatchTypeOf<
			Parameters<typeof loadRedirectSnapshot>[0]
		>()
	})

	it('feeds loaded public routes to folder planning and redirect destination checks', async () => {
		const io = transport()
		const before = structuredClone(io.documents)
		const settings = await createCollectionRoutingLoader(
			config,
			io.client,
		).load({ perspective: 'published' })
		if (!settings.ok) throw new Error(settings.reason)
		const url = settings.value.resolveUrl(post)
		if (!url.ok) throw new Error(url.reason)
		const folders = await createFolderLoader(
			{ routes: settings.value.routes },
			io.client,
		)({ readAccess: 'all-registered-versions' })
		if (folders.status !== 'loaded') throw new Error(folders.reason)
		const plan = createFolderPlanner({
			routes: settings.value.routes,
		}).planSynchronize(
			folders.snapshot.registry,
			folders.snapshot.inventory,
			() => 'about-key',
		)
		expect(plan).toMatchObject({
			ok: true,
			value: { added: [{ _key: 'about-key', pathname: '/about' }] },
		})
		const redirects = await loadRedirectSnapshot(io.client, {
			destinations: [url.value.pathname],
			occupiedPaths: [url.value.pathname],
		})
		if (!redirects.ok) throw new Error(redirects.reason)
		expect(redirects.value.match('/old/story')).toEqual({
			kind: 'redirect',
			location: '/journal/story',
			status: 301,
		})
		expect(io.documents).toEqual(before)
	})

	it('loads preview prefixes separately without changing a previously loaded public context', async () => {
		const io = transport()
		const loader = createCollectionRoutingLoader(config, io.client)
		const publicContext = await loader.load({ perspective: 'published' })
		const previewContext = await loader.load({
			perspective: 'drafts',
			draftVisibility: 'all-required-drafts',
		})
		if (!publicContext.ok || !previewContext.ok)
			throw new Error('Expected both contexts')
		expect(publicContext.value.resolveUrl(post)).toMatchObject({
			ok: true,
			value: { pathname: '/journal/story' },
		})
		expect(previewContext.value.resolveUrl(post)).toMatchObject({
			ok: true,
			value: { pathname: '/blog/story' },
		})
		const overview = { ...page, pathname: { current: '/insights' } }
		for (const context of [publicContext, previewContext])
			expect(context.value.resolveUrl(overview)).toMatchObject({
				ok: true,
				value: { pathname: '/insights' },
			})
	})
})
