import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'
import {
	compileRedirectSnapshot,
	REDIRECT_MAX_BYTES,
	REDIRECT_MAX_RECORDS,
	type RedirectSnapshotOptions,
	type RedirectSnapshotReason,
} from '../../src/redirect/snapshot.js'

const options: RedirectSnapshotOptions = {
	destinations: 'unverified',
}
const rule = (_id = 'rule-1', source = '/old', destination = '/new') => ({
	_id,
	_type: 'sanityKitRedirect',
	source,
	destination,
	status: 301,
	enabled: true,
	origin: 'manual',
})
const envelope = (records: unknown[] = [rule()]) => ({
	perspective: 'published',
	complete: true,
	records,
})
function compiled(records: unknown[] = [rule()], config = options) {
	const result = compileRedirectSnapshot(envelope(records), config)
	if (!result.ok) throw new Error(`Expected valid snapshot: ${result.reason}`)
	return result.value
}

describe('private redirect snapshot foundation', () => {
	it('matches exactly, including root destination and temporary redirects', () => {
		const index = compiled([
			rule(),
			{ ...rule('home', '/old-home', '/'), status: 302 },
		])
		expect(index.size).toBe(2)
		expect(index.destinationsVerified).toBe(false)
		expect(index.match('/old')).toEqual({
			kind: 'redirect',
			location: '/new',
			status: 301,
		})
		expect(index.match('/old-home')).toEqual({
			kind: 'redirect',
			location: '/',
			status: 302,
		})
		expect(index.match('/old/child')).toEqual({ kind: 'none' })
		expect(index.match('/new')).toEqual({ kind: 'none' })
	})

	it('accepts a complete empty snapshot without inventing a redirect', () => {
		const index = compiled([])
		expect(index.size).toBe(0)
		expect(index.match('/')).toEqual({ kind: 'none' })
	})

	it('preserves exact case and encoding rather than treating aliases as equal', () => {
		const index = compiled([
			rule('case', '/Old'),
			rule('encoded', '/caf%C3%A9', '/story%20two'),
		])
		expect(index.match('/Old')).toMatchObject({ kind: 'redirect' })
		expect(index.match('/old')).toEqual({ kind: 'none' })
		expect(index.match('/%4Fld')).toEqual({ kind: 'none' })
		expect(index.match('/caf%C3%A9')).toEqual({
			kind: 'redirect',
			location: '/story%20two',
			status: 301,
		})
		expect(index.match('/caf%c3%a9')).toEqual({ kind: 'none' })
	})

	it.each([
		'//evil.example',
		'https://evil.example',
		'/a\\b',
		'/a b',
		'/a?token=secret',
		'/a#fragment',
		'/a/../b',
		'/a/./b',
		'/%2e%2e/b',
		'/%2fhost',
		'/%5chost',
		'/%00',
		'/%7f',
		'/bad%zz',
		'/%FF',
		'/a\n',
		'/café',
		'/old/',
		'/a//b',
		'',
		'old',
	])('rejects unsafe or noncanonical paths without fixing %j', (path) => {
		expect(
			compileRedirectSnapshot(envelope([rule('bad', path)]), options),
		).toMatchObject({ ok: false, reason: 'invalid-source' })
		expect(
			compileRedirectSnapshot(envelope([rule('bad', '/old', path)]), options),
		).toMatchObject({ ok: false, reason: 'invalid-destination' })
		expect(compiled().match(path)).toEqual({ kind: 'invalid-path' })
	})

	it.each([null, undefined, 10, {}, ['/old']])(
		'rejects non-string lookup values %j',
		(path) => {
			expect(compiled().match(path)).toEqual({ kind: 'invalid-path' })
		},
	)

	it.each([307, 308, 200, '301', null])(
		'refuses unsupported status %j',
		(status) => {
			expect(
				compileRedirectSnapshot(envelope([{ ...rule(), status }]), options),
			).toMatchObject({ ok: false, reason: 'unsupported-status' })
		},
	)

	it.each<[unknown, RedirectSnapshotReason]>([
		[null, 'invalid-envelope'],
		[[], 'invalid-envelope'],
		[{ ...envelope(), records: null }, 'invalid-envelope'],
		[{ ...envelope(), unexpected: {} }, 'invalid-envelope'],
		[{ ...envelope(), complete: false }, 'incomplete-snapshot'],
		[{ ...envelope(), perspective: 'drafts' }, 'wrong-perspective'],
		[{ ...envelope(), perspective: 'raw' }, 'wrong-perspective'],
		[{ ...envelope(), site: 'legacy' }, 'invalid-envelope'],
		[envelope([{ ...rule(), site: 'legacy' }]), 'invalid-record'],
		[envelope([{ ...rule(), _id: 'drafts.rule-1' }]), 'unpublished-record'],
		[
			envelope([{ ...rule(), _id: 'versions.launch.rule-1' }]),
			'unpublished-record',
		],
		[envelope([{ ...rule(), _type: 'page' }]), 'invalid-record'],
		[envelope([{ ...rule(), _id: '' }]), 'invalid-record'],
		[envelope([{ ...rule(), _id: '-bad' }]), 'invalid-record'],
		[envelope([{ ...rule(), _id: 'a..b' }]), 'invalid-record'],
		[envelope([{ ...rule(), _id: 'a.versions.b' }]), 'invalid-record'],
		[envelope([{ ...rule(), enabled: 'true' }]), 'invalid-record'],
		[envelope([null]), 'invalid-record'],
		[envelope([{ ...rule(), body: { blocks: [] } }]), 'invalid-record'],
		[envelope([{ ...rule(), _rev: Number.NaN }]), 'invalid-record'],
	])(
		'refuses incomplete and malformed input, including removed fields %#',
		(input, reason) => {
			expect(compileRedirectSnapshot(input, options)).toMatchObject({
				ok: false,
				reason,
			})
		},
	)

	it('does not accept inherited envelope or record fields', () => {
		expect(
			compileRedirectSnapshot(Object.create(envelope()), options),
		).toMatchObject({ ok: false, reason: 'invalid-envelope' })
		expect(
			compileRedirectSnapshot(envelope([Object.create(rule())]), options),
		).toMatchObject({ ok: false, reason: 'invalid-record' })
	})

	it('refuses duplicate identities and enabled sources instead of choosing one', () => {
		expect(
			compileRedirectSnapshot(
				envelope([rule(), rule('rule-1', '/other')]),
				options,
			),
		).toMatchObject({ ok: false, reason: 'duplicate-id' })
		expect(
			compileRedirectSnapshot(
				envelope([rule(), { ...rule('second'), status: 302 }]),
				options,
			),
		).toMatchObject({ ok: false, reason: 'duplicate-source' })
	})

	it('ignores disabled history without allowing its source into the graph', () => {
		const index = compiled([
			rule(),
			{ ...rule('disabled', '/new', '/old'), enabled: false },
			{
				_id: 'historical',
				_type: 'sanityKitRedirect',
				enabled: false,
				source: 'obsolete',
				status: 308,
			},
		])
		expect(index.size).toBe(1)
		expect(index.match('/new')).toEqual({ kind: 'none' })
		expect(index.match('/old')).toMatchObject({
			kind: 'redirect',
			location: '/new',
		})
	})

	it.each<[ReturnType<typeof rule>[], RedirectSnapshotReason]>([
		[[rule('self', '/same', '/same')], 'self-redirect'],
		[[rule('a', '/a', '/b'), rule('b', '/b', '/a')], 'redirect-cycle'],
		[
			[rule('a', '/a', '/b'), rule('b', '/b', '/c'), rule('c', '/c', '/b')],
			'redirect-cycle',
		],
		[[rule('a', '/a', '/b'), rule('b', '/b', '/c')], 'redirect-chain'],
	])('rejects self redirects, cycles, and chains %#', (records, reason) => {
		expect(compileRedirectSnapshot(envelope(records), options)).toMatchObject({
			ok: false,
			reason,
		})
	})

	it('does not flatten a temporary chain or overflow on a long cycle', () => {
		expect(
			compileRedirectSnapshot(
				envelope([
					rule('a', '/a', '/b'),
					{ ...rule('b', '/b', '/c'), status: 302 },
				]),
				options,
			),
		).toMatchObject({ ok: false, reason: 'redirect-chain' })
		const records = Array.from({ length: REDIRECT_MAX_RECORDS }, (_, i) =>
			rule(`r-${i}`, `/p-${i}`, `/p-${(i + 1) % REDIRECT_MAX_RECORDS}`),
		)
		expect(compileRedirectSnapshot(envelope(records), options)).toMatchObject({
			ok: false,
			reason: 'redirect-cycle',
		})
	})

	it('protects exact reserved endpoints and current page URLs', () => {
		expect(
			compileRedirectSnapshot(envelope(), {
				...options,
				reservedPaths: ['/old'],
			}),
		).toMatchObject({ ok: false, reason: 'reserved-source' })
		expect(
			compileRedirectSnapshot(envelope(), {
				...options,
				occupiedPaths: ['/old'],
			}),
		).toMatchObject({ ok: false, reason: 'occupied-source' })
		const index = compiled([], { ...options, reservedPaths: ['/api'] })
		expect(index.match('/api')).toEqual({
			kind: 'bypass',
			reason: 'reserved-path',
		})
		expect(index.match('/api/child')).toEqual({ kind: 'none' })
	})

	it('requires explicit destination knowledge or acknowledgement', () => {
		expect(
			compiled([rule()], { destinations: ['/new'] }).destinationsVerified,
		).toBe(true)
		expect(
			compileRedirectSnapshot(envelope(), {
				destinations: ['/different'],
			}),
		).toMatchObject({ ok: false, reason: 'unknown-destination' })
		expect(() =>
			compileRedirectSnapshot(envelope(), {} as RedirectSnapshotOptions),
		).toThrow('known destinations')
	})

	it('rejects noncanonical policy paths', () => {
		for (const field of ['reservedPaths', 'occupiedPaths', 'destinations'])
			expect(() =>
				compileRedirectSnapshot(envelope(), { ...options, [field]: ['/old/'] }),
			).toThrow('canonical')
	})

	it('bounds total records including disabled history', () => {
		const records = Array.from(
			{ length: REDIRECT_MAX_RECORDS + 1 },
			(_, i) => ({ ...rule(`r-${i}`, `/p-${i}`), enabled: false }),
		)
		expect(compileRedirectSnapshot(envelope(records), options)).toMatchObject({
			ok: false,
			reason: 'too-many-records',
		})
		expect(compiled(records.slice(0, REDIRECT_MAX_RECORDS)).size).toBe(0)
	})

	it('bounds serialized UTF-8 bytes without serializing arbitrary nested content', () => {
		const giant = { ...rule(), origin: 'x'.repeat(REDIRECT_MAX_BYTES + 1) }
		expect(compileRedirectSnapshot(envelope([giant]), options)).toMatchObject({
			ok: false,
			reason: 'payload-too-large',
		})
		const unicode = { ...rule(), origin: '🌳'.repeat(REDIRECT_MAX_BYTES / 4) }
		expect(compileRedirectSnapshot(envelope([unicode]), options)).toMatchObject(
			{ ok: false, reason: 'payload-too-large' },
		)
		const cumulative = Array.from({ length: 100 }, (_, i) => ({
			...rule(`r${i}`, `/p${i}`),
			origin: 'x'.repeat(11_000),
		}))
		expect(
			compileRedirectSnapshot(envelope(cumulative), options),
		).toMatchObject({ ok: false, reason: 'payload-too-large' })
		const cyclic: Record<string, unknown> = rule()
		cyclic.origin = cyclic
		expect(compileRedirectSnapshot(envelope([cyclic]), options)).toMatchObject({
			ok: false,
			reason: 'invalid-record',
		})
	})

	it('copies records and policies, freezes the index facade, and returns independent decisions', () => {
		const records = [rule()]
		const policy = {
			reservedPaths: ['/reserved'],
			occupiedPaths: ['/page'],
			destinations: ['/new'],
		}
		const index = compiled(records, policy)
		records[0]!.destination = '/changed'
		policy.reservedPaths.push('/old')
		policy.destinations.length = 0
		const decision = index.match('/old')
		Object.assign(decision, { location: '/mutated' })
		expect(index.match('/old')).toEqual({
			kind: 'redirect',
			location: '/new',
			status: 301,
		})
		expect(Object.isFrozen(index)).toBe(true)
		expect(index).not.toHaveProperty('rules')
	})

	it('bundles without Studio, React, router, or network client runtime', async () => {
		const output = await build({
			entryPoints: ['src/redirect/snapshot.ts'],
			bundle: true,
			write: false,
			platform: 'browser',
			format: 'esm',
			metafile: true,
		})
		for (const path of Object.keys(output.metafile.inputs)) {
			expect(path).not.toMatch(/src\/(?:studio|react-router)\//u)
			expect(path).not.toMatch(
				/node_modules\/(?:sanity|react|react-dom|react-router|@sanity\/ui)\//u,
			)
			expect(path).not.toMatch(/SanityClient|httpRequest|dataMethods/u)
		}
	})
})
