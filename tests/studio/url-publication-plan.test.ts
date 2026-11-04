import { describe, expect, it } from 'vitest'
import {
	planSinglePageRedirect,
	REDIRECT_PUBLICATION_METADATA_HEADROOM_BYTES,
	type RedirectPublicationRequest,
} from '../../src/studio/url/publication-plan.js'
import { measureRedirectInventory } from '../../src/studio/url/publication-limits.js'
import { REDIRECT_MAX_BYTES } from '../../src/redirect/snapshot.js'

const rule = (overrides: Record<string, unknown> = {}) => ({
	_id: 'rule-1',
	_type: 'sanityKitRedirect',
	_rev: 'rev-1',
	source: '/historic',
	destination: '/elsewhere',
	status: 301,
	enabled: true,
	origin: 'manual',
	...overrides,
})
const request = (
	overrides: Partial<RedirectPublicationRequest> = {},
): RedirectPublicationRequest => ({
	oldPathname: '/old',
	newPathname: '/new',
	createRedirect: true,
	inventory: { perspective: 'raw', complete: true, records: [] },
	reservedPaths: ['/api', '/preview'],
	occupiedPathsBefore: ['/old', '/elsewhere'],
	occupiedPathsAfter: ['/new', '/elsewhere'],
	destinationsBefore: ['/old', '/elsewhere'],
	destinationsAfter: ['/new', '/elsewhere'],
	...overrides,
})
const withRows = (
	records: unknown[],
	overrides: Partial<RedirectPublicationRequest> = {},
) =>
	request({
		inventory: { perspective: 'raw', complete: true, records },
		...overrides,
	})

describe('single-page publication redirect plan', () => {
	it.each(['/account', '/account/settings'])(
		'blocks reserved page target %s even without a new redirect',
		(newPathname) => {
			expect(
				planSinglePageRedirect(
					request({
						newPathname,
						createRedirect: false,
						reservedPathPrefixes: ['/account'],
						occupiedPathsAfter: [newPathname],
						destinationsAfter: 'unverified',
					}),
				),
			).toMatchObject({ ok: false, reason: 'target-is-reserved' })
		},
	)

	it('checks prefixes in both existing and proposed redirect sources', () => {
		expect(
			planSinglePageRedirect(
				withRows([rule({ source: '/account/legacy' })], {
					reservedPathPrefixes: ['/account'],
				}),
			),
		).toMatchObject({
			ok: false,
			reason: 'invalid-before-snapshot',
			snapshotReason: 'reserved-source',
		})
		expect(
			planSinglePageRedirect(
				request({
					oldPathname: '/account/legacy',
					occupiedPathsBefore: ['/account/legacy'],
					reservedPathPrefixes: ['/account'],
				}),
			),
		).toMatchObject({
			ok: false,
			reason: 'invalid-after-snapshot',
			snapshotReason: 'reserved-source',
		})
	})

	it('keeps similarly named sections available and allows redirects into reserved sections', () => {
		expect(
			planSinglePageRedirect(
				withRows([rule({ destination: '/account/settings' })], {
					newPathname: '/accounting',
					reservedPathPrefixes: ['/account'],
					occupiedPathsAfter: ['/accounting'],
					destinationsBefore: 'unverified',
					destinationsAfter: 'unverified',
				}),
			),
		).toMatchObject({ ok: true })
	})

	it('plans one permanent redirect without assigning a document ID or mutating inputs', () => {
		const input = withRows([rule()])
		const original = structuredClone(input)
		expect(planSinglePageRedirect(input)).toEqual({
			ok: true,
			value: {
				updates: [],
				create: {
					_type: 'sanityKitRedirect',
					source: '/old',
					destination: '/new',
					status: 301,
					enabled: true,
					origin: 'url-change',
				},
			},
		})
		expect(input).toEqual(original)
	})

	it('allows an explicit no-redirect choice without changing existing rules', () => {
		expect(
			planSinglePageRedirect(withRows([rule()], { createRedirect: false })),
		).toEqual({
			ok: true,
			value: { updates: [] },
		})
	})

	it('allows root destinations and checks known destinations after the move', () => {
		expect(
			planSinglePageRedirect(
				request({
					newPathname: '/',
					occupiedPathsAfter: ['/'],
					destinationsAfter: ['/'],
				}),
			),
		).toMatchObject({ ok: true, value: { create: { destination: '/' } } })
		expect(planSinglePageRedirect(request({ destinationsAfter: [] }))).toEqual({
			ok: false,
			reason: 'invalid-after-snapshot',
			snapshotReason: 'unknown-destination',
		})
	})

	it.each(['/old/', '//host', '/a//b', '/a?query=1', 'relative', '/%2fhost'])(
		'refuses noncanonical path %s',
		(path) => {
			expect(planSinglePageRedirect(request({ newPathname: path }))).toEqual({
				ok: false,
				reason: 'invalid-path',
			})
			expect(planSinglePageRedirect(request({ oldPathname: path }))).toEqual({
				ok: false,
				reason: 'invalid-path',
			})
		},
	)

	it('does not invent a redirect for an unchanged URL', () => {
		expect(planSinglePageRedirect(request({ newPathname: '/old' }))).toEqual({
			ok: false,
			reason: 'unchanged-path',
		})
	})

	it('requires complete raw inventory and revisions', () => {
		expect(
			planSinglePageRedirect(
				request({
					inventory: { perspective: 'raw', complete: false, records: [] },
				}),
			),
		).toEqual({
			ok: false,
			reason: 'incomplete-inventory',
			snapshotReason: 'incomplete-snapshot',
		})
		expect(
			planSinglePageRedirect(withRows([rule({ _rev: undefined })])),
		).toEqual({
			ok: false,
			reason: 'invalid-inventory',
			snapshotReason: 'invalid-record',
			recordId: 'rule-1',
		})
		expect(planSinglePageRedirect(withRows([rule(), rule()]))).toEqual({
			ok: false,
			reason: 'invalid-inventory',
			snapshotReason: 'duplicate-id',
			recordId: 'rule-1',
		})
	})

	it.each([
		'../secret',
		'drafts.',
		'versions.release',
		'rule.',
		'versions.release.-rule',
	])('never supplies a clickable identity for unsafe redirect ID %s', (_id) => {
		expect(
			planSinglePageRedirect(withRows([rule({ _id, enabled: null })])),
		).toEqual({
			ok: false,
			reason: 'invalid-inventory',
			snapshotReason: 'invalid-record',
		})
	})
	it('keeps incomplete inventories free of guessed record details', () => {
		expect(
			planSinglePageRedirect(
				request({
					inventory: {
						perspective: 'raw',
						complete: false,
						records: [rule({ source: null })],
					},
				}),
			),
		).toEqual({
			ok: false,
			reason: 'incomplete-inventory',
			snapshotReason: 'incomplete-snapshot',
		})
	})
	it('reports a wrong-perspective read as incomplete evidence, not a content defect', () => {
		const input = request()
		Object.assign(input.inventory, { perspective: 'published' })
		expect(planSinglePageRedirect(input)).toEqual({
			ok: false,
			reason: 'incomplete-inventory',
			snapshotReason: 'wrong-perspective',
		})
	})
	it('rejects malformed raw records and bounds pending records too', () => {
		expect(
			planSinglePageRedirect(withRows([rule({ _id: 'drafts.' })])),
		).toMatchObject({ ok: false, reason: 'invalid-inventory' })
		expect(
			planSinglePageRedirect(
				withRows([rule({ _id: 'drafts.rule', extra: { nested: true } })]),
			),
		).toMatchObject({ ok: false, reason: 'invalid-inventory' })
		expect(
			planSinglePageRedirect(
				withRows(
					Array.from({ length: 1001 }, (_, i) =>
						rule({ _id: `drafts.rule-${i}` }),
					),
				),
			),
		).toMatchObject({
			ok: false,
			reason: 'inventory-limit',
			limit: {
				kind: 'redirect-records',
				actual: 1001,
				maximum: 1000,
				measurement: 'exact',
				phase: 'current',
			},
		})
	})

	it.each([true, false])(
		'refuses a target already used as a redirect source with createRedirect=%s',
		(createRedirect) => {
			expect(
				planSinglePageRedirect(
					withRows([rule({ source: '/new' })], { createRedirect }),
				),
			).toEqual({ ok: false, reason: 'target-is-redirect', recordId: 'rule-1' })
		},
	)

	it.each([true, false])(
		'lists incoming aliases for explicit review with createRedirect=%s',
		(createRedirect) => {
			for (const origin of ['manual', 'url-change']) {
				expect(
					planSinglePageRedirect(
						withRows([rule({ destination: '/old', origin })], {
							createRedirect,
						}),
					),
				).toMatchObject({
					ok: true,
					value: {
						updates: [
							{
								id: 'rule-1',
								revision: 'rev-1',
								source: '/historic',
								oldDestination: '/old',
								newDestination: '/new',
								status: 301,
							},
						],
					},
				})
			}
		},
	)

	it.each(['drafts.pending', 'versions.release.pending'])(
		'refuses an affected pending redirect %s',
		(_id) => {
			expect(
				planSinglePageRedirect(withRows([rule({ _id, source: '/old' })])),
			).toEqual({ ok: false, reason: 'pending-redirect-change', recordId: _id })
		},
	)

	it('recognizes a pending version of an affected alias even if its proposed paths differ', () => {
		expect(
			planSinglePageRedirect(
				withRows([
					rule({ destination: '/old' }),
					rule({
						_id: 'drafts.rule-1',
						source: '/different',
						destination: '/elsewhere',
					}),
				]),
			),
		).toEqual({
			ok: false,
			reason: 'pending-redirect-change',
			recordId: 'drafts.rule-1',
		})
	})

	it('does not activate unrelated pending redirects or disabled historical rules', () => {
		expect(
			planSinglePageRedirect(
				withRows([
					rule({ _id: 'drafts.pending', source: '/not-live' }),
					rule({ _id: 'versions.release.pending', source: '/not-live' }),
					rule({
						_id: 'disabled',
						enabled: false,
						source: '/new',
						destination: '/old',
					}),
				]),
			),
		).toMatchObject({ ok: true })
	})

	it('refuses invalid current graphs before adding a rule', () => {
		expect(
			planSinglePageRedirect(
				withRows(
					[
						rule(),
						rule({
							_id: 'other',
							source: '/elsewhere',
							destination: '/historic',
						}),
					],
					{ occupiedPathsBefore: ['/old'], destinationsBefore: 'unverified' },
				),
			),
		).toMatchObject({
			ok: false,
			reason: 'invalid-before-snapshot',
			snapshotReason: 'redirect-cycle',
		})
	})

	it('enforces live path occupancy and reserved destinations even when skipping redirects', () => {
		expect(
			planSinglePageRedirect(
				request({ createRedirect: false, newPathname: '/api' }),
			),
		).toEqual({ ok: false, reason: 'target-is-reserved' })
		expect(
			planSinglePageRedirect(
				request({ createRedirect: false, occupiedPathsBefore: [] }),
			),
		).toEqual({ ok: false, reason: 'source-not-occupied' })
		expect(
			planSinglePageRedirect(
				request({ createRedirect: false, occupiedPathsAfter: [] }),
			),
		).toEqual({ ok: false, reason: 'target-not-occupied' })
		expect(
			planSinglePageRedirect(
				request({
					createRedirect: false,
					occupiedPathsAfter: ['/new', '/old'],
				}),
			),
		).toEqual({ ok: false, reason: 'source-still-occupied' })
	})

	it('validates source reservations and the resulting snapshot bounds', () => {
		expect(
			planSinglePageRedirect(request({ reservedPaths: ['/old'] })),
		).toMatchObject({
			ok: false,
			reason: 'invalid-after-snapshot',
			snapshotReason: 'reserved-source',
		})
		const rows = Array.from({ length: 1000 }, (_, i) =>
			rule({ _id: `rule-${i}`, enabled: false }),
		)
		expect(planSinglePageRedirect(withRows(rows))).toMatchObject({
			ok: false,
			reason: 'inventory-limit',
		})
	})

	it('counts pending versions when a new rule would exceed the raw inventory limit', () => {
		const rows = Array.from({ length: 1000 }, (_, index) =>
			rule({
				_id: `drafts.pending-${index}`,
				source: '/unrelated',
				enabled: false,
			}),
		)
		expect(planSinglePageRedirect(withRows(rows))).toEqual({
			ok: false,
			reason: 'inventory-limit',
			limit: {
				kind: 'redirect-records',
				actual: 1001,
				maximum: 1000,
				measurement: 'exact',
				phase: 'proposed',
			},
		})
		expect(
			planSinglePageRedirect(withRows(rows, { createRedirect: false })),
		).toEqual({ ok: true, value: { updates: [] } })
	})

	it('bounds reviewed aliases at 100 while preserving temporary and manual rules', () => {
		const rows = Array.from({ length: 100 }, (_, index) =>
			rule({
				_id: `alias-${index}`,
				source: `/alias-${index}`,
				destination: '/old',
				status: 302,
				origin: 'manual',
			}),
		)
		const planned = planSinglePageRedirect(withRows(rows))
		expect(planned.ok).toBe(true)
		if (!planned.ok) throw new Error(planned.reason)
		expect(planned.value.updates).toHaveLength(100)
		expect(planned.value.updates.every((update) => update.status === 302)).toBe(
			true,
		)
		expect(
			planSinglePageRedirect(
				withRows([
					...rows,
					rule({ _id: 'overflow', source: '/overflow', destination: '/old' }),
				]),
			),
		).toEqual({
			ok: false,
			reason: 'too-many-redirect-updates',
			limit: {
				kind: 'redirect-updates',
				actual: 101,
				maximum: 100,
				measurement: 'exact',
				phase: 'proposed',
			},
		})
	})

	it('does not confuse a real rule with the temporary compiler identity', () => {
		expect(
			planSinglePageRedirect(withRows([rule({ _id: 'proposed-redirect-0' })])),
		).toMatchObject({ ok: true })
	})

	it('reserves new-rule metadata headroom before allowing a near-limit snapshot', () => {
		const history = rule({ _id: 'history', enabled: false, origin: '' })
		const proposed = {
			_type: 'sanityKitRedirect',
			source: '/old',
			destination: '/new',
			status: 301,
			enabled: true,
			origin: 'url-change',
			_id: 'proposed-redirect-0',
		}
		const overhead = new TextEncoder().encode(
			JSON.stringify({
				perspective: 'published',
				complete: true,
				records: [history, proposed],
			}),
		).length
		// Without reserved headroom this would fit by 512 bytes, but newly
		// assigned identity/revision/timestamp fields were not counted yet.
		const largeHistory = {
			...history,
			origin: 'x'.repeat(REDIRECT_MAX_BYTES - overhead - 512),
		}
		expect(planSinglePageRedirect(withRows([largeHistory]))).toEqual({
			ok: false,
			reason: 'inventory-limit',
			limit: {
				kind: 'redirect-bytes',
				actual: REDIRECT_MAX_BYTES + 512,
				maximum: REDIRECT_MAX_BYTES,
				measurement: 'estimated',
				phase: 'proposed',
			},
		})
		expect(
			planSinglePageRedirect(
				withRows([largeHistory], { createRedirect: false }),
			),
		).toMatchObject({ ok: true })
		const fittingHistory = {
			...history,
			origin: 'x'.repeat(
				REDIRECT_MAX_BYTES -
					overhead -
					REDIRECT_PUBLICATION_METADATA_HEADROOM_BYTES,
			),
		}
		expect(planSinglePageRedirect(withRows([fittingHistory]))).toMatchObject({
			ok: true,
		})
	})

	it('reserves revision and timestamp growth for every updated alias', () => {
		const alias = rule({ _id: 'alias', destination: '/old' })
		const history = rule({ _id: 'history', enabled: false, origin: '' })
		const overhead = new TextEncoder().encode(
			JSON.stringify({
				perspective: 'published',
				complete: true,
				records: [{ ...alias, destination: '/new' }, history],
			}),
		).length
		const largeHistory = {
			...history,
			origin: 'x'.repeat(REDIRECT_MAX_BYTES - overhead - 512),
		}
		expect(
			planSinglePageRedirect(
				withRows([alias, largeHistory], { createRedirect: false }),
			),
		).toEqual({
			ok: false,
			reason: 'inventory-limit',
			limit: {
				kind: 'redirect-bytes',
				actual: REDIRECT_MAX_BYTES + 512,
				maximum: REDIRECT_MAX_BYTES,
				measurement: 'estimated',
				phase: 'proposed',
			},
		})
		const fittingHistory = {
			...history,
			origin: 'x'.repeat(
				REDIRECT_MAX_BYTES -
					overhead -
					REDIRECT_PUBLICATION_METADATA_HEADROOM_BYTES,
			),
		}
		expect(
			planSinglePageRedirect(
				withRows([alias, fittingHistory], { createRedirect: false }),
			),
		).toMatchObject({ ok: true })
	})
})

describe('bounded redirect size measurements', () => {
	it('measures the real UTF-8 envelope including escapes and metadata', () => {
		const rows = [rule({ source: '/équipe', origin: 'a\nb' })]
		expect(measureRedirectInventory(rows, REDIRECT_MAX_BYTES)).toEqual({
			actual: new TextEncoder().encode(
				JSON.stringify({
					perspective: 'published',
					complete: true,
					records: rows,
				}),
			).length,
			measurement: 'exact',
		})
	})
	it('reports an honest lower bound and stops before serializing oversized or nested values', () => {
		const rows = [
			rule({ origin: 'é'.repeat(REDIRECT_MAX_BYTES + 50) }),
			rule({
				_id: 'unvisited',
				origin: {
					toJSON: () => {
						throw new Error('Must not serialize')
					},
				},
			}),
		]
		const measured = measureRedirectInventory(rows, REDIRECT_MAX_BYTES)!
		expect(measured.measurement).toBe('at-least')
		expect(measured.actual).toBeGreaterThan(REDIRECT_MAX_BYTES)
		const planned = planSinglePageRedirect(withRows(rows))
		expect(planned).toMatchObject({
			ok: false,
			reason: 'inventory-limit',
			limit: {
				kind: 'redirect-bytes',
				...measured,
				maximum: REDIRECT_MAX_BYTES,
				phase: 'current',
			},
		})
	})
	it('keeps malformed nested data separate from size failures', () => {
		const value = rule({
			origin: {
				toJSON: () => {
					throw new Error('Must not serialize')
				},
			},
		})
		expect(
			measureRedirectInventory([value], REDIRECT_MAX_BYTES),
		).toBeUndefined()
		expect(planSinglePageRedirect(withRows([value]))).toEqual({
			ok: false,
			reason: 'invalid-inventory',
			snapshotReason: 'invalid-record',
			recordId: 'rule-1',
		})
	})
	it('stops counting a multi-record envelope at the first crossing', () => {
		const rows = Array.from({ length: 4 }, (_, index) =>
			rule({ _id: `r-${index}`, enabled: false, origin: 'x'.repeat(400_000) }),
		)
		const measured = measureRedirectInventory(rows, REDIRECT_MAX_BYTES)!
		expect(measured.measurement).toBe('at-least')
		expect(measured.actual).toBeGreaterThan(1_200_000)
		expect(measured.actual).toBeLessThan(1_600_000)
	})
})
