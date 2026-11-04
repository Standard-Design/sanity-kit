/**
 * The Pages tool's checked synchronization boundary. It adds organizational
 * folders without changing a page URL. Scheduling and editor feedback belong to
 * the Pages coordinator; this service handles fresh access evidence and uncertain
 * writes. Keep one instance for the tool's lifetime. See docs/folders.md.
 */
import {
	createPagesRegistry,
	type PagesRouteConfig,
} from '../../url/registry.js'
import type { PagesClient } from '../pages/data-source.js'
import { checkUrlReadAccess, type UrlAccessIssue } from '../url/access.js'
import { createFolderLoader } from './load.js'
import type { FolderRecord } from './planner.js'
import { createFolderWriter } from './write.js'

export type FolderSyncResult =
	| { readonly status: 'synced'; readonly count: number }
	| {
			readonly status: 'blocked'
			readonly reason: string
			readonly accessIssues?: readonly UrlAccessIssue[]
	  }

const blocked = (reason: string): FolderSyncResult => ({
	status: 'blocked',
	reason,
})

/**
 * Never derives permission or completeness from the visible navigator. Every run
 * checks the current account's read grants, then lets the existing writer load a
 * complete raw inventory and make one revision-guarded, additive write if needed.
 * The server enforces write permission; a read-only account can still confirm
 * that no folders need saving. No failed write is automatically retried here.
 */
export function createFolderSynchronizer(
	routes: PagesRouteConfig,
	client: PagesClient,
) {
	const registry = createPagesRegistry(routes)
	// Copy the route scope once, including nested collection configuration. A
	// caller mutating its original options must not change only the access check.
	const captured: PagesRouteConfig = {
		pages: registry.types
			.filter((type) => !type.collection)
			.map((type) => ({
				schemaType: type.schemaType,
				pathnameField: type.pathField,
				titleField: type.titleField,
			})),
		collections: registry.collections,
		excludePaths: registry.excludePaths,
		reservedPathPrefixes: registry.reservedPathPrefixes,
	}
	const writer = createFolderWriter({ routes: captured }, client)
	const load = createFolderLoader({ routes: captured }, client)
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
			'Folder synchronization needs a concrete project and dataset.',
		)
	let busy = false
	let uncertain: readonly FolderRecord[] = []

	async function synchronize(signal?: AbortSignal): Promise<FolderSyncResult> {
		if (signal?.aborted) return blocked('aborted')
		if (busy) return blocked('busy')
		busy = true
		try {
			let grants: unknown
			try {
				const request = {
					url: `/projects/${projectId}/datasets/${dataset}/acl`,
					tag: 'sanity-kit.folders-access',
					fetch: { cache: 'no-store', next: undefined },
					...(signal ? { signal } : {}),
				} as const
				grants = await source.request(request)
			} catch {
				return blocked(signal?.aborted ? 'aborted' : 'access-unavailable')
			}
			if (signal?.aborted) return blocked('aborted')
			const access = checkUrlReadAccess(captured, grants, 'edit')
			if (!access.ok)
				return {
					status: 'blocked',
					reason: 'unknown-read-access',
					accessIssues: access.issues,
				}

			if (uncertain.length) {
				const loaded = await load(
					{ readAccess: 'all-registered-versions' },
					signal,
				)
				if (loaded.status !== 'loaded') return blocked(loaded.reason)
				const saved = loaded.snapshot.registry?.folders ?? []
				// A missing key could mean a stale read, not a failed transaction.
				// Matching paths alone could belong to another editor's operation.
				if (
					!uncertain.every((pending) =>
						saved.some(
							(folder) =>
								folder._key === pending._key &&
								folder.pathname === pending.pathname,
						),
					)
				)
					return blocked('outcome-unknown')
				uncertain = []
			}

			const result = await writer.synchronize({
				readAccess: 'all-registered-versions',
				...(signal ? { signal } : {}),
			})
			// Do not discard this result when the signal becomes aborted. The write
			// may already have committed; retain uncertainty or the acknowledgment.
			if (result.status === 'outcome-unknown') {
				uncertain = result.added.map((folder) => ({ ...folder }))
				return blocked('outcome-unknown')
			}
			if (result.status === 'written' || result.status === 'unchanged')
				return { status: 'synced', count: result.added.length }
			return blocked(result.reason)
		} finally {
			busy = false
		}
	}

	return Object.freeze({ synchronize })
}
