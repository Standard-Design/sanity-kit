import { evaluate, parse } from 'groq-js'
import { describe, expect, it } from 'vitest'
import { checkUrlReadAccess } from '../../src/studio/url/access.js'

const routes = {
	pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
}
const read = (filter: string) => ({ filter, permissions: ['read'] })
const metadata = read('_id in path("sanityKit.**")')
const pages = read('_type == "page"')
const redirects = read('_type == "sanityKitRedirect"')
const check = (grants: unknown, operation: 'edit' | 'publish' = 'edit') =>
	checkUrlReadAccess(routes, grants, operation)

describe('URL read access evidence', () => {
	it.each(['true', '_id in path("**")'])(
		'accepts complete effective grants: %s',
		(filter) => {
			expect(check([read(filter)], 'publish')).toEqual({ ok: true, issues: [] })
		},
	)
	it('combines type and metadata grants without requiring unrelated content', () => {
		expect(check([pages, metadata])).toEqual({ ok: true, issues: [] })
		expect(check([pages, metadata, redirects], 'publish')).toEqual({
			ok: true,
			issues: [],
		})
		expect(
			check([pages, metadata], 'publish').issues.map((issue) => issue.key),
		).toEqual([
			'sanityKitRedirect:published',
			'sanityKitRedirect:drafts',
			'sanityKitRedirect:releases',
		])
	})
	it('combines grants covering different document versions', () => {
		const published = read(
			'_type == "page" && !(_id in path("drafts.**")) && !(_id in path("versions.**"))',
		)
		const drafts = read('_type == "page" && _id in path("drafts.**")')
		const releases = read('_type == "page" && _id in path("versions.**")')
		expect(check([published, drafts, releases, metadata]).ok).toBe(true)
		expect(check([published, releases, metadata]).issues).toEqual([
			{
				key: 'page:drafts',
				label: 'Read all page documents — drafts',
				status: 'missing',
			},
		])
	})
	it('requires exact registry access even if its stored type is malformed', () => {
		expect(check([pages, read('_id == "sanityKit.folders"')]).ok).toBe(true)
		expect(
			check([pages, read('_type == "sanityKitFolderRegistry"')]).issues,
		).toEqual([
			expect.objectContaining({ key: 'folder-registry', status: 'unverified' }),
		])
	})
	it('requires the complete recovery namespace, independent of receipt type', () => {
		const base = [pages, redirects, read('_id == "sanityKit.folders"')]
		expect(
			check(
				[...base, read('_id in path("sanityKit.urlPublication.**")')],
				'publish',
			).ok,
		).toBe(true)
		expect(
			check([...base, read('_type == "sanityKitUrlPublication"')], 'publish')
				.issues,
		).toEqual([
			expect.objectContaining({
				key: 'publication-receipts',
				status: 'unverified',
			}),
		])
	})
	it.each([
		'_type in ["page", "other"]',
		'"page" == _type',
		'!(_type != "page")',
		'(_type == "page" && true) || false',
	])('recognizes equivalent supported type predicates: %s', (filter) => {
		expect(check([read(filter), metadata]).ok).toBe(true)
	})
	it.each([
		'owner == "me"',
		'_type == "page" && owner == "me"',
		'_id in path("drafts.my-pages.**")',
		'_id in path("versions.*.**")',
		'_id == "a-known-page"',
		'_type == $type',
		'defined(_type)',
		'!null',
		'!42',
		'!"x"',
		'!(_type == null)',
	])(
		'does not assume a partial or unsupported grant covers every document: %s',
		(filter) => {
			const result = check([read(filter)])
			expect(result.ok).toBe(false)
			expect(result.issues.some((issue) => issue.status === 'unverified')).toBe(
				true,
			)
		},
	)
	it.each([
		null,
		{},
		[{ filter: 'true' }],
		[read('this is not groq')],
		[read(' '.repeat(8193))],
		Array.from({ length: 257 }, () => read('true')),
		[read('('.repeat(70) + 'true' + ')'.repeat(70))],
	])('treats malformed or oversized evidence as unverified', (grants) => {
		expect(
			check(grants).issues.every((issue) => issue.status === 'unverified'),
		).toBe(true)
		expect(check(grants).ok).toBe(false)
	})
	it('ignores write grants and reports known missing scopes', () => {
		expect(
			check([{ filter: 'true', permissions: ['update'] }]).issues.every(
				(issue) => issue.status === 'missing',
			),
		).toBe(true)
	})
	it('allows proven coverage alongside malformed or unsupported grants', () => {
		expect(check([read('true'), read('malformed(')]).ok).toBe(true)
		expect(check([read('true || owner == "me"')]).ok).toBe(true)
		expect(
			check([read('false && owner == "me"')]).issues.every(
				(issue) => issue.status === 'missing',
			),
		).toBe(true)
	})
	it('agrees with real GROQ for representative documents whenever it proves complete coverage', async () => {
		const documents = [
			{ _id: 'page-1', _type: 'page' },
			{ _id: 'drafts.page-1', _type: 'page' },
			{ _id: 'versions.release.page-1', _type: 'page' },
			{ _id: 'versions.malformed', _type: 'page' },
			{ _id: 'sanityKit.folders', _type: 'malformed-registry' },
		]
		const atoms = [
			'true',
			'false',
			'null',
			'42',
			'"x"',
			'_type == "page"',
			'_id in path("drafts.**")',
			'_id in path("versions.**")',
			'_id in path("**")',
			'_id == "sanityKit.folders"',
			'owner == "me"',
		]
		const filters = [
			...atoms,
			...atoms.map((atom) => `!(${atom})`),
			...atoms.flatMap((left) =>
				atoms.flatMap((right) => [
					`(${left}) || (${right})`,
					`(${left}) && (${right})`,
				]),
			),
		]
		for (const filter of filters) {
			if (!check([read(filter)]).ok) continue
			for (const document of documents) {
				const actual: unknown = await (
					await evaluate(parse(filter), { root: document })
				).get()
				expect(actual, `${filter} for ${document._id}`).toBe(true)
			}
		}
	})
})
