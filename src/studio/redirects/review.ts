/**
 * Private diagnostic check for one proposed redirect draft. Replace only its
 * published counterpart, then validate the resulting complete graph. This lets
 * an editor repair a malformed live rule without ignoring other broken rules.
 * No network, permission check, mutation, or publish authorization happens here.
 */
import {
	compileRedirectSnapshot,
	REDIRECT_MAX_RECORDS,
	type RedirectSnapshotOptions,
	type RedirectSnapshotReason,
} from '../../redirect/snapshot.js'
import {
	redirectFieldIssues,
	redirectRowDetails,
	relatedRedirectDetails,
	safeRedirectRecordId,
	type RedirectFieldIssue,
} from '../url/publication-diagnostics.js'

export type RedirectDraftReview =
	| {
			readonly ok: true
			readonly documentId: string
			readonly wasPublished: boolean
	  }
	| {
			readonly ok: false
			readonly reason: RedirectSnapshotReason | 'release-version'
			readonly message: string
			readonly fieldIssues?: readonly RedirectFieldIssue[]
			readonly redirects?: readonly {
				readonly documentId: string
				readonly pathname: string
				readonly destination?: string
			}[]
	  }

const record = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value)
const fields = [
	'_type',
	'_rev',
	'_createdAt',
	'_updatedAt',
	'source',
	'destination',
	'status',
	'enabled',
	'origin',
] as const
const messages: Partial<Record<RedirectSnapshotReason, string>> = {
	'invalid-source':
		'The old URL needs to be corrected before this redirect can be used.',
	'invalid-destination':
		'The destination URL needs to be corrected before this redirect can be used.',
	'unsupported-status': 'Choose a permanent (301) or temporary (302) redirect.',
	'duplicate-source':
		'More than one enabled redirect uses this old URL. Keep one rule for it and retire or change the other.',
	'self-redirect':
		'Choose a different destination so this redirect does not send visitors back to the same URL.',
	'redirect-chain':
		'This destination is another redirect. Point each affected rule directly to the final page URL.',
	'redirect-cycle':
		'These redirects send visitors in a loop. Change their destinations so every rule leads directly to a page.',
	'reserved-source':
		'The old URL is reserved by the app. Choose another old URL.',
	'occupied-source':
		'A published page already uses this old URL. Choose another old URL or change that page’s URL first.',
	'unknown-destination':
		'The destination is not in the supplied list of current page URLs. Choose an existing page URL.',
	'too-many-records':
		'There are more redirect records than this check supports. Review rules that are no longer needed before adding another.',
	'payload-too-large':
		'The redirect data is larger than this check supports. Review unintended long values or ask a developer about a larger inventory.',
}
function issue(
	reason: RedirectSnapshotReason,
	row?: Record<string, unknown>,
	rows: readonly unknown[] = [],
): RedirectDraftReview {
	const fieldIssues = row
		? redirectFieldIssues(row, reason).filter(
				(issue) => issue.field !== 'Record revision',
			)
		: []
	const id = row && safeRedirectRecordId(row)
	const related = row
		? {
				relatedRedirects: [] as ReturnType<typeof redirectRowDetails>[],
				...relatedRedirectDetails(rows, row, reason),
			}.relatedRedirects
		: []
	return {
		ok: false,
		reason,
		message:
			messages[reason] ??
			'The redirect data could not be checked completely. Reload it and correct any missing or unsupported values.',
		...(fieldIssues.length ? { fieldIssues } : {}),
		...(id ? { redirects: [redirectRowDetails(row), ...related] } : {}),
	}
}

/**
 * `inventory` is the bounded published envelope from a trusted caller. Labels
 * assert completeness; this helper cannot prove visibility or freshness. The
 * later guarded writer must load raw versions, check access and recheck revisions.
 */
export function reviewRedirectDraft(
	candidate: unknown,
	inventory: unknown,
	policy: RedirectSnapshotOptions,
): RedirectDraftReview {
	// Validate trusted policy even when supplied data is malformed.
	compileRedirectSnapshot(
		{ perspective: 'published', complete: true, records: [] },
		policy,
	)
	if (!record(inventory) || !Array.isArray(inventory.records))
		return issue('invalid-envelope')
	if (inventory.perspective !== 'published') return issue('wrong-perspective')
	if (inventory.complete !== true) return issue('incomplete-snapshot')
	if (inventory.records.length > REDIRECT_MAX_RECORDS)
		return issue('too-many-records')
	const seen = new Set<string>()
	for (const row of inventory.records as unknown[]) {
		const id = safeRedirectRecordId(row)
		if (!id) return issue('invalid-record')
		if (id.startsWith('drafts.') || id.startsWith('versions.'))
			return issue('unpublished-record')
		if (seen.has(id)) return issue('duplicate-id')
		seen.add(id)
	}
	const candidateId = safeRedirectRecordId(candidate)
	if (!record(candidate) || !candidateId) return issue('invalid-record')
	if (candidateId.startsWith('versions.'))
		return {
			ok: false,
			reason: 'release-version',
			message:
				'Editing redirects in releases is not supported yet. Open the ordinary draft to prepare changes.',
		}
	const id = candidateId.replace(/^drafts\./u, '')
	// Mirror the loader's known-field projection. Other Studio metadata is not
	// part of the redirect graph, and it is never copied into a write by this helper.
	const proposed: Record<string, unknown> = { _id: id }
	for (const field of fields)
		if (Object.hasOwn(candidate, field)) proposed[field] = candidate[field]
	// Validate the candidate's fields even when its draft prepares retirement.
	// Disabled historical records elsewhere may retain old malformed paths, but
	// new editor input should still receive useful field-level feedback.
	const local = compileRedirectSnapshot(
		{
			perspective: 'published',
			complete: true,
			records: [
				{
					...proposed,
					enabled:
						typeof proposed.enabled === 'boolean' ? true : proposed.enabled,
				},
			],
		},
		{ destinations: 'unverified' },
	)
	if (!local.ok) return issue(local.reason, proposed, [proposed])
	const rows = (inventory.records as Record<string, unknown>[]).filter(
		(row) => row._id !== id,
	)
	rows.push(proposed)
	const result = compileRedirectSnapshot(
		{ perspective: 'published', complete: true, records: rows },
		policy,
	)
	if (!result.ok)
		return issue(
			result.reason,
			rows.find((row) => row._id === result.recordId) ?? proposed,
			rows,
		)
	return { ok: true, documentId: id, wasPublished: seen.has(id) }
}
