/**
 * Explicit, one-time fixture setup; never called by build, test, or Studio startup.
 * Run through `sanity exec seed.ts --with-user-token` only in an authorized test
 * dataset. Refuse to overwrite existing fixtures and let Sanity generate all IDs.
 */
import { getCliClient } from 'sanity/cli'

const client = getCliClient({ apiVersion: '2026-10-01' }).withConfig({
	useCdn: false,
})
const types = [
	'kitProofPage',
	'kitProofPost',
	'kitProofLanding',
	'kitProofShared',
]
const existing = await client.fetch<number>(
	'count(*[_type in $types])',
	{ types },
	{ perspective: 'raw' },
)
if (existing)
	throw new Error(
		'Fixture documents already exist. Reuse them; this script does not overwrite or delete data.',
	)

const shared = await client.create({
	_type: 'kitProofShared',
	title: 'Pages proof shared footer',
	body: 'Shared content can be edited without losing the previewed page.',
})
console.log(`Created shared fixture: ${shared._id}`)
for (const [title, path] of [
	['Home', '/'],
	['About', '/about'],
	['Team', '/about/team'],
	['Journal', '/journal'],
]) {
	const document = await client.create({
		_type: 'kitProofPage',
		title: `Pages proof: ${title}`,
		pathname: { _type: 'slug', current: path },
		body: `The ${title} page is isolated Pages-plugin test content.`,
		shared: { _type: 'reference', _ref: shared._id },
	})
	console.log(`Created page fixture: ${document._id}`)
}
for (let index = 1; index <= 8; index += 1) {
	const document = await client.create({
		_type: 'kitProofPost',
		title: `Pages proof: Post ${index}`,
		pathname: { _type: 'slug', current: `/journal/post-${index}` },
		body: 'Collection test content. The first integration slice uses a flat list.',
		shared: { _type: 'reference', _ref: shared._id },
	})
	console.log(`Created post fixture: ${document._id}`)
}
const alternate = await client.create({
	_type: 'kitProofLanding',
	title: 'Pages proof: Alternate mapping',
	route: '/alternate',
	body: 'This document uses route rather than pathname.current.',
})
console.log(`Created alternate-path fixture: ${alternate._id}`)
