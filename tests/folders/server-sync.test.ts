import { createClient } from '@sanity/client'
import { build } from 'esbuild'
import { evaluate, parse } from 'groq-js'
import { describe, expect, it, vi } from 'vitest'
import {
	createFolderSynchronizer,
	type FolderSyncClient,
} from '../../src/folders/server/index.js'

type Row = Record<string, unknown>
const routes = {
	pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
}
const page = (path = '/about/team'): Row => ({
	_id: 'drafts.team',
	_type: 'page',
	_rev: 'page-rev',
	pathname: { current: path },
})
const registry = (): Row => ({
	_id: 'sanityKit.folders',
	_type: 'sanityKitFolderRegistry',
	_rev: 'registry-rev',
	schemaVersion: 1,
	folders: [{ _key: 'kept', pathname: '/existing', custom: 'retain this' }],
	custom: { keep: true },
})
type Mutation = {
	create?: Row
	patch?: { id: string; ifRevisionID: string; insert: { items: Row[] } }
}

/** Real access checker, GROQ loader, planner and writer; only transport is replaced. */
function io(initial: Row[] = [page()]) {
	const rows = structuredClone(initial)
	let reads = rows
	let grants: unknown = [{ filter: 'true', permissions: ['read'] }]
	let next: 'delay' | 'lost-after' | 'lost-before' | 'denied' | undefined
	let resume: (() => void) | undefined
	const writes: Mutation[] = []
	let commits = 0
	const commit = (mutation: Mutation) => {
		const existing = rows.find((row) => row._id === 'sanityKit.folders')
		if (mutation.create) {
			if (existing)
				throw Object.assign(new Error('Conflict'), { statusCode: 409 })
			rows.push({
				...structuredClone(mutation.create),
				_rev: `revision-${++commits}`,
			})
		} else {
			const patch = mutation.patch!
			if (!existing || existing._rev !== patch.ifRevisionID)
				throw Object.assign(new Error('Conflict'), { statusCode: 409 })
			existing.folders = [
				...(existing.folders as Row[]),
				...structuredClone(patch.insert.items),
			]
			existing._rev = `revision-${++commits}`
		}
		return {
			transactionId: `transaction-${commits}`,
			results: [
				{
					id: 'sanityKit.folders',
					operation: mutation.create ? 'create' : 'update',
				},
			],
		}
	}
	const request = vi.fn<ReturnType<FolderSyncClient['withConfig']>['request']>(
		async (options) => {
			if (options.url.endsWith('/acl')) return grants
			expect(options).toMatchObject({
				method: 'POST',
				maxRetries: 0,
				fetch: { cache: 'no-store' },
			})
			const mutation = (options.body as { mutations: Mutation[] }).mutations[0]!
			writes.push(structuredClone(mutation))
			const mode = next
			next = undefined
			if (mode === 'delay')
				return new Promise((resolve, reject) => {
					resume = () => {
						try {
							resolve(commit(mutation))
						} catch (error) {
							reject(
								error instanceof Error
									? error
									: new Error('Unexpected mutation failure'),
							)
						}
					}
				})
			if (mode === 'denied')
				throw Object.assign(new Error('Denied'), { statusCode: 403 })
			if (mode === 'lost-before') throw new Error('Disconnected')
			const result = commit(mutation)
			if (mode === 'lost-after') throw new Error('Lost acknowledgment')
			return result
		},
	)
	const fetch = vi.fn<ReturnType<FolderSyncClient['withConfig']>['fetch']>(
		async (query, params) =>
			(
				await evaluate(parse(query), { dataset: reads, params })
			).get() as Promise<unknown>,
	)
	const scope = { projectId: 'proof123', dataset: 'development' }
	const client: FolderSyncClient = {
		withConfig: () => ({ config: () => scope, fetch, request }),
	}
	return {
		rows,
		scope,
		request,
		fetch,
		writes,
		service: () => createFolderSynchronizer(routes, client),
		mode: (value: typeof next) => {
			next = value
		},
		grants: (value: unknown) => {
			grants = value
		},
		readFrom: (value: Row[]) => {
			reads = value
		},
		resume: () => resume!(),
		commits: () => commits,
		folders: () =>
			rows.find((row) => row._id === 'sanityKit.folders')?.folders as
				Row[] | undefined,
	}
}

describe('public folder import convergence', () => {
	it('only exposes explicit synchronization and retains existing metadata and page content', async () => {
		const t = io([page(), registry()])
		const beforePage = structuredClone(t.rows[0])
		const service = t.service()
		expect(Object.keys(service)).toEqual(['synchronize'])
		expect(t.request).not.toHaveBeenCalled()
		expect(await service.synchronize()).toEqual({
			status: 'synced',
			count: 1,
			evidence: 'write-confirmed',
		})
		expect(t.folders()).toContainEqual({
			_key: 'kept',
			pathname: '/existing',
			custom: 'retain this',
		})
		expect(t.rows[1]?.custom).toEqual({ keep: true })
		expect(t.rows[0]).toEqual(beforePage)
		expect(await service.synchronize()).toEqual({
			status: 'synced',
			count: 0,
			evidence: 'already-present',
		})
		expect(t.writes).toHaveLength(1)
	})
	it.each(['create', 'append'] as const)(
		'a delayed %s loses its guard after a restarted job synchronizes',
		async (kind) => {
			const t = io(kind === 'create' ? [page()] : [page(), registry()])
			t.mode('delay')
			const older = t.service().synchronize()
			await vi.waitFor(() => expect(t.writes).toHaveLength(1))
			expect(await t.service().synchronize()).toMatchObject({
				status: 'synced',
				evidence: 'write-confirmed',
			})
			const completed = structuredClone(t.rows)
			t.resume()
			expect(await older).toEqual({ status: 'blocked', reason: 'conflict' })
			expect(t.rows).toEqual(completed)
			expect(t.commits()).toBe(1)
			expect(
				t.folders()!.filter((folder) => folder.pathname === '/about'),
			).toHaveLength(1)
		},
	)
	it.each(['create', 'append'] as const)(
		'a stale read after lost %s acknowledgment cannot duplicate paths',
		async (kind) => {
			const initial = kind === 'create' ? [page()] : [page(), registry()]
			const t = io(initial)
			t.mode('lost-after')
			expect(await t.service().synchronize()).toMatchObject({
				status: 'outcome-unknown',
			})
			t.readFrom(structuredClone(initial))
			expect(await t.service().synchronize()).toEqual({
				status: 'blocked',
				reason: 'conflict',
			})
			t.readFrom(t.rows)
			expect(await t.service().synchronize()).toEqual({
				status: 'synced',
				count: 0,
				evidence: 'already-present',
			})
			expect(t.writes).toHaveLength(2)
			expect(t.commits()).toBe(1)
		},
	)
	it('replans on an explicit later call after an unknown attempt without claiming its result', async () => {
		const t = io()
		const service = t.service()
		t.mode('lost-before')
		expect(await service.synchronize()).toEqual({
			status: 'outcome-unknown',
			reason: 'request-failed',
		})
		expect(t.writes).toHaveLength(1)
		t.rows[0] = page('/new/team')
		expect(await service.synchronize()).toEqual({
			status: 'synced',
			count: 1,
			evidence: 'write-confirmed',
		})
		expect(t.folders()!.map((folder) => folder.pathname)).toEqual(['/new'])
		expect(t.writes[1]).not.toEqual(t.writes[0])
	})
	it('an old append after an unchanged sync can only preserve an empty former folder', async () => {
		const t = io([page(), registry()])
		t.mode('delay')
		const older = t.service().synchronize()
		await vi.waitFor(() => expect(t.writes).toHaveLength(1))
		t.rows[0] = page('/existing/team')
		expect(await t.service().synchronize()).toMatchObject({
			status: 'synced',
			evidence: 'already-present',
		})
		t.resume()
		expect(await older).toMatchObject({
			status: 'synced',
			evidence: 'write-confirmed',
		})
		expect(t.folders()!.map((folder) => folder.pathname)).toEqual([
			'/existing',
			'/about',
		])
		expect(t.rows[0]).toEqual(page('/existing/team'))
	})
	it.each([
		{ grants: [], expected: 'missing' },
		{
			grants: [{ filter: 'owner == identity()', permissions: ['read'] }],
			expected: 'unverified',
		},
	])(
		'refuses missing or unverified visibility before reading content: %o',
		async ({ grants, expected }) => {
			const t = io()
			t.grants(grants)
			const result = await t.service().synchronize()
			expect(result).toMatchObject({
				status: 'blocked',
				reason: 'unknown-read-access',
			})
			if (result.status !== 'blocked')
				throw new Error('Expected a blocked result')
			expect(result.accessIssues?.length).toBeGreaterThan(0)
			expect(
				result.accessIssues?.every((issue) => issue.status === expected),
			).toBe(true)
			expect(t.fetch).not.toHaveBeenCalled()
			expect(t.writes).toHaveLength(0)
		},
	)
	it('rechecks grants on every call and leaves server write rejection explicit', async () => {
		const t = io()
		const service = t.service()
		t.mode('denied')
		expect(await service.synchronize()).toEqual({
			status: 'blocked',
			reason: 'permission-denied',
		})
		t.grants([])
		expect(await service.synchronize()).toMatchObject({
			status: 'blocked',
			reason: 'unknown-read-access',
		})
		expect(t.writes).toHaveLength(1)
	})
	it('checks cancellation and changed client scope before sending work', async () => {
		const t = io()
		const service = t.service()
		expect(await service.synchronize(AbortSignal.abort())).toEqual({
			status: 'blocked',
			reason: 'aborted',
		})
		t.scope.dataset = 'another'
		expect(await service.synchronize()).toEqual({
			status: 'blocked',
			reason: 'scope-changed',
		})
		expect(t.request).not.toHaveBeenCalled()
	})
	it('accepts the real application SDK type without a Studio peer', () => {
		const client = createClient({
			projectId: 'proof123',
			dataset: 'development',
			apiVersion: '2026-10-01',
		})
		expect(Object.keys(createFolderSynchronizer(routes, client))).toEqual([
			'synchronize',
		])
	})
	it('bundles without Studio, React, or a framework runtime', async () => {
		const result = await build({
			entryPoints: ['src/folders/server/index.ts'],
			bundle: true,
			write: false,
			platform: 'node',
			format: 'esm',
			metafile: true,
		})
		expect(
			Object.keys(result.metafile.inputs).some((path) =>
				/node_modules\/(sanity|react|react-router|@sanity\/ui)\//u.test(path),
			),
		).toBe(false)
	})
})
