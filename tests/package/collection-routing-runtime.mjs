/** Runtime checks execute only from the installed package; no source aliases. */
import assert from 'node:assert/strict'
import { createCollectionRouting } from '@standard-design/sanity-kit/url'

const config = {
	pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
	collections: [
		{
			name: 'journal',
			title: 'Journal',
			settingsDocumentId: 'journal-settings',
			index: { schemaType: 'page', pathname: '/journal' },
			routePrefix: { mode: 'default', value: '/journal' },
			items: [{ schemaType: 'post', slugField: 'slug.current' }],
		},
	],
}
const published = {
	_id: 'journal-settings',
	_rev: 'published-1',
	_type: 'sanityKitCollectionRoute',
	collection: 'journal',
	prefix: { _type: 'slug', current: '/journal' },
}
const draft = {
	...published,
	_id: 'drafts.journal-settings',
	_rev: 'draft-1',
	prefix: { _type: 'slug', current: '/blog' },
}
const article = { _type: 'post', slug: { current: 'first-post' } }
const snapshot = {
	status: 'available',
	perspective: 'raw',
	coverage: 'published-and-drafts',
	complete: true,
	documents: [published, draft],
}
const routing = createCollectionRouting(config)
function expectUrl(result, prefix) {
	assert.equal(result.ok, true)
	assert.deepEqual(result.value.resolveUrl(article), {
		ok: true,
		value: { pathname: `${prefix}/first-post`, prefix, slug: 'first-post' },
	})
	assert.deepEqual(
		result.value.resolveUrl({ _type: 'page', pathname: { current: '/' } }),
		{ ok: true, value: { pathname: '/', prefix: '/', slug: '' } },
	)
}
expectUrl(routing.resolve(snapshot, 'published'), '/journal')
expectUrl(routing.resolve(snapshot, 'drafts'), '/blog')
assert.equal(
	routing.resolve({ ...snapshot, documents: [] }, 'published').reason,
	'settings-missing',
	'A configured default must not become a fallback live prefix.',
)
assert.equal(
	routing.resolve({ ...snapshot, coverage: 'published' }, 'drafts').reason,
	'settings-unavailable',
)
assert.equal(
	routing.resolve({ ...snapshot, complete: false }, 'published').reason,
	'settings-unavailable',
)
assert.equal(
	routing.resolve(snapshot, 'release-one').reason,
	'unsupported-perspective',
)
assert.equal(
	routing.resolve(
		{ ...snapshot, documents: [published, published] },
		'published',
	).reason,
	'settings-ambiguous',
)
await assert.rejects(
	import('@standard-design/sanity-kit/url/settings/resolve.js'),
	{ code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' },
)

if (process.argv.includes('--settings')) {
	const { createCollectionRoutingLoader } =
		await import('@standard-design/sanity-kit/url/settings')
	let rows = [published, draft]
	let calls = []
	let fail = false
	let afterRead
	const client = {
		withConfig(clientConfig) {
			assert.equal(clientConfig.perspective, 'raw')
			assert.equal(clientConfig.useCdn, false)
			assert.equal(clientConfig.stega, false)
			return {
				async fetch(query, params, options) {
					assert.match(query, /\*\[_id in \$ids\]/u)
					calls.push(params.ids)
					assert.equal(options.cache, 'no-store')
					assert.equal(options.perspective, 'raw')
					if (fail) throw new Error('Test read failed')
					afterRead?.()
					return rows.filter((row) => params.ids.includes(row._id))
				},
			}
		},
	}
	const loader = createCollectionRoutingLoader(config, client)
	assert.deepEqual(await loader.load({ perspective: 'drafts' }), {
		ok: false,
		reason: 'access-unconfirmed',
	})
	assert.equal(calls.length, 0)
	expectUrl(await loader.load({ perspective: 'published' }), '/journal')
	assert.deepEqual(calls.at(-1), ['journal-settings'])
	expectUrl(
		await loader.load({
			perspective: 'drafts',
			draftVisibility: 'all-required-drafts',
		}),
		'/blog',
	)
	calls = []
	const pair = await loader.loadBoth({ draftVisibility: 'all-required-drafts' })
	assert.equal(pair.ok, true)
	expectUrl({ ok: true, value: pair.published }, '/journal')
	expectUrl({ ok: true, value: pair.drafts }, '/blog')
	assert.deepEqual(calls, [['journal-settings', 'drafts.journal-settings']])
	rows = []
	assert.equal(
		(await loader.load({ perspective: 'published' })).reason,
		'settings-missing',
	)
	rows = [published, published]
	assert.equal(
		(await loader.load({ perspective: 'published' })).reason,
		'invalid-response',
	)
	rows = [{ ...published, prefix: { _type: 'slug', current: '/bad/' } }]
	assert.equal(
		(await loader.load({ perspective: 'published' })).reason,
		'settings-invalid',
	)
	fail = true
	assert.equal(
		(await loader.load({ perspective: 'published' })).reason,
		'request-failed',
	)
	fail = false
	rows = [published]
	const abort = new globalThis.AbortController()
	abort.abort()
	calls = []
	assert.equal(
		(await loader.load({ perspective: 'published', signal: abort.signal }))
			.reason,
		'aborted',
	)
	assert.equal(calls.length, 0)
	const lateAbort = new globalThis.AbortController()
	afterRead = () => lateAbort.abort()
	assert.equal(
		(await loader.load({ perspective: 'published', signal: lateAbort.signal }))
			.reason,
		'aborted',
	)
	afterRead = undefined
	calls = []
	const locked = createCollectionRoutingLoader(
		{
			...config,
			collections: [{ ...config.collections[0], routePrefix: '/fixed' }],
		},
		client,
	)
	expectUrl(await locked.load({ perspective: 'published' }), '/fixed')
	assert.equal(
		calls.length,
		0,
		'Code-locked prefixes require no settings read.',
	)
}
console.log('PASS collection-routing public runtime contracts')
