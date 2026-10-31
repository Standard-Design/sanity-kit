/**
 * The authenticated Studio transport. Keep SDK-specific fetch/listen options in
 * one place; data-session.ts owns request lifetimes, not credentials or routing.
 */
import type { useClient } from 'sanity'
import type { FolderReadClient } from '../folders/load.js'
import { FOLDER_REGISTRY_ID, folderRegistryQuery } from './folder-registry.js'

// Use Studio's own client type. Its bundled client may be newer than the app's
// direct dependency; their class-private identities need not match.
export type PagesClient = ReturnType<typeof useClient>

export interface PageQueryPlan {
	query: string
	params: Record<string, unknown>
}

export interface PagesDataSource {
	fetch<T>(plan: PageQueryPlan, signal: AbortSignal): Promise<T>
	/** Read-only display metadata, never completeness/permission evidence for writes. */
	fetchFolderRegistry(signal: AbortSignal): Promise<unknown>
	listen(observer: {
		next: (event: { type: string }) => void
		error: () => void
	}): {
		unsubscribe(): void
	}
}

/** Page reads use one effective perspective; organizational metadata uses its exact ID. */
export function createPagesDataSource(
	client: PagesClient,
	perspective: readonly string[],
	types: readonly string[],
): PagesDataSource {
	if (perspective.includes('raw'))
		throw new Error(
			'Pages requires an effective perspective, not raw versions.',
		)
	const view = perspective.length ? [...perspective] : ['published']
	return {
		fetch: <T>(plan: PageQueryPlan, signal: AbortSignal) =>
			client.fetch<T>(plan.query, plan.params, {
				perspective: view,
				useCdn: false,
				stega: false,
				signal,
			}),
		fetchFolderRegistry: (signal) => {
			// The existing structural read boundary models the SDK's runtime cache
			// support without importing Next's global RequestInit type augmentation.
			const reader: FolderReadClient = client
			const options = {
				perspective: 'raw',
				useCdn: false,
				stega: false,
				filterResponse: true,
				cache: 'no-store',
				next: undefined,
				tag: 'sanity-kit.pages-folders',
				signal,
			} as const
			return reader
				.withConfig({
					apiVersion: '2026-10-01',
					perspective: 'raw',
					useCdn: false,
					stega: false,
				})
				.fetch(folderRegistryQuery, { registryId: FOLDER_REGISTRY_ID }, options)
		},
		listen: (observer) =>
			client
				.listen(
					'*[_type in $types || _id == $registryId]',
					{ types, registryId: FOLDER_REGISTRY_ID },
					{
						includeResult: false,
						includeMutations: false,
						includeAllVersions: true,
						visibility: 'query',
						events: ['welcome', 'mutation', 'reconnect'],
					},
				)
				.subscribe({ ...observer, complete: observer.error }),
	}
}
