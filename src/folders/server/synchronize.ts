/**
 * Import-job folder adoption. Each call works toward the current desired folder
 * list; it does not recover or repeat a previous mutation. Unlike the Studio's
 * create/remove service, this boundary can only add folders implied by URLs.
 * @see docs/folder-import.md
 */
import {
	createPagesRegistry,
	type PagesRouteConfig,
} from '../../url/registry.js'
import { checkUrlReadAccess } from '../../studio/url/access.js'
import { createFolderWriter } from '../../studio/folders/write.js'

/** The small SDK surface used here; no Studio installation or hooks are needed. */
export interface FolderSyncClient {
	withConfig(config: {
		apiVersion: string
		perspective: 'raw'
		useCdn: false
		stega: false
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
				tag: string
				signal?: AbortSignal
			},
		): Promise<unknown>
		request(options: {
			url: string
			method?: 'POST'
			query?: Record<string, string>
			body?: unknown
			maxRetries?: 0
			fetch: { cache: 'no-store'; next: undefined }
			tag: string
			signal?: AbortSignal
		}): Promise<unknown>
	}
}

export interface FolderSyncAccessIssue {
	readonly key: string
	readonly label: string
	readonly status: 'missing' | 'unverified'
}
export type FolderSyncResult =
	| {
			readonly status: 'synced'
			/** Additions acknowledged by this call, never a count of earlier uncertain writes. */
			readonly count: number
			readonly evidence: 'write-confirmed' | 'already-present'
	  }
	| {
			readonly status: 'outcome-unknown'
			readonly reason: 'request-failed' | 'invalid-response'
	  }
	| {
			readonly status: 'blocked'
			readonly reason: string
			readonly accessIssues?: readonly FolderSyncAccessIssue[]
	  }

/**
 * After an import, call synchronize explicitly. No work starts on construction.
 * A later call, including after a process restart, reads and plans again. Strict
 * create/revision guards prevent an old delayed write from duplicating a newer
 * addition. This is additive convergence, not proof of an old operation's result.
 */
export function createFolderSynchronizer(
	routes: PagesRouteConfig,
	client: FolderSyncClient,
): {
	readonly synchronize: (signal?: AbortSignal) => Promise<FolderSyncResult>
} {
	const registry = createPagesRegistry(routes)
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
	// All reads and the mutation use this same captured client. The original
	// app client is not modified, and the registry writer stays private.
	const writer = createFolderWriter(
		{ routes: captured },
		{ withConfig: () => source },
	)
	let busy = false
	return Object.freeze({
		async synchronize(signal?: AbortSignal): Promise<FolderSyncResult> {
			if (signal?.aborted) return { status: 'blocked', reason: 'aborted' }
			if (busy) return { status: 'blocked', reason: 'busy' }
			busy = true
			try {
				const scope = source.config()
				if (scope.projectId !== projectId || scope.dataset !== dataset)
					return { status: 'blocked', reason: 'scope-changed' }
				let grants: unknown
				try {
					grants = await source.request({
						url: `/projects/${projectId}/datasets/${dataset}/acl`,
						tag: 'sanity-kit.folders-access',
						fetch: { cache: 'no-store', next: undefined },
						...(signal ? { signal } : {}),
					})
				} catch {
					return {
						status: 'blocked',
						reason: signal?.aborted ? 'aborted' : 'access-unavailable',
					}
				}
				if (signal?.aborted) return { status: 'blocked', reason: 'aborted' }
				const access = checkUrlReadAccess(captured, grants, 'edit')
				if (!access.ok)
					return {
						status: 'blocked',
						reason: 'unknown-read-access',
						accessIssues: access.issues,
					}
				const result = await writer.synchronize({
					readAccess: 'all-registered-versions',
					...(signal ? { signal } : {}),
				})
				if (result.status === 'written' || result.status === 'unchanged')
					return {
						status: 'synced',
						count: result.added.length,
						evidence:
							result.status === 'written'
								? 'write-confirmed'
								: 'already-present',
					}
				if (result.status === 'outcome-unknown')
					return { status: result.status, reason: result.reason }
				return { status: 'blocked', reason: result.reason }
			} finally {
				busy = false
			}
		},
	})
}
