/**
 * Read-permission contract for collection-prefix reviews. The future Studio
 * adapter must prove whole inventories, not sample a few visible documents.
 * Missing settings drafts and malformed settings records must remain observable.
 * This module checks the adapter's explicit answers; it does not infer grants.
 * @see docs/collection-prefix-publication.md#read-access-is-an-integration-requirement
 */
import {
	createCollectionRouting,
	type CollectionRoutingConfig,
} from '../../url/settings/resolve.js'

export type CollectionPrefixReadRequirement = {
	readonly key: string
	readonly label: string
} & (
	| {
			readonly kind: 'type-versions'
			readonly schemaType: string
			readonly versions: readonly ['published', 'drafts', 'releases']
	  }
	| {
			readonly kind: 'exact-identities'
			readonly ids: readonly string[]
			readonly regardlessOfType: true
	  }
	| {
			readonly kind: 'settings-release-identities'
			readonly publishedIds: readonly string[]
			readonly regardlessOfType: true
	  }
)
export interface CollectionPrefixAccessDecision {
	readonly key: string
	readonly status: 'granted' | 'missing' | 'unverified'
}
export interface CollectionPrefixAccessIssue {
	readonly key: string
	readonly label: string
	readonly status: 'missing' | 'unverified'
}
export function createCollectionPrefixReadRequirements(
	configuration: CollectionRoutingConfig,
): readonly CollectionPrefixReadRequirement[] {
	const routing = createCollectionRouting(configuration)
	const types = [
		...new Set([
			...configuration.pages.map((page) => page.schemaType),
			...(configuration.collections ?? []).flatMap((collection) =>
				collection.items.map((item) => item.schemaType),
			),
			'sanityKitRedirect',
		]),
	].sort()
	return Object.freeze([
		...types.map((schemaType) =>
			Object.freeze({
				key: `versions:${schemaType}`,
				label: `Read all published, draft, and release versions of ${schemaType}`,
				kind: 'type-versions' as const,
				schemaType,
				versions: Object.freeze(['published', 'drafts', 'releases'] as const),
			}),
		),
		Object.freeze({
			key: 'settings:exact',
			label:
				'Read every configured collection settings document and its draft, regardless of document type',
			kind: 'exact-identities' as const,
			ids: Object.freeze(
				routing.documentIds.flatMap((id) => [id, `drafts.${id}`]).sort(),
			),
			regardlessOfType: true as const,
		}),
		Object.freeze({
			key: 'settings:releases',
			label:
				'Read every release version of the configured collection settings, regardless of document type',
			kind: 'settings-release-identities' as const,
			publishedIds: Object.freeze([...routing.documentIds].sort()),
			regardlessOfType: true as const,
		}),
	])
}

/** An empty, partial, duplicate, or malformed adapter answer never grants access. */
export function verifyCollectionPrefixReadAccess(
	requirements: readonly CollectionPrefixReadRequirement[],
	answer: unknown,
): { ok: boolean; issues: readonly CollectionPrefixAccessIssue[] } {
	const entries =
		Array.isArray(answer) &&
		answer.length <= requirements.length &&
		answer.every(
			(entry: unknown) =>
				entry &&
				typeof entry === 'object' &&
				'key' in entry &&
				typeof entry.key === 'string' &&
				requirements.some((requirement) => requirement.key === entry.key) &&
				'status' in entry &&
				['granted', 'missing', 'unverified'].includes(String(entry.status)),
		)
			? answer
			: []
	const issues = requirements.flatMap(
		(requirement): CollectionPrefixAccessIssue[] => {
			const matching = entries.filter(
				(entry: unknown) =>
					entry &&
					typeof entry === 'object' &&
					'key' in entry &&
					entry.key === requirement.key,
			) as CollectionPrefixAccessDecision[]
			if (matching.length === 1 && matching[0]!.status === 'granted') return []
			return [
				{
					key: requirement.key,
					label: requirement.label,
					status:
						matching.length === 1 && matching[0]!.status === 'missing'
							? 'missing'
							: 'unverified',
				},
			]
		},
	)
	return { ok: issues.length === 0, issues }
}
