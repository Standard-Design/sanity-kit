/**
 * The authenticated Studio transport. Keep SDK-specific fetch/listen options in
 * one place; data-session.ts owns request lifetimes, not credentials or routing.
 */
import type { useClient } from 'sanity'

// Use Studio's own client type. Its bundled client may be newer than the app's
// direct dependency; their class-private identities need not match.
export type PagesClient = ReturnType<typeof useClient>

export interface PageQueryPlan {
	query: string
	params: Record<string, unknown>
}

export interface PagesDataSource {
	fetch<T>(plan: PageQueryPlan, signal: AbortSignal): Promise<T>
	listen(observer: {
		next: (event: { type: string }) => void
		error: () => void
	}): {
		unsubscribe(): void
	}
}

/** One source is permanently bound to one effective perspective, never raw. */
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
		listen: (observer) =>
			client
				.listen(
					'*[_type in $types]',
					{ types },
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
