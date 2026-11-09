/**
 * Fetch and recheck a bounded collection-prefix review. All reads use raw
 * identities without CDN/HTTP caching; the normal navigator's effective view
 * cannot establish whether hidden drafts or release versions exist.
 *
 * There is deliberately no publish/mutate method. A current review is evidence
 * for a future guarded writer, not permission to change a settings document.
 * @see docs/collection-prefix-publication.md
 */
import type { CollectionRoutingConfig } from '../../url/settings/resolve.js'
import { REDIRECT_MAX_RECORDS } from '../../redirect/snapshot.js'
import { fieldExpression } from '../pages/resolvers.js'
import {
	createCollectionPrefixReadRequirements,
	verifyCollectionPrefixReadAccess,
	type CollectionPrefixAccessDecision,
	type CollectionPrefixAccessIssue,
	type CollectionPrefixReadRequirement,
} from './prefix-access.js'
import {
	COLLECTION_PREFIX_LIMITS,
	createCollectionPrefixPlanner,
	type CollectionPrefixChoice,
	type CollectionPrefixInventory,
	type CollectionPrefixPlan,
	type CollectionPrefixPlanResult,
} from './prefix-plan.js'

/** Structural transport supports Studio's bundled SDK and the app's SDK. */
export interface CollectionPrefixReviewClient {
	withConfig(options: {
		apiVersion: string
		perspective: 'raw'
		useCdn: false
		stega: false
		maxRetries: 0
	}): {
		config(): { projectId?: string; dataset?: string }
		fetch(
			query: string,
			params: Record<string, unknown>,
			options: {
				perspective: 'raw'
				useCdn: false
				stega: false
				filterResponse: true
				cache: 'no-store'
				next: undefined
				tag: string
				signal?: AbortSignal
			},
		): Promise<unknown>
	}
}
export interface CollectionPrefixReview {
	readonly projectId: string
	readonly dataset: string
	readonly plan: CollectionPrefixPlan
}
export type CollectionPrefixReviewResult =
	| { readonly status: 'ready'; readonly review: CollectionPrefixReview }
	| {
			readonly status: 'blocked'
			readonly reason: string
			readonly planFailure?: Extract<CollectionPrefixPlanResult, { ok: false }>
			readonly accessIssues?: readonly CollectionPrefixAccessIssue[]
	  }
export interface CollectionPrefixReadAccessRequest {
	readonly projectId: string
	readonly dataset: string
	readonly requirements: readonly CollectionPrefixReadRequirement[]
}
const record = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value)
const blocked = (
	reason: string,
): Extract<CollectionPrefixReviewResult, { status: 'blocked' }> => ({
	status: 'blocked',
	reason,
})

export function createCollectionPrefixReviewer(
	configuration: CollectionRoutingConfig,
	client: CollectionPrefixReviewClient,
	options: {
		/** Must check fresh grants for every requested scope, not rows from this query. */
		readonly confirmReadAccess: (
			request: CollectionPrefixReadAccessRequest,
			signal?: AbortSignal,
		) => Promise<readonly CollectionPrefixAccessDecision[]>
	},
) {
	if (typeof options.confirmReadAccess !== 'function')
		throw new Error(
			'Collection prefix review needs an explicit read-access verifier.',
		)
	const config = structuredClone(configuration)
	const planner = createCollectionPrefixPlanner(config)
	const requirements = createCollectionPrefixReadRequirements(config)
	const source = client.withConfig({
		apiVersion: '2026-10-01',
		perspective: 'raw',
		useCdn: false,
		stega: false,
		maxRetries: 0,
	})
	const { projectId, dataset } = source.config()
	if (
		!projectId ||
		!/^[a-z0-9]+$/u.test(projectId) ||
		!dataset ||
		!/^[a-z0-9_][a-z0-9_-]*$/u.test(dataset)
	)
		throw new Error(
			'Collection prefix review needs a concrete project and dataset.',
		)
	const accessRequest = Object.freeze({ projectId, dataset, requirements })
	const types = [
		...config.pages.map((page) => ({
			schemaType: page.schemaType,
			pathField: page.pathnameField,
			titleField: page.titleField ?? 'title',
		})),
		...(config.collections ?? []).flatMap((collection) =>
			collection.items.map((item) => ({
				schemaType: item.schemaType,
				pathField: 'slugField' in item ? item.slugField : item.pathnameField,
				titleField: item.titleField ?? 'title',
			})),
		),
	]
	const exact = requirements.find((item) => item.kind === 'exact-identities')!
	const release = requirements.find(
		(item) => item.kind === 'settings-release-identities',
	)!
	if (
		exact.kind !== 'exact-identities' ||
		release.kind !== 'settings-release-identities'
	)
		throw new Error('Invalid collection settings read requirements.')
	const params: Record<string, unknown> = {
		types: types.map((type) => type.schemaType),
		settingsIds: exact.ids,
	}
	const settingFilters = [
		'_id in $settingsIds',
		...release.publishedIds.map((id, index) => {
			params[`release${index}`] = `versions.*.${id}`
			return `_id in path($release${index})`
		}),
	]
	const values = types.map((type, index) => {
		params[`type${index}`] = type.schemaType
		return `_type == $type${index} => ${fieldExpression(type.pathField)}`
	})
	const titles = types.map(
		(type, index) =>
			`_type == $type${index} => ${fieldExpression(type.titleField)}`,
	)
	const query = `{
		"settings": *[${settingFilters.join(' || ')}] | order(_id asc)[0...${COLLECTION_PREFIX_LIMITS.settingsVersions + 1}]{_id,_type,_rev,defined(_originalId)=>{_originalId},collection,prefix,displayName},
		"documents": *[_type in $types] | order(_id asc)[0...${COLLECTION_PREFIX_LIMITS.pageVersions + 1}]{_id,_type,_rev,defined(_originalId)=>{_originalId},"value":select(${values.join(',')}),"title":select(${titles.join(',')})},
		"redirects": *[_type == "sanityKitRedirect"] | order(_id asc)[0...${REDIRECT_MAX_RECORDS + 1}]{_id,_type,_rev,defined(_originalId)=>{_originalId},source,destination,status,enabled,origin}
	}`
	const proofs = new WeakMap<
		CollectionPrefixReview,
		{ choice: CollectionPrefixChoice; fingerprint: string }
	>()
	async function access(signal?: AbortSignal) {
		if (signal?.aborted) return blocked('aborted')
		const answer = await options.confirmReadAccess(accessRequest, signal)
		if (signal?.aborted) return blocked('aborted')
		const result = verifyCollectionPrefixReadAccess(requirements, answer)
		return result.ok
			? undefined
			: { ...blocked('unknown-read-access'), accessIssues: result.issues }
	}
	async function read(
		choice: CollectionPrefixChoice,
		signal?: AbortSignal,
	): Promise<
		| { plan: CollectionPrefixPlan; fingerprint: string }
		| Extract<CollectionPrefixReviewResult, { status: 'blocked' }>
	> {
		try {
			const denied = await access(signal)
			if (denied) return denied
			const value = await source.fetch(query, params, {
				perspective: 'raw',
				useCdn: false,
				stega: false,
				filterResponse: true,
				cache: 'no-store',
				next: undefined,
				tag: 'sanity-kit.collection-prefix-review',
				...(signal ? { signal } : {}),
			})
			if (signal?.aborted) return blocked('aborted')
			if (
				!record(value) ||
				!Array.isArray(value.documents) ||
				!Array.isArray(value.settings) ||
				!Array.isArray(value.redirects)
			)
				return blocked('invalid-response')
			if (
				value.documents.length > COLLECTION_PREFIX_LIMITS.pageVersions ||
				value.settings.length > COLLECTION_PREFIX_LIMITS.settingsVersions ||
				value.redirects.length > REDIRECT_MAX_RECORDS
			)
				return blocked('limit-exceeded')
			if (
				new TextEncoder().encode(JSON.stringify(value)).byteLength >
				COLLECTION_PREFIX_LIMITS.inventoryBytes
			)
				return blocked('limit-exceeded')
			const documents: Record<string, unknown>[] = []
			for (const row of value.documents as unknown[]) {
				if (
					!record(row) ||
					!Object.hasOwn(row, 'value') ||
					!Object.hasOwn(row, 'title')
				)
					return blocked('invalid-response')
				const type = types.find((type) => type.schemaType === row._type)
				if (!type) return blocked('invalid-response')
				const document: Record<string, unknown> = {
					_id: row._id,
					_type: row._type,
					_rev: row._rev,
					...(row._originalId == null ? {} : { _originalId: row._originalId }),
				}
				// Rebuild only the registered fields; projected data is never a full
				// document copy suitable for createOrReplace or publishing.
				const set = (path: string, fieldValue: unknown) => {
					let target = document
					const parts = path.split('.')
					for (const part of parts.slice(0, -1)) {
						if (!record(target[part])) target[part] = {}
						target = target[part] as Record<string, unknown>
					}
					target[parts.at(-1)!] = fieldValue
				}
				set(type.titleField, row.title)
				set(type.pathField, row.value)
				documents.push(document)
			}
			const inventory: CollectionPrefixInventory = {
				perspective: 'raw',
				complete: true,
				readAccess: 'all-required-versions',
				settings: value.settings,
				redirects: value.redirects,
				documents,
			}
			const result = planner.plan(choice, inventory)
			if (!result.ok) return { ...blocked(result.reason), planFailure: result }
			const deniedAfter = await access(signal)
			if (deniedAfter) return deniedAfter
			return {
				plan: result.value,
				fingerprint: JSON.stringify([choice, value]),
			}
		} catch {
			return blocked(signal?.aborted ? 'aborted' : 'request-failed')
		}
	}
	return Object.freeze({
		async review(
			choice: CollectionPrefixChoice,
			signal?: AbortSignal,
		): Promise<CollectionPrefixReviewResult> {
			const captured = structuredClone(choice)
			const result = await read(captured, signal)
			if ('status' in result) return result
			const review = Object.freeze({ projectId, dataset, plan: result.plan })
			proofs.set(review, { choice: captured, fingerprint: result.fingerprint })
			return { status: 'ready', review }
		},
		async recheck(
			review: CollectionPrefixReview,
			signal?: AbortSignal,
		): Promise<
			| { status: 'current' }
			| Extract<CollectionPrefixReviewResult, { status: 'blocked' }>
		> {
			const proof = proofs.get(review)
			if (!proof) return blocked('invalid-review')
			const fresh = await read(proof.choice, signal)
			if ('status' in fresh) return fresh
			if (fresh.fingerprint !== proof.fingerprint)
				return blocked('review-stale')
			return { status: 'current' }
		},
	})
}
