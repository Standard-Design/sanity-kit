import { describe, expect, it } from 'vitest'
import { reviewRedirectDraft } from '../../src/studio/redirects/review.js'
import { REDIRECT_MAX_RECORDS } from '../../src/redirect/snapshot.js'

const row = (id = 'rule', source = '/old', destination = '/new') => ({
	_id: id,
	_type: 'sanityKitRedirect',
	_rev: 'revision',
	source,
	destination,
	status: 301,
	enabled: true,
	origin: 'manual',
})
const snapshot = (records: unknown[] = []) => ({
	perspective: 'published',
	complete: true,
	records,
})
const policy = { destinations: 'unverified' as const }

describe('prospective redirect draft graph', () => {
	it('checks a new draft without inventing a published counterpart or writing', () => {
		const candidate = row('drafts.new-rule')
		const inventory = snapshot()
		expect(reviewRedirectDraft(candidate, inventory, policy)).toEqual({
			ok: true,
			documentId: 'new-rule',
			wasPublished: false,
		})
		expect(candidate._id).toBe('drafts.new-rule')
		expect(inventory.records).toEqual([])
	})
	it('replaces only the same published identity', () => {
		const current = row()
		expect(
			reviewRedirectDraft(
				{ ...current, _id: 'drafts.rule', destination: '/better' },
				snapshot([current]),
				policy,
			),
		).toEqual({ ok: true, documentId: 'rule', wasPublished: true })
		expect(current.destination).toBe('/new')
	})
	it.each([
		{ source: 'https://outside.example' },
		{ destination: '/broken//' },
		{ status: 307 },
		{ enabled: undefined },
	])('allows repairs to invalid live candidate values', (broken) => {
		expect(
			reviewRedirectDraft(
				row('drafts.rule'),
				snapshot([{ ...row(), ...broken }]),
				policy,
			),
		).toEqual({ ok: true, documentId: 'rule', wasPublished: true })
	})
	it('keeps unrelated invalid rules visible and blocking', () => {
		expect(
			reviewRedirectDraft(
				row('drafts.rule'),
				snapshot([{ ...row('other', '/unrelated'), destination: 'bad' }]),
				policy,
			),
		).toMatchObject({
			ok: false,
			reason: 'invalid-destination',
			redirects: [
				{ documentId: 'other', pathname: '/unrelated', destination: 'bad' },
			],
		})
	})
	it.each([
		['invalid-source', { source: '/old//' }, 'Source URL'],
		[
			'invalid-destination',
			{ destination: 'https://elsewhere.example' },
			'Destination URL',
		],
		['unsupported-status', { status: 308 }, 'Status'],
	] as const)(
		'explains %s with field-specific guidance',
		(reason, change, field) => {
			expect(
				reviewRedirectDraft(
					{ ...row('drafts.rule'), ...change },
					snapshot(),
					policy,
				),
			).toMatchObject({
				ok: false,
				reason,
				fieldIssues: [{ field, message: expect.any(String) as unknown }],
			})
		},
	)
	it('also validates malformed fields in a disabled candidate draft', () => {
		expect(
			reviewRedirectDraft(
				{ ...row('drafts.rule'), enabled: false, destination: 'bad' },
				snapshot(),
				policy,
			),
		).toMatchObject({ ok: false, reason: 'invalid-destination' })
	})
	it('reports both rules in a duplicate-source conflict', () => {
		expect(
			reviewRedirectDraft(row('drafts.rule'), snapshot([row('other')]), policy),
		).toMatchObject({
			ok: false,
			reason: 'duplicate-source',
			redirects: [{ documentId: 'rule' }, { documentId: 'other' }],
		})
	})
	it.each([
		['redirect-chain', [row('other', '/new', '/final')]],
		['redirect-cycle', [row('other', '/new', '/old')]],
	] as const)('identifies related rules for a %s', (reason, records) => {
		const result = reviewRedirectDraft(
			row('drafts.rule'),
			snapshot([...records]),
			policy,
		)
		expect(result).toMatchObject({ ok: false, reason })
		if (!result.ok)
			expect(result.redirects?.map((item) => item.documentId).sort()).toEqual([
				'other',
				'rule',
			])
	})
	it('can repair a current chain by pointing the candidate directly at its final page', () => {
		expect(
			reviewRedirectDraft(
				row('drafts.rule', '/old', '/final'),
				snapshot([row(), row('other', '/new', '/final')]),
				policy,
			).ok,
		).toBe(true)
	})
	it.each([
		['reserved-source', { reservedPaths: ['/old'] }],
		['reserved-source', { reservedPathPrefixes: ['/old'] }],
		['occupied-source', { occupiedPaths: ['/old'] }],
		['unknown-destination', { destinations: ['/elsewhere'] }],
	] as const)('respects current policy: %s', (reason, extra) => {
		expect(
			reviewRedirectDraft(row('drafts.rule'), snapshot(), {
				...policy,
				...extra,
			}),
		).toMatchObject({ ok: false, reason })
	})
	it('can prepare retirement without changing the supplied live record', () => {
		const live = row()
		expect(
			reviewRedirectDraft(
				{ ...row('drafts.rule'), enabled: false },
				snapshot([live]),
				policy,
			).ok,
		).toBe(true)
		expect(live.enabled).toBe(true)
	})
	it('does not hide duplicate published IDs while replacing the candidate', () => {
		expect(
			reviewRedirectDraft(row('drafts.rule'), snapshot([row(), row()]), policy),
		).toMatchObject({ ok: false, reason: 'duplicate-id' })
	})
	it.each([
		[snapshot([row('drafts.other')]), 'unpublished-record'],
		[{ ...snapshot(), perspective: 'raw' }, 'wrong-perspective'],
		[{ ...snapshot(), complete: false }, 'incomplete-snapshot'],
		[null, 'invalid-envelope'],
		[snapshot([{}]), 'invalid-record'],
	] as const)(
		'requires a complete published inventory',
		(inventory, reason) => {
			expect(
				reviewRedirectDraft(row('drafts.rule'), inventory, policy),
			).toMatchObject({ ok: false, reason })
		},
	)
	it('refuses release candidates', () => {
		expect(
			reviewRedirectDraft(row('versions.release.rule'), snapshot(), policy),
		).toMatchObject({ ok: false, reason: 'release-version' })
	})
	it('enforces count and data-size limits on the resulting inventory', () => {
		const records = Array.from({ length: REDIRECT_MAX_RECORDS }, (_, i) => ({
			...row(`r${i}`),
			enabled: false,
		}))
		expect(
			reviewRedirectDraft(row('drafts.rule'), snapshot(records), policy),
		).toMatchObject({ ok: false, reason: 'too-many-records' })
		expect(
			reviewRedirectDraft(
				{ ...row('drafts.rule'), origin: 'x'.repeat(1_048_576) },
				snapshot(),
				policy,
			),
		).toMatchObject({ ok: false, reason: 'payload-too-large' })
	})
})
