/**
 * Fresh routing evidence for writes that currently support one shared live/draft
 * URL space. A displayed preview snapshot is not enough: settings can be edited
 * while a review or permission check is open. This guard never publishes them.
 */
import {
	createPagesRegistry,
	type PagesRouteConfig,
} from '../../url/registry.js'
import {
	createCollectionRoutingLoader,
	type CollectionSettingsClient,
} from '../../url/settings/load.js'
import type { CollectionRoutingConfig } from '../../url/settings/resolve.js'
import {
	checkRoutingSettingsReadAccess,
	type UrlAccessIssue,
} from '../url/access.js'
import type {
	FolderRenameAuthorization,
	FolderRenameWriteTarget,
} from '../folders/rename-write.js'

/** Structural boundary accepts either the app's or Studio's installed SDK. */
export interface CollectionRoutingGuardClient {
	withConfig(
		config: Parameters<CollectionSettingsClient['withConfig']>[0],
	): ReturnType<CollectionSettingsClient['withConfig']> & {
		config(): { projectId?: string; dataset?: string }
		request(options: {
			url: string
			tag: string
			maxRetries: number
			fetch: { cache: 'no-store'; next: undefined }
			signal?: AbortSignal
		}): Promise<unknown>
	}
}

export type CollectionRoutingGuardResult =
	| { readonly ok: true; readonly fingerprint: string }
	| {
			readonly ok: false
			readonly reason: string
			readonly accessIssues?: readonly UrlAccessIssue[]
	  }

/** Labels are editorial presentation, not ownership of paths or stored values. */
export function collectionRouteMeaning(routes: PagesRouteConfig): string {
	const registry = createPagesRegistry(routes)
	return JSON.stringify({
		types: [...registry.types]
			.sort((a, b) => a.schemaType.localeCompare(b.schemaType))
			.map((type) => ({
				schemaType: type.schemaType,
				pathField: type.pathField,
				pathMode: type.pathMode,
				routePrefix: type.routePrefix ?? null,
				collection: type.collection ?? null,
			})),
		collections: [...registry.collections]
			.sort((a, b) => a.name.localeCompare(b.name))
			.map((collection) => ({
				name: collection.name,
				routePrefix: collection.routePrefix,
				index: {
					schemaType: collection.index.schemaType,
					pathname: collection.index.pathname,
				},
			})),
		excludePaths: [...registry.excludePaths].sort(),
		reservedPathPrefixes: [...registry.reservedPathPrefixes].sort(),
	})
}

/**
 * All settings IDs are checked, including absent draft counterparts. A successful
 * query alone cannot show whether a draft was absent or hidden by permissions.
 * Unchanged fixed-prefix configurations need no settings request or ACL proof.
 * Only content-only native publishing may allow different draft routes: it still
 * proves both contexts readable and valid, and verifies the expected live routes.
 * URL/redirect/folder mutations must use the default strict comparison.
 */
export function createCollectionRoutingGuard(
	configuration: CollectionRoutingConfig,
	expectedRoutes: PagesRouteConfig,
	client: CollectionRoutingGuardClient,
	options: { readonly allowDifferentDraftRoutes?: boolean } = {},
) {
	const config = structuredClone(configuration)
	const expected = collectionRouteMeaning(expectedRoutes)
	const loader = createCollectionRoutingLoader(config, client)
	const source = client.withConfig({
		apiVersion: '2026-10-01',
		perspective: 'raw',
		useCdn: false,
		stega: false,
	})
	const { projectId, dataset } = source.config()
	if (
		!projectId ||
		!/^[a-z0-9]+$/u.test(projectId) ||
		!dataset ||
		!/^[a-z0-9_][a-z0-9_-]*$/u.test(dataset)
	)
		throw new Error(
			'Collection routing checks need a concrete project and dataset.',
		)
	const ids = loader.documentIds.flatMap((id) => [id, `drafts.${id}`])
	return async (
		signal?: AbortSignal,
	): Promise<CollectionRoutingGuardResult> => {
		if (signal?.aborted) return { ok: false, reason: 'aborted' }
		try {
			if (ids.length) {
				const request = {
					url: `/projects/${projectId}/datasets/${dataset}/acl`,
					tag: 'sanity-kit.collection-routing-guard',
					maxRetries: 0,
					fetch: { cache: 'no-store', next: undefined },
					...(signal ? { signal } : {}),
				} as const
				const grants: unknown = await source.request(request)
				if (signal?.aborted) return { ok: false, reason: 'aborted' }
				const access = checkRoutingSettingsReadAccess(ids, grants)
				if (!access.ok)
					return {
						ok: false,
						reason: 'unknown-read-access',
						accessIssues: access.issues,
					}
			}
			const pair = await loader.loadBoth({
				draftVisibility: 'all-required-drafts',
				...(signal ? { signal } : {}),
			})
			if (signal?.aborted) return { ok: false, reason: 'aborted' }
			if (!pair.ok) return { ok: false, reason: pair.reason }
			const published = collectionRouteMeaning(pair.published.routes)
			const drafts = collectionRouteMeaning(pair.drafts.routes)
			if (!options.allowDifferentDraftRoutes && published !== drafts)
				return { ok: false, reason: 'collection-prefix-unpublished' }
			if (published !== expected)
				return { ok: false, reason: 'routing-changed' }
			return {
				ok: true,
				fingerprint: JSON.stringify([
					[...pair.published.settings].sort((a, b) =>
						a.collection.localeCompare(b.collection),
					),
					[...pair.drafts.settings].sort((a, b) =>
						a.collection.localeCompare(b.collection),
					),
				]),
			}
		} catch {
			return {
				ok: false,
				reason: signal?.aborted ? 'aborted' : 'request-failed',
			}
		}
	}
}

/**
 * Keep folder rename available when settings resolve to the reviewed routes.
 * Recheck after native permission/readOnly evaluation too, without replacing
 * those checks or the writer's revision guards and fresh inventory review.
 */
export function createCollectionFolderAuthorizer(options: {
	readonly configuration: CollectionRoutingConfig
	readonly routes: PagesRouteConfig
	readonly client: CollectionRoutingGuardClient
	readonly authorize: (request: {
		readonly targets: readonly FolderRenameWriteTarget[]
		readonly signal?: AbortSignal
	}) => Promise<FolderRenameAuthorization>
}) {
	const guard = createCollectionRoutingGuard(
		options.configuration,
		options.routes,
		options.client,
	)
	return async (request: {
		readonly targets: readonly FolderRenameWriteTarget[]
		readonly signal?: AbortSignal
	}): Promise<FolderRenameAuthorization> => {
		const before = await guard(request.signal)
		if (!before.ok) return { ok: false, reason: 'unverified' }
		const access = await options.authorize(request)
		if (!access.ok) return access
		const after = await guard(request.signal)
		if (!after.ok || after.fingerprint !== before.fingerprint)
			return { ok: false, reason: 'unverified' }
		return access
	}
}
