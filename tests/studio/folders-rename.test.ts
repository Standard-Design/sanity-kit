import { describe, expect, it } from 'vitest'
import {
	createFolderRenamePlanner,
	FOLDER_RENAME_LIMITS,
	type FolderRenameRequest,
} from '../../src/studio/folders/rename.js'
import {
	planBulkRedirects,
	type BulkRedirectRequest,
} from '../../src/studio/folders/rename-redirects.js'

const routes = {
	pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
}
const planner = createFolderRenamePlanner({ routes })
const page = (id: string, path: unknown) => ({
	_id: id,
	_type: 'page',
	_rev: `rev-${id}`,
	title: 'Unpublished text stays untouched',
	pathname: { current: path, custom: 'keep' },
	body: [{ text: 'keep' }],
})
const redirect = (
	id: string,
	source = '/old-team',
	destination = '/about/team',
) => ({
	_id: id,
	_type: 'sanityKitRedirect',
	_rev: `rev-${id}`,
	enabled: true,
	source,
	destination,
	status: 301,
	origin: 'manual',
})
function request(): FolderRenameRequest {
	const documents = [
		page('about', '/about'),
		page('team', '/about/team'),
		page('drafts.team', '/about/team'),
		page('drafts.new', '/about/new'),
		page('elsewhere', '/other'),
	]
	return {
		pathname: '/about',
		newName: 'company',
		registry: {
			_id: 'sanityKit.folders',
			_type: 'sanityKitFolderRegistry',
			_rev: 'f1',
			schemaVersion: 1,
			custom: 'keep',
			folders: [
				{ _key: 'about', pathname: '/about', custom: 'retain' },
				{ _key: 'nested', pathname: '/about/empty' },
				{ _key: 'other', pathname: '/other' },
			],
		},
		inventory: {
			perspective: 'raw',
			complete: true,
			readAccess: 'all-required-versions',
			documents,
			redirects: [redirect('alias')],
		},
		writableDocumentIds: [
			'sanityKit.folders',
			...documents.map((value) => value._id),
			'alias',
		],
		protectedDocumentIds: [],
		createRedirects: true,
	}
}
function plan(overrides: Partial<FolderRenameRequest> = {}) {
	return planner.plan({ ...request(), ...overrides })
}
function bulk(overrides: Partial<BulkRedirectRequest> = {}) {
	return planBulkRedirects({
		moves: [
			{ oldPathname: '/a', newPathname: '/b' },
			{ oldPathname: '/c', newPathname: '/d' },
		],
		createRedirects: true,
		inventory: {
			perspective: 'raw',
			complete: true,
			records: [
				redirect('alias-a', '/old-a', '/a'),
				redirect('alias-c', '/old-c', '/c'),
			],
		},
		occupiedPathsBefore: ['/a', '/c'],
		occupiedPathsAfter: ['/b', '/d'],
		destinationsBefore: ['/a', '/c'],
		destinationsAfter: ['/b', '/d'],
		...overrides,
	})
}
describe('pure folder rename review', () => {
	it('bounds review size separately from the future transaction request', () => {
		const input = request()
		const documents = [
			page('about', '/about'),
			{
				...page('unchanged', '/outside'),
				_rev: 'r'.repeat(FOLDER_RENAME_LIMITS.reviewBytes),
			},
		]
		expect(
			plan({ inventory: { ...input.inventory, documents, redirects: [] } }),
		).toMatchObject({ ok: false, reason: 'limit-exceeded' })
	})
	it('rebuilds the proposal from new versions instead of treating the first result as write authorization', () => {
		const input = request()
		expect(planner.plan(input)).toMatchObject({ ok: true })
		const later = {
			...input,
			inventory: {
				...input.inventory,
				documents: [
					...input.inventory.documents,
					page('versions.new.team', '/about/team'),
				],
			},
		}
		expect(planner.plan(later)).toMatchObject({
			ok: false,
			reason: 'release-version',
		})
	})

	it('keeps folder keys, patches URL fields only, and retains complete version review evidence', () => {
		const input = request(),
			original = structuredClone(input)
		const result = planner.plan(input)
		expect(result.ok).toBe(true)
		if (!result.ok) throw Error(result.reason)
		expect(result.value.folderChanges).toEqual([
			{ key: 'about', oldPathname: '/about', newPathname: '/company' },
			{
				key: 'nested',
				oldPathname: '/about/empty',
				newPathname: '/company/empty',
			},
		])
		expect(
			result.value.pageChanges.map((row) => [
				row.id,
				row.newPathname,
				row.version,
			]),
		).toEqual([
			['about', '/company', 'published'],
			['team', '/company/team', 'published'],
			['drafts.team', '/company/team', 'draft'],
			['drafts.new', '/company/new', 'draft'],
		])
		expect(
			result.value.pageChanges.every(
				(row) =>
					row.pathField === 'pathname.current' &&
					!('body' in row) &&
					!('title' in row),
			),
		).toBe(true)
		expect(result.value.guards).toContainEqual({
			id: 'sanityKit.folders',
			revision: 'f1',
		})
		expect(result.value.reviewVersions).toContainEqual({
			id: 'elsewhere',
			revision: 'rev-elsewhere',
		})
		expect(result.value.projectedUrls).toContainEqual({
			id: 'drafts.new',
			schemaType: 'page',
			pathname: '/company/new',
		})
		expect(result.value.redirects.creates.map((row) => row.source)).toEqual([
			'/about',
			'/about/team',
		])
		expect(result.value.redirects.updates).toEqual([
			{
				id: 'alias',
				revision: 'rev-alias',
				source: '/old-team',
				oldDestination: '/about/team',
				newDestination: '/company/team',
				status: 301,
			},
		])
		expect(input).toEqual(original)
	})
	it('does not create redirects for drafts, and opt-out still updates existing aliases', () => {
		const result = plan({ createRedirects: false })
		expect(result.ok).toBe(true)
		if (!result.ok) throw Error(result.reason)
		expect(result.value.redirects.creates).toEqual([])
		expect(result.value.redirects.updates).toHaveLength(1)
	})
	it('blocks a draft-only destination already used by a live redirect', () => {
		const input = request()
		expect(
			plan({
				inventory: {
					...input.inventory,
					redirects: [
						...input.inventory.redirects,
						redirect('draft-target', '/company/new', '/other'),
					],
				},
			}),
		).toMatchObject({
			ok: false,
			reason: 'redirect-conflict',
			redirect: {
				ok: false,
				reason: 'target-is-redirect',
				recordId: 'draft-target',
			},
		})
	})
	it.each(['drafts.draft-target', 'versions.launch.draft-target'])(
		'blocks a draft-only destination claimed by pending redirect %s',
		(id) => {
			const input = request()
			expect(
				plan({
					inventory: {
						...input.inventory,
						redirects: [
							...input.inventory.redirects,
							redirect(id, '/company/new', '/other'),
						],
					},
				}),
			).toMatchObject({
				ok: false,
				reason: 'redirect-conflict',
				redirect: {
					ok: false,
					reason: 'pending-redirect-change',
					recordId: id,
				},
			})
		},
	)
	it('preserves an unrelated redirect to an app-owned destination outside the CMS inventory', () => {
		const input = request()
		const withAppRoutes = createFolderRenamePlanner({
			routes: { ...routes, reservedPathPrefixes: ['/account'] },
		})
		const result = withAppRoutes.plan({
			...input,
			inventory: {
				...input.inventory,
				redirects: [
					...input.inventory.redirects,
					redirect('sign-in', '/sign-in', '/account/profile'),
				],
			},
		})
		expect(result.ok).toBe(true)
		if (!result.ok) throw new Error(result.reason)
		expect(result.value.redirects.updates.map((row) => row.id)).toEqual([
			'alias',
		])
		expect(result.value.reviewVersions).toContainEqual({
			id: 'sign-in',
			revision: 'rev-sign-in',
		})
	})
	it('renames an empty folder without publishing or creating redirects', () => {
		const input = request()
		const result = plan({
			inventory: { ...input.inventory, documents: [], redirects: [] },
		})
		expect(result.ok).toBe(true)
		if (!result.ok) throw Error(result.reason)
		expect(result.value.pageChanges).toEqual([])
		expect(result.value.redirects).toEqual({ creates: [], updates: [] })
	})
	it('changes the last segment while retaining the parent', () => {
		const input = request()
		const result = plan({
			pathname: '/about/empty',
			newName: 'vacant',
			inventory: { ...input.inventory, redirects: [] },
		})
		expect(result.ok).toBe(true)
		if (!result.ok) throw Error(result.reason)
		expect(result.value.newPathname).toBe('/about/vacant')
	})
	it.each([
		'',
		'/',
		'nested/name',
		'../name',
		'name/',
		'name//name',
		'bad name',
	])('refuses invalid final name %s', (newName) =>
		expect(plan({ newName })).toMatchObject({
			ok: false,
			reason: 'invalid-folder',
		}),
	)
	it('reports unchanged names without proposing writes', () =>
		expect(plan({ newName: 'about' })).toEqual({
			ok: false,
			reason: 'unchanged-name',
		}))
	it('matches complete path segments, not similarly named siblings', () => {
		const input = request()
		const doc = page('sibling', '/aboutish/team')
		const result = plan({
			inventory: {
				...input.inventory,
				documents: [...input.inventory.documents, doc],
			},
		})
		expect(result.ok).toBe(true)
		if (!result.ok) throw Error(result.reason)
		expect(result.value.pageChanges.some((row) => row.id === 'sibling')).toBe(
			false,
		)
	})
	it.each(['/planned', null, ''])(
		'does not overwrite an independently planned draft URL %s',
		(path) => {
			const input = request()
			expect(
				plan({
					inventory: {
						...input.inventory,
						documents: input.inventory.documents.map((value) =>
							(value as { _id: string })._id === 'drafts.team'
								? page('drafts.team', path)
								: value,
						),
					},
				}),
			).toMatchObject({
				ok: false,
				reason: 'conflicting-draft-url',
				documentId: 'drafts.team',
			})
		},
	)
	it('blocks a release version even when its own planned URL is outside the folder', () => {
		const input = request()
		expect(
			plan({
				inventory: {
					...input.inventory,
					documents: [
						...input.inventory.documents,
						page('versions.release.team', '/future/team'),
					],
				},
			}),
		).toMatchObject({ ok: false, reason: 'release-version' })
	})
	it.each(['published', 'drafts.collision', 'versions.release.collision'])(
		'refuses merging into a destination occupied by %s',
		(id) => {
			const input = request()
			expect(
				plan({
					inventory: {
						...input.inventory,
						documents: [
							...input.inventory.documents,
							page(id, '/company/elsewhere'),
						],
					},
				}),
			).toMatchObject({ ok: false, reason: 'url-collision', documentId: id })
		},
	)
	it('refuses existing destination folders and reserved URL prefixes', () => {
		expect(plan({ newName: 'other' })).toMatchObject({
			ok: false,
			reason: 'destination-folder-exists',
		})
		const reserved = createFolderRenamePlanner({
			routes: { ...routes, reservedPathPrefixes: ['/company'] },
		})
		expect(reserved.plan(request())).toMatchObject({
			ok: false,
			reason: 'reserved-path',
		})
	})
	it('refuses destination reservations for a descendant page or saved empty subfolder', () => {
		for (const path of ['/company/team', '/company/empty']) {
			const reserved = createFolderRenamePlanner({
				routes: { ...routes, excludePaths: [path] },
			})
			expect(reserved.plan(request())).toMatchObject({
				ok: false,
				reason: 'reserved-path',
			})
		}
	})
	it('blocks collection prefixes and index locations without moving collection item storage', () => {
		for (const routePrefix of ['/about/posts', '/company/posts']) {
			const collections = createFolderRenamePlanner({
				routes: {
					...routes,
					collections: [
						{
							name: 'posts',
							title: 'Posts',
							index: { schemaType: 'page', pathname: '/journal' },
							routePrefix,
							items: [{ schemaType: 'post', slugField: 'slug.current' }],
						},
					],
				},
			})
			expect(collections.plan(request())).toMatchObject({
				ok: false,
				reason: 'collection-boundary',
			})
		}
	})
	it('requires complete access, write eligibility and unprotected URL fields', () => {
		expect(plan({ protectedDocumentIds: ['alias'] })).toMatchObject({
			ok: false,
			reason: 'protected-url',
			documentId: 'alias',
		})
		const input = request()
		expect(
			plan({ inventory: { ...input.inventory, readAccess: 'unknown' } }),
		).toMatchObject({ ok: false, reason: 'incomplete-inventory' })
		expect(
			plan({ inventory: { ...input.inventory, complete: false } }),
		).toMatchObject({ ok: false, reason: 'incomplete-inventory' })
		expect(plan({ writableDocumentIds: [] })).toMatchObject({
			ok: false,
			reason: 'write-access-unverified',
			documentId: 'sanityKit.folders',
		})
		expect(plan({ protectedDocumentIds: ['team'] })).toMatchObject({
			ok: false,
			reason: 'protected-url',
			documentId: 'team',
		})
	})
	it('refuses malformed and duplicate raw versions', () => {
		const input = request()
		for (const documents of [
			[page('bad', '/bad//path')],
			[page('same', '/a'), page('same', '/b')],
			[{ ...page('drafts.team', '/about/team'), _originalId: 'team' }],
		])
			expect(
				plan({ inventory: { ...input.inventory, documents } }),
			).toMatchObject({ ok: false, reason: 'invalid-inventory' })
	})
	it('bounds page version changes rather than silently truncating the review', () => {
		const input = request()
		const documents = Array.from(
			{ length: FOLDER_RENAME_LIMITS.pageVersions + 1 },
			(_, i) => page(`p${i}`, `/about/p${i}`),
		)
		expect(
			plan({ inventory: { ...input.inventory, documents, redirects: [] } }),
		).toMatchObject({ ok: false, reason: 'limit-exceeded' })
	})
})
describe('combined redirect graph for bulk moves', () => {
	it('preserves temporary status and does not mutate the original redirect metadata', () => {
		const saved = { ...redirect('temporary', '/old-a', '/a'), status: 302 }
		const before = structuredClone(saved)
		const result = bulk({
			inventory: { perspective: 'raw', complete: true, records: [saved] },
		})
		if (!result.ok) throw Error(result.reason)
		expect(result.value.updates[0]).toMatchObject({
			status: 302,
			oldDestination: '/a',
			newDestination: '/b',
		})
		expect(saved).toEqual(before)
	})
	it('rejects reserved old paths even when new redirects are disabled', () => {
		expect(
			bulk({ reservedPathPrefixes: ['/a'], createRedirects: false }),
		).toMatchObject({ ok: false, reason: 'source-is-reserved' })
	})
	it('rejects incomplete, duplicate, oversized and malformed redirect evidence', () => {
		expect(
			bulk({ inventory: { perspective: 'raw', complete: false, records: [] } }),
		).toMatchObject({ ok: false, reason: 'incomplete-inventory' })
		expect(
			bulk({
				inventory: {
					perspective: 'raw',
					complete: true,
					records: [redirect('same'), redirect('same')],
				},
			}),
		).toMatchObject({ ok: false, reason: 'invalid-inventory' })
		expect(
			bulk({
				inventory: {
					perspective: 'raw',
					complete: true,
					records: [{ ...redirect('broken'), _rev: '' }],
				},
			}),
		).toMatchObject({ ok: false, reason: 'invalid-inventory' })
		expect(
			bulk({
				inventory: {
					perspective: 'raw',
					complete: true,
					records: Array.from({ length: 1001 }, (_, i) => redirect(`r${i}`)),
				},
			}),
		).toMatchObject({ ok: false, reason: 'limit-exceeded' })
	})

	it('compiles all moves together and preserves permanent/temporary alias behavior', () => {
		const result = bulk()
		expect(result.ok).toBe(true)
		if (!result.ok) throw Error(result.reason)
		expect(
			result.value.creates.map((row) => [row.source, row.destination]),
		).toEqual([
			['/a', '/b'],
			['/c', '/d'],
		])
		expect(
			result.value.updates.map((row) => [row.source, row.newDestination]),
		).toEqual([
			['/old-a', '/b'],
			['/old-c', '/d'],
		])
	})
	it('is independent of move ordering', () => {
		const normal = bulk(),
			reversed = bulk({
				moves: [
					{ oldPathname: '/c', newPathname: '/d' },
					{ oldPathname: '/a', newPathname: '/b' },
				],
			})
		expect(normal.ok && reversed.ok).toBe(true)
		if (!normal.ok || !reversed.ok) throw Error('expected plan')
		expect(reversed.value.updates).toEqual(normal.value.updates)
		expect(
			[...reversed.value.creates].sort((a, b) =>
				a.source.localeCompare(b.source),
			),
		).toEqual(normal.value.creates)
	})
	it.each(
		[
			[{ oldPathname: '/a', newPathname: '/a' }],
			[
				{ oldPathname: '/a', newPathname: '/b' },
				{ oldPathname: '/a', newPathname: '/d' },
			],
			[
				{ oldPathname: '/a', newPathname: '/b' },
				{ oldPathname: '/c', newPathname: '/b' },
			],
			[
				{ oldPathname: '/a', newPathname: '/c' },
				{ oldPathname: '/c', newPathname: '/a' },
			],
		].map((moves) => ({ moves })),
	)('refuses unchanged, overlapping or duplicate moves', ({ moves }) =>
		expect(bulk({ moves })).toMatchObject({
			ok: false,
			reason: 'invalid-moves',
		}),
	)
	it('blocks moving onto an existing alias instead of silently retiring it', () => {
		expect(
			bulk({
				inventory: {
					perspective: 'raw',
					complete: true,
					records: [redirect('alias', '/b', '/a')],
				},
			}),
		).toMatchObject({
			ok: false,
			reason: 'target-is-redirect',
			recordId: 'alias',
		})
	})
	it.each(['drafts.alias', 'versions.release.alias'])(
		'blocks affected pending redirect %s including destination changes away from this move',
		(id) => {
			expect(
				bulk({
					inventory: {
						perspective: 'raw',
						complete: true,
						records: [
							redirect('alias', '/old-a', '/a'),
							redirect(id, '/other', '/c'),
						],
					},
				}),
			).toMatchObject({
				ok: false,
				reason: 'pending-redirect-change',
				recordId: id,
			})
		},
	)
	it('does not block an unrelated redirect draft', () => {
		expect(
			bulk({
				inventory: {
					perspective: 'raw',
					complete: true,
					records: [redirect('drafts.unrelated', '/unrelated', '/outside')],
				},
			}),
		).toMatchObject({ ok: true })
	})
	it('keeps aliases when new redirect creation is disabled', () => {
		const result = bulk({ createRedirects: false })
		if (!result.ok) throw Error(result.reason)
		expect(result.value.creates).toEqual([])
		expect(result.value.updates).toHaveLength(2)
	})
	it('rejects ambiguous existing chains and reserved redirect sources', () => {
		expect(
			bulk({
				inventory: {
					perspective: 'raw',
					complete: true,
					records: [
						redirect('one', '/old', '/older'),
						redirect('two', '/older', '/a'),
					],
				},
			}),
		).toMatchObject({ ok: false, reason: 'invalid-before-snapshot' })
		expect(bulk({ reservedPathPrefixes: ['/old-a'] })).toMatchObject({
			ok: false,
			reason: 'invalid-before-snapshot',
			snapshotReason: 'reserved-source',
		})
	})
	it('bounds the combined updates, not only each move separately', () => {
		const records = Array.from({ length: 100 }, (_, i) =>
			redirect(`alias${i}`, `/alias${i}`, i % 2 ? '/a' : '/c'),
		)
		expect(
			bulk({ inventory: { perspective: 'raw', complete: true, records } }),
		).toMatchObject({ ok: false, reason: 'limit-exceeded' })
	})
})
