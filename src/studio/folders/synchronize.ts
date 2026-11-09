/**
 * The Pages tool's checked folder creation and synchronization boundary. It adds
 * organizational folders and removes empty ones without changing a page URL.
 * Scheduling and feedback belong to the Pages coordinator; this service handles fresh access evidence and uncertain
 * writes. Share its operation state when route settings replace a service. See docs/folders.md.
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
 * Owned by one mounted tool and dataset, not one routing snapshot. A fresh
 * settings snapshot may replace the service while an earlier request is still
 * unresolved; its write lock and exact pending identities must survive that.
 * This is deliberately not a global cache or persisted routing configuration.
 */
export function createFolderSynchronizationState() {
	return {
		scope: undefined as string | undefined,
		busy: false,
		uncertain: [] as readonly FolderRecord[],
		uncertainRemoval: [] as readonly FolderRecord[],
	}
}

/**
 * Never derives permission or completeness from the visible navigator. Every run
 * checks the current account's read grants, then lets the existing writer load a
 * complete raw inventory and make one revision-guarded registry write if needed.
 * The server enforces write permission; a read-only account can still confirm
 * that no folders need saving. No failed write is automatically retried here.
 */
export function createFolderSynchronizer(
	routes: PagesRouteConfig,
	client: PagesClient,
	options: {
		readonly beforeRemove?: (signal?: AbortSignal) => Promise<boolean>
		readonly state?: ReturnType<typeof createFolderSynchronizationState>
	} = {},
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
	const writer = createFolderWriter(
		{
			routes: captured,
			...(options.beforeRemove ? { beforeRemove: options.beforeRemove } : {}),
		},
		client,
	)
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
	const state = options.state ?? createFolderSynchronizationState()
	const scope = JSON.stringify([projectId, dataset])
	if (state.scope && state.scope !== scope)
		throw new Error('Folder synchronization state belongs to another dataset.')
	state.scope = scope

	async function run(
		operation: 'synchronize' | 'create' | 'remove',
		signal?: AbortSignal,
		pathname?: string,
	): Promise<FolderSyncResult> {
		if (signal?.aborted) return blocked('aborted')
		if (state.busy) return blocked('busy')
		state.busy = true
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

			if (state.uncertain.length || state.uncertainRemoval.length) {
				const loaded = await load(
					{ readAccess: 'all-registered-versions' },
					signal,
				)
				if (loaded.status !== 'loaded') return blocked(loaded.reason)
				const saved = loaded.snapshot.registry?.folders ?? []
				// A missing key could mean a stale read, not a failed transaction.
				// Matching paths alone could belong to another editor's operation.
				if (
					!state.uncertain.every((pending) =>
						saved.some(
							(folder) =>
								folder._key === pending._key &&
								folder.pathname === pending.pathname,
						),
					)
				)
					return blocked('outcome-unknown')
				// Absence of both identity and pathname confirms the observed removal.
				// If a replacement now occupies the same path, never remove it as
				// an automatic retry of the previous editor-confirmed operation.
				if (
					state.uncertainRemoval.some((pending) =>
						saved.some(
							(folder) =>
								folder._key === pending._key ||
								folder.pathname === pending.pathname,
						),
					)
				)
					return blocked('outcome-unknown')
				const removedRequested = state.uncertainRemoval.some(
					(folder) => folder.pathname === pathname,
				)
				state.uncertain = []
				state.uncertainRemoval = []
				if (operation === 'remove' && removedRequested)
					return { status: 'synced', count: 1 }
			}

			const request = {
				readAccess: 'all-registered-versions',
				...(signal ? { signal } : {}),
			} as const
			const result =
				operation === 'create'
					? await writer.create({ ...request, pathname: pathname! })
					: operation === 'remove'
						? await writer.remove({ ...request, pathname: pathname! })
						: await writer.synchronize(request)
			// Do not discard this result when the signal becomes aborted. The write
			// may already have committed; retain uncertainty or the acknowledgment.
			if (result.status === 'outcome-unknown') {
				state.uncertain = result.added.map((folder) => ({ ...folder }))
				state.uncertainRemoval = (result.removed ?? []).map((folder) => ({
					...folder,
				}))
				return blocked('outcome-unknown')
			}
			if (result.status === 'written' || result.status === 'unchanged')
				return {
					status: 'synced',
					count:
						operation === 'remove'
							? result.status === 'written'
								? (result.removed?.length ?? 0)
								: 0
							: result.added.length,
				}
			return blocked(result.reason)
		} finally {
			state.busy = false
		}
	}

	return Object.freeze({
		synchronize: (signal?: AbortSignal) => run('synchronize', signal),
		// Sharing this boundary means an uncertain creation also blocks later
		// synchronization, and vice versa, until exact saved records are found.
		create: (pathname: string, signal?: AbortSignal) =>
			run('create', signal, pathname),
		remove: (pathname: string, signal?: AbortSignal) =>
			run('remove', signal, pathname),
	})
}
