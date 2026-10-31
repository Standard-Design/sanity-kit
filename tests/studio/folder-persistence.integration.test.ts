import { createClient, type SanityClient } from '@sanity/client'
import { evaluate, parse } from 'groq-js'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { createFolderWriter } from '../../src/studio/folders/write.js'
import type { PagesClient } from '../../src/studio/pages/data-source.js'
import type { PagesRouteConfig } from '../../src/url/registry.js'

const routes = {
	pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
} satisfies PagesRouteConfig
const access = { readAccess: 'all-registered-versions' } as const
type Document = Record<string, unknown> & { _id: string; _rev: string }
const registry = (): Document => ({
	_id: 'sanityKit.folders',
	_type: 'sanityKitFolderRegistry',
	_rev: 'registry-v1',
	schemaVersion: 1,
	folders: [{ _key: 'about-key', pathname: '/about', color: 'blue' }],
	custom: { instruction: 'Preserve this metadata' },
})
const page = (_id: string, pathname: string): Document => ({
	_id,
	_type: 'page',
	_rev: `revision-${_id}`,
	pathname: { _type: 'slug', current: pathname },
	body: 'The writer must not touch page content.',
})
const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	})

/**
 * An offline Content Lake boundary: the real SDK sends queries and mutations,
 * GROQ evaluates reads, and this deliberately small mutation model applies only
 * create and revision-guarded append. Unexpected operations fail the test.
 */
function lake(initial: Document[]) {
	const documents = structuredClone(initial)
	const mutationBodies: Record<string, unknown>[] = []
	let beforeMutation: (() => void) | undefined
	const fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
		const url = new URL(String(input))
		if (url.pathname.includes('/data/query/')) {
			const params: Record<string, unknown> = {}
			let query = url.searchParams.get('query')
			for (const [key, value] of url.searchParams)
				if (key.startsWith('$')) params[key.slice(1)] = JSON.parse(value)
			if (init?.body) {
				if (typeof init.body !== 'string')
					throw new Error('Expected a JSON body')
				const body = JSON.parse(init.body) as {
					query: string
					params: Record<string, unknown>
				}
				query = body.query
				Object.assign(params, body.params)
			}
			if (!query) throw new Error('Expected a GROQ query')
			const evaluated = await evaluate(parse(query), {
				dataset: documents,
				params,
			})
			const result: unknown = await evaluated.get()
			return json({ result })
		}
		if (!url.pathname.includes('/data/mutate/'))
			throw new Error(`Unexpected offline request: ${url.pathname}`)
		expect(url.searchParams.get('visibility')).toBe('sync')
		expect(url.searchParams.get('returnDocuments')).toBe('false')
		expect(url.searchParams.get('returnIds')).toBe('true')
		expect(url.searchParams.get('autoGenerateArrayKeys')).toBe('false')
		if (typeof init?.body !== 'string') throw new Error('Expected a JSON body')
		const body = JSON.parse(init.body) as {
			mutations: Record<string, unknown>[]
		}
		mutationBodies.push(body)
		beforeMutation?.()
		expect(body.mutations).toHaveLength(1)
		const mutation = body.mutations[0]!
		let operation: 'create' | 'update'
		if ('create' in mutation) {
			const created = mutation.create as Document
			if (documents.some((document) => document._id === created._id))
				return json(
					{ error: { type: 'mutationError', description: 'Document exists' } },
					409,
				)
			documents.push({ ...structuredClone(created), _rev: 'registry-created' })
			operation = 'create'
		} else {
			expect(Object.keys(mutation)).toEqual(['patch'])
			const patch = mutation.patch as {
				id: string
				ifRevisionID: string
				setIfMissing?: { folders: unknown[] }
				insert: { after: string; items: unknown[] }
			}
			const current = documents.find((document) => document._id === patch.id)
			if (!current || current._rev !== patch.ifRevisionID)
				return json(
					{ error: { type: 'mutationError', description: 'Revision changed' } },
					409,
				)
			// Refuse replacements: metadata preservation must result from the real
			// emitted mutation, not from accommodating it in the fake server.
			expect(Object.keys(patch).sort()).toEqual(
				[
					'id',
					'ifRevisionID',
					'insert',
					...(patch.setIfMissing ? ['setIfMissing'] : []),
				].sort(),
			)
			expect(patch.insert.after).toBe('folders[-1]')
			if (patch.setIfMissing)
				expect(patch.setIfMissing).toEqual({ folders: [] })
			current.folders = [
				...(current.folders as unknown[]),
				...structuredClone(patch.insert.items),
			]
			current._rev = `registry-updated-${mutationBodies.length}`
			operation = 'update'
		}
		return json({
			transactionId: `transaction-${mutationBodies.length}`,
			results: [{ id: 'sanityKit.folders', operation }],
		})
	})
	const client = createClient({
		projectId: 'test1234',
		dataset: 'test',
		apiVersion: '2025-02-19',
		useCdn: true,
		perspective: 'drafts',
		resolveFetch: () => fetch,
	})
	return {
		client,
		documents,
		fetch,
		mutationBodies,
		beforeMutation(callback: () => void) {
			beforeMutation = callback
		},
	}
}

describe('folder persistence through the native Sanity client', () => {
	it('accepts both application and Studio clients', () => {
		expectTypeOf<SanityClient>().toMatchTypeOf<
			Parameters<typeof createFolderWriter>[1]
		>()
		expectTypeOf<PagesClient>().toMatchTypeOf<
			Parameters<typeof createFolderWriter>[1]
		>()
	})

	it('adopts all raw page versions once while preserving unrelated registry and page metadata', async () => {
		const pages = [
			page('team', '/about/company/team'),
			page('drafts.team', '/draft/company/team'),
			page('versions.launch.team', '/launch/company/team'),
		]
		const io = lake([registry(), ...pages])
		const writer = createFolderWriter({ routes }, io.client)
		expect(await writer.synchronize(access)).toMatchObject({
			status: 'written',
		})
		const saved = io.documents.find(
			(document) => document._id === 'sanityKit.folders',
		)!
		expect(saved.custom).toEqual(registry().custom)
		expect((saved.folders as Record<string, unknown>[])[0]).toEqual(
			(registry().folders as unknown[])[0],
		)
		expect(
			(saved.folders as Record<string, unknown>[])
				.map((folder) => folder.pathname)
				.sort(),
		).toEqual([
			'/about',
			'/about/company',
			'/draft',
			'/draft/company',
			'/launch',
			'/launch/company',
		])
		expect(
			io.documents.filter((document) => document._type === 'page'),
		).toEqual(pages)
		expect(io.mutationBodies).toHaveLength(1)
		expect(await writer.synchronize(access)).toEqual({
			status: 'unchanged',
			added: [],
		})
		expect(io.mutationBodies).toHaveLength(1)
	})

	it('keeps adopted folders after their last page moves away', async () => {
		const io = lake([registry(), page('team', '/about/company/team')])
		const writer = createFolderWriter({ routes }, io.client)
		expect(await writer.synchronize(access)).toMatchObject({
			status: 'written',
		})
		const saved = structuredClone(io.documents[0])
		io.documents[1]!.pathname = { current: '/team' }
		io.documents[1]!._rev = 'page-moved'
		expect(await writer.synchronize(access)).toEqual({
			status: 'unchanged',
			added: [],
		})
		expect(io.documents[0]).toEqual(saved)
		expect(io.mutationBodies).toHaveLength(1)
	})

	it('creates a single registry with the requested folder ancestors', async () => {
		const io = lake([])
		expect(
			await createFolderWriter({ routes }, io.client).create({
				...access,
				pathname: '/about/company/team',
			}),
		).toMatchObject({ status: 'written' })
		expect(io.documents).toHaveLength(1)
		expect(io.documents[0]).toMatchObject({
			_id: 'sanityKit.folders',
			_type: 'sanityKitFolderRegistry',
			schemaVersion: 1,
			folders: [
				{ pathname: '/about' },
				{ pathname: '/about/company' },
				{ pathname: '/about/company/team' },
			],
		})
		expect(io.mutationBodies).toHaveLength(1)
	})

	it('does not replace a registry created after the initial absent read', async () => {
		const io = lake([])
		io.beforeMutation(() => io.documents.push(registry()))
		const result = await createFolderWriter({ routes }, io.client).create({
			...access,
			pathname: '/company',
		})
		expect(result).toMatchObject({ status: 'rejected', reason: 'conflict' })
		expect(io.documents).toEqual([registry()])
		expect(io.mutationBodies).toHaveLength(1)
	})

	it('does not overwrite a concurrent registry change or retry against its new revision', async () => {
		const io = lake([registry(), page('team', '/about/company/team')])
		io.beforeMutation(() => {
			io.documents[0]!._rev = 'concurrent-revision'
			io.documents[0]!.custom = { instruction: 'Changed concurrently' }
		})
		const result = await createFolderWriter({ routes }, io.client).synchronize(
			access,
		)
		expect(result).toMatchObject({ status: 'rejected', reason: 'conflict' })
		expect(io.mutationBodies).toHaveLength(1)
		expect(io.documents[0]).toMatchObject({
			_rev: 'concurrent-revision',
			custom: { instruction: 'Changed concurrently' },
			folders: registry().folders,
		})
	})
})
