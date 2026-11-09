/**
 * Content-only publishing still belongs to Sanity. Before delegating, verify
 * that the raw URL did not change and that it is free in both live and preview
 * routing. This also covers first publishing, which has no old URL to redirect.
 */
import {
	createPagesRegistry,
	type PagesRouteConfig,
} from '../../url/registry.js'
import type { CollectionRoutingConfig } from '../../url/settings/resolve.js'
import type { PagesClient } from '../pages/data-source.js'
import { createCollectionUrlConflictChecker } from '../collections/url-conflicts.js'
import {
	collectionRouteMeaning,
	createCollectionRoutingGuard,
} from '../collections/routing-guard.js'

export function storedUrl(
	routes: PagesRouteConfig,
	document: Record<string, unknown> | null | undefined,
): unknown {
	const type = createPagesRegistry(routes).types.find(
		(entry) => entry.schemaType === document?._type,
	)
	return type?.pathField
		.split('.')
		.reduce<unknown>(
			(value, key) =>
				value && typeof value === 'object'
					? (value as Record<string, unknown>)[key]
					: undefined,
			document,
		)
}
export const missingStoredUrl = (value: unknown) =>
	value === undefined || value === null || value === ''

export async function checkNativeUrlPublication(
	configuration: CollectionRoutingConfig,
	routes: PagesRouteConfig,
	client: PagesClient,
	draft: Record<string, unknown>,
	published?: Record<string, unknown> | null,
	signal?: AbortSignal,
): Promise<{ ok: true } | { ok: false; reason: string }> {
	const value = storedUrl(routes, draft),
		previous = storedUrl(routes, published)
	const missing = missingStoredUrl(value) && missingStoredUrl(previous)
	if (published && !missing && previous !== value)
		return { ok: false, reason: 'url-changed' }
	if (missing) {
		// Optional fields may stay absent. There is no URL ownership to check,
		// but missing/inaccessible routing settings must not silently use defaults.
		const checked = await createCollectionRoutingGuard(
			configuration,
			routes,
			client,
			{ allowDifferentDraftRoutes: true },
		)(signal)
		return checked.ok ? { ok: true } : checked
	}
	const checked = await createCollectionUrlConflictChecker(
		configuration,
		client,
	)(
		{
			schemaType: String(draft._type),
			storedValue: value,
			documentId: String(draft._id),
		},
		signal,
	)
	if (checked.status !== 'checked') return { ok: false, reason: checked.reason }
	if (
		collectionRouteMeaning(checked.routing.published.routes) !==
		collectionRouteMeaning(routes)
	)
		return { ok: false, reason: 'routing-changed' }
	if (checked.published.conflicts.length || checked.drafts.conflicts.length)
		return { ok: false, reason: 'url-in-use' }
	return { ok: true }
}
