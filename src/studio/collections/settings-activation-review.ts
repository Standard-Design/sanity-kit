/**
 * Read the complete evidence needed to activate a collection's first settings
 * document, then recognize only reviews created by this reader. Rechecking
 * repeats access and content reads: new documents matter as well as changed
 * revisions, especially settings identities that were previously absent.
 *
 * This service never writes. Raw uncached GROQ reads can still lag a committed
 * change; a successful recheck is neither a dataset lock nor proof that a later
 * publish will be safe. The eventual writer must apply its own final guards.
 */
import type { CollectionRoutingConfig } from '../../url/settings/resolve.js'
import { REDIRECT_MAX_RECORDS } from '../../redirect/snapshot.js'
import { fieldExpression } from '../pages/resolvers.js'
import {
	verifyCollectionPrefixReadAccess,
	type CollectionPrefixAccessDecision,
	type CollectionPrefixAccessIssue,
} from './prefix-access.js'
import {
	COLLECTION_PREFIX_LIMITS,
	type CollectionPrefixInventory,
} from './prefix-plan.js'
import type {
	CollectionPrefixReadAccessRequest,
	CollectionPrefixReviewClient,
} from './prefix-review.js'
import {
	createCollectionSettingsActivationPlanner,
	type CollectionSettingsActivationChoice,
	type CollectionSettingsActivationPlan,
	type CollectionSettingsActivationResult,
} from './settings-activation-plan.js'

export interface CollectionSettingsActivationReview {
	readonly projectId: string
	readonly dataset: string
	readonly plan: CollectionSettingsActivationPlan
}

export type CollectionSettingsActivationReviewResult =
	| {
			readonly status: 'ready'
			readonly review: CollectionSettingsActivationReview
	  }
	| {
			readonly status: 'blocked'
			readonly reason: string
			readonly planFailure?: Extract<
				CollectionSettingsActivationResult,
				{ ok: false }
			>
			readonly accessIssues?: readonly CollectionPrefixAccessIssue[]
	  }

type Blocked = Extract<
	CollectionSettingsActivationReviewResult,
	{ status: 'blocked' }
>
const blocked = (reason: string): Blocked => ({ status: 'blocked', reason })
const record = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value)

/** Use the same explicit native access contract as an existing-prefix review. */
export function createCollectionSettingsActivationReviewer(
	configuration: CollectionRoutingConfig,
	client: CollectionPrefixReviewClient,
	options: {
		readonly confirmReadAccess: (
			request: CollectionPrefixReadAccessRequest,
			signal?: AbortSignal,
		) => Promise<readonly CollectionPrefixAccessDecision[]>
	},
) {
	if (typeof options.confirmReadAccess !== 'function')
		throw new Error(
			'Collection settings activation needs an explicit read-access verifier.',
		)
	const config = structuredClone(configuration)
	const planner = createCollectionSettingsActivationPlanner(config)
	const requirements = planner.readRequirements
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
			'Collection settings activation needs a concrete project and dataset.',
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
	const exact = requirements.find(
		(requirement) => requirement.kind === 'exact-identities',
	)!
	const releases = requirements.find(
		(requirement) => requirement.kind === 'settings-release-identities',
	)!
	if (
		exact.kind !== 'exact-identities' ||
		releases.kind !== 'settings-release-identities'
	)
		throw new Error('Invalid activation settings read requirements.')
	const params: Record<string, unknown> = {
		types: types.map((type) => type.schemaType),
		settingsIds: exact.ids,
	}
	const settingsFilters = [
		'_id in $settingsIds',
		...releases.publishedIds.map((id, index) => {
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
	// Fetch one extra row so truncation cannot turn into a false absence or a
	// partial uniqueness check. Identity-based settings reads include wrong types.
	const query = `{
		"settings": *[${settingsFilters.join(' || ')}] | order(_id asc)[0...${COLLECTION_PREFIX_LIMITS.settingsVersions + 1}]{_id,_type,_rev,defined(_originalId)=>{_originalId},collection,prefix,displayName},
		"documents": *[_type in $types] | order(_id asc)[0...${COLLECTION_PREFIX_LIMITS.pageVersions + 1}]{_id,_type,_rev,defined(_originalId)=>{_originalId},"value":select(${values.join(',')}),"title":select(${titles.join(',')})},
		"redirects": *[_type == "sanityKitRedirect"] | order(_id asc)[0...${REDIRECT_MAX_RECORDS + 1}]{_id,_type,_rev,defined(_originalId)=>{_originalId},source,destination,status,enabled,origin}
	}`
	const proofs = new WeakMap<
		CollectionSettingsActivationReview,
		{
			readonly choice: CollectionSettingsActivationChoice
			readonly fingerprint: string
		}
	>()
	async function access(signal?: AbortSignal): Promise<Blocked | undefined> {
		if (signal?.aborted) return blocked('aborted')
		const answer = await options.confirmReadAccess(accessRequest, signal)
		if (signal?.aborted) return blocked('aborted')
		const result = verifyCollectionPrefixReadAccess(requirements, answer)
		return result.ok
			? undefined
			: { ...blocked('unknown-read-access'), accessIssues: result.issues }
	}
	async function read(
		choice: CollectionSettingsActivationChoice,
		signal?: AbortSignal,
	): Promise<
		| {
				readonly plan: CollectionSettingsActivationPlan
				readonly fingerprint: string
		  }
		| Blocked
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
				tag: 'sanity-kit.collection-settings-activation-review',
				...(signal ? { signal } : {}),
			})
			if (signal?.aborted) return blocked('aborted')
			if (
				!record(value) ||
				!Array.isArray(value.settings) ||
				!Array.isArray(value.documents) ||
				!Array.isArray(value.redirects)
			)
				return blocked('invalid-response')
			if (
				value.settings.length > COLLECTION_PREFIX_LIMITS.settingsVersions ||
				value.documents.length > COLLECTION_PREFIX_LIMITS.pageVersions ||
				value.redirects.length > REDIRECT_MAX_RECORDS ||
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
				function set(path: string, fieldValue: unknown) {
					let target = document
					const parts = path.split('.')
					for (const part of parts.slice(0, -1)) {
						if (!record(target[part])) target[part] = {}
						target = target[part] as Record<string, unknown>
					}
					target[parts.at(-1)!] = fieldValue
				}
				// Reconstruct registered fields for URL resolution only. This projected
				// document must never be used as a full replacement or publish payload.
				set(type.titleField, row.title)
				set(type.pathField, row.value)
				documents.push(document)
			}
			const inventory: CollectionPrefixInventory = {
				perspective: 'raw',
				complete: true,
				readAccess: 'all-required-versions',
				settings: value.settings,
				documents,
				redirects: value.redirects,
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
			choice: CollectionSettingsActivationChoice,
			signal?: AbortSignal,
		): Promise<CollectionSettingsActivationReviewResult> {
			if (signal?.aborted) return blocked('aborted')
			if (
				!record(choice) ||
				typeof choice.collection !== 'string' ||
				typeof choice.draftRevision !== 'string' ||
				!choice.draftRevision.trim()
			)
				return blocked('invalid-choice')
			// Capture only the supported fields before the first asynchronous check.
			const captured = {
				collection: choice.collection,
				draftRevision: choice.draftRevision,
			}
			const result = await read(captured, signal)
			if ('status' in result) return result
			const review = Object.freeze({ projectId, dataset, plan: result.plan })
			proofs.set(review, { choice: captured, fingerprint: result.fingerprint })
			return { status: 'ready', review }
		},
		async recheck(
			review: CollectionSettingsActivationReview,
			signal?: AbortSignal,
		): Promise<{ readonly status: 'current' } | Blocked> {
			const proof = proofs.get(review)
			if (!proof) return blocked('invalid-review')
			const result = await read(proof.choice, signal)
			if ('status' in result) return result
			if (result.fingerprint !== proof.fingerprint)
				return blocked('review-stale')
			return { status: 'current' }
		},
	})
}
