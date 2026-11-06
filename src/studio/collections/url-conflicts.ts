/**
 * Check a proposed URL against both live and draft collection prefixes. This is
 * the private authoring boundary for the later settings-aware field integration;
 * a preview snapshot alone is not enough evidence to save or publish a URL.
 * @see docs/collection-routing.md
 */
import type { SlugIsUniqueValidator } from 'sanity'
import { createCollectionRoutingLoader } from '../../url/settings/load.js'
import type { CollectionRoutingConfig } from '../../url/settings/resolve.js'
import { createPagesRegistry } from '../../url/registry.js'
import type { PagesClient } from '../pages/data-source.js'
import {
	checkRoutingSettingsReadAccess,
	checkUrlConflictReadAccess,
	type UrlAccessIssue,
} from '../url/access.js'
import {
	createUrlConflictChecker,
	URL_CONFLICT_LIMIT,
	type UrlConflict,
	type UrlConflictRequest,
	type UrlConflictResult,
} from '../url/conflicts.js'

type Checked = Extract<UrlConflictResult, { status: 'checked' }>
type Pair = Extract<
	Awaited<
		ReturnType<ReturnType<typeof createCollectionRoutingLoader>['loadBoth']>
	>,
	{ ok: true }
>
export type CollectionUrlConflictResult =
	| {
			readonly status: 'checked'
			/** Each view retains its own candidate URL and conflict list. */
			readonly published: Checked
			readonly drafts: Checked
			readonly routing: Pair
	  }
	| Exclude<UrlConflictResult, Checked>
	| {
			readonly status: 'unavailable'
			readonly reason: string
			readonly accessIssues?: readonly UrlAccessIssue[]
	  }
const unavailable = (reason: string) => ({
	status: 'unavailable' as const,
	reason,
})

/**
 * No React context or Pages tool is required. Native validation, a standalone
 * field, and future publish reviews can share this same fresh-read check.
 * It reserves both old and proposed URL spaces conservatively: all versions of
 * another identity count in both views until the collection prefix is published.
 */
export function createCollectionUrlConflictChecker(
	configuration: CollectionRoutingConfig,
	client: Pick<PagesClient, 'withConfig'>,
) {
	const config = structuredClone(configuration)
	const loader = createCollectionRoutingLoader(config, client)
	const sourceOptions = {
		apiVersion: '2026-10-01',
		useCdn: false,
		perspective: 'raw',
		stega: false,
		// The SDK accepts fetch cache controls outside Next at runtime, although its
		// conditional declarations hide them when Next types are not installed.
		fetch: { cache: 'no-store', next: undefined } as unknown as NonNullable<
			NonNullable<Parameters<PagesClient['withConfig']>[0]>['fetch']
		>,
	} as const
	const source = client.withConfig(sourceOptions)
	const { projectId, dataset } = source.config()
	if (
		!projectId ||
		!/^[a-z0-9]+$/u.test(projectId) ||
		!dataset ||
		!/^[a-z0-9_][a-z0-9_-]*$/u.test(dataset)
	)
		throw new Error(
			'Collection URL checks need a concrete project and dataset.',
		)
	const settingsIds = loader.documentIds.flatMap((id) => [id, `drafts.${id}`])

	async function load(
		signal?: AbortSignal,
	): Promise<
		Pair | Exclude<CollectionUrlConflictResult, { status: 'checked' }>
	> {
		if (signal?.aborted) return unavailable('aborted')
		let grants: unknown
		try {
			const request = {
				url: `/projects/${projectId}/datasets/${dataset}/acl`,
				tag: 'sanity-kit.collection-url-access',
				fetch: { cache: 'no-store', next: undefined },
				...(signal ? { signal } : {}),
			} as const
			grants = await source.request(request)
		} catch {
			return unavailable(signal?.aborted ? 'aborted' : 'access-unavailable')
		}
		if (signal?.aborted) return unavailable('aborted')
		const settingsAccess = checkRoutingSettingsReadAccess(settingsIds, grants)
		if (!settingsAccess.ok)
			return {
				...unavailable('unknown-read-access'),
				accessIssues: settingsAccess.issues,
			}
		const routing = await loader.loadBoth({
			draftVisibility: 'all-required-drafts',
			...(signal ? { signal } : {}),
		})
		if (!routing.ok) return unavailable(routing.reason)
		// The type/field registration is identical in both views. Only resolved
		// prefixes differ, so one occupancy access proof covers every cross-view query.
		const access = checkUrlConflictReadAccess(routing.published.routes, grants)
		if (!access.ok)
			return {
				...unavailable('unknown-read-access'),
				accessIssues: access.issues,
			}
		return routing
	}
	const fingerprint = (routing: Pair) =>
		JSON.stringify([routing.published.settings, routing.drafts.settings])
	return async (
		request: UrlConflictRequest,
		signal?: AbortSignal,
	): Promise<CollectionUrlConflictResult> => {
		const routing = await load(signal)
		if (!('ok' in routing)) return routing
		const contexts = [routing.published.routes, routing.drafts.routes]
		// Each candidate must be checked against BOTH occupancy contexts. Comparing
		// only matching views misses a draft URL that another collection owns live,
		// or a live URL that another collection plans to use in its draft settings.
		const results = await Promise.all(
			contexts.flatMap((candidateRoutes) =>
				contexts.map((occupancyRoutes) =>
					createUrlConflictChecker(occupancyRoutes, source, {
						candidateRoutes,
					})(request, signal),
				),
			),
		)
		const checked: Checked[] = []
		const seen = new Map<string, UrlConflict>()
		for (const result of results) {
			if (result.status !== 'checked') return result
			for (const conflict of result.conflicts) {
				const previous = seen.get(conflict.documentId)
				if (
					previous &&
					(previous.revision !== conflict.revision ||
						previous.schemaType !== conflict.schemaType ||
						previous.version !== conflict.version)
				)
					return unavailable('conflicts-changed')
				seen.set(conflict.documentId, conflict)
			}
			checked.push(result)
		}
		function merge(first: Checked, second: Checked): Checked {
			const conflicts = [
				...new Map(
					[...first.conflicts, ...second.conflicts].map((conflict) => [
						conflict.documentId,
						conflict,
					]),
				).values(),
			].sort((a, b) => a.documentId.localeCompare(b.documentId))
			return {
				status: 'checked',
				candidate: first.candidate,
				conflicts: conflicts.slice(0, URL_CONFLICT_LIMIT),
				hasMore:
					first.hasMore ||
					second.hasMore ||
					conflicts.length > URL_CONFLICT_LIMIT,
			}
		}
		const published = merge(checked[0]!, checked[1]!)
		const drafts = merge(checked[2]!, checked[3]!)
		// A setting can be edited or published while the queries run. Recheck its
		// exact selected revisions and access before returning usable evidence.
		const fresh = await load(signal)
		if (!('ok' in fresh)) return fresh
		if (fingerprint(fresh) !== fingerprint(routing))
			return unavailable('routing-changed')
		return { status: 'checked', published, drafts, routing }
	}
}

/**
 * Private native validator for a future settings-backed field factory. It checks
 * the registered slug-object path and rejects incomplete checks rather than
 * interpreting a failed settings load as an available URL. It never writes.
 */
export function createCollectionUrlIsUnique(
	config: CollectionRoutingConfig,
): SlugIsUniqueValidator {
	const snapshot = structuredClone(config)
	return async (value, context) => {
		const document = context.document
		if (!document)
			throw new Error('Collection URL uniqueness needs a document.')
		const checker = createCollectionUrlConflictChecker(
			snapshot,
			context.getClient({ apiVersion: '2026-10-01' }),
		)
		const result = await checker(
			{
				schemaType: document._type,
				storedValue: value,
				...(document._id ? { documentId: document._id } : {}),
			},
			context.signal,
		)
		if (result.status !== 'checked')
			throw new Error(`Cannot check URL uniqueness: ${result.reason}.`)
		const type = createPagesRegistry(result.routing.drafts.routes).types.find(
			(entry) => entry.schemaType === document._type,
		)
		const expected = type?.pathField.split('.')
		const actual = [...(context.path ?? []), 'current']
		if (
			!expected ||
			expected.at(-1) !== 'current' ||
			expected.length !== actual.length ||
			expected.some((part, index) => part !== actual[index])
		)
			throw new Error('URL uniqueness must use the registered slug field.')
		if (
			result.drafts.candidate.storedValue !== value ||
			result.published.candidate.storedValue !== value
		)
			throw new Error('Cannot check URL uniqueness: noncanonical-path.')
		return (
			result.published.conflicts.length === 0 &&
			result.drafts.conflicts.length === 0
		)
	}
}
