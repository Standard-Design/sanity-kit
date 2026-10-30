/**
 * Assemble an ordinary-page snapshot before giving it to buildNavigationTree().
 * Each request is bounded, but the completed tree needs ALL ordinary pages in
 * memory. Posts are intentionally absent: their own browser loads them on demand.
 * data-session.ts owns subscriptions and restarts this read after changes. The
 * tree resource is ready for the navigator UI; the proof list does not use it.
 */
import {
	type createNavigationQueries,
	PAGE_BATCH_SIZE,
	type NavigationDocument,
} from './queries.js'

type PageQuery = ReturnType<ReturnType<typeof createNavigationQueries>['pages']>

/**
 * The caller binds authentication, dataset, and one effective perspective to
 * fetchBatch. Keep that binding unchanged throughout the read. Do not use raw:
 * choosing a draft/release version is Content Lake's job, not this assembler's.
 * This callback boundary also lets tests exercise aborts without a real dataset.
 */
export async function readPageSnapshot(
	queries: ReturnType<typeof createNavigationQueries>,
	fetchBatch: (
		plan: PageQuery,
		signal: AbortSignal,
	) => Promise<NavigationDocument[]>,
	signal: AbortSignal,
): Promise<NavigationDocument[]> {
	const documents: NavigationDocument[] = []
	let after = ''
	while (true) {
		signal.throwIfAborted()
		const batch = await fetchBatch(queries.pages(after), signal)
		// Some adapters cannot abort an in-flight transport. Never return its late
		// result to a newer perspective, even when the promise resolves successfully.
		signal.throwIfAborted()
		if (batch.length > PAGE_BATCH_SIZE)
			throw new Error('Pages snapshot received an oversized batch.')
		for (const document of batch) {
			if (
				document._id <= after ||
				document._id.startsWith('drafts.') ||
				document._id.startsWith('versions.')
			)
				throw new Error(
					'Pages snapshot requires increasing effective document IDs.',
				)
			documents.push(document)
			after = document._id
		}
		if (batch.length < PAGE_BATCH_SIZE) return documents
	}
}
