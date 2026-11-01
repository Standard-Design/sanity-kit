/**
 * Prepare a URL change for the native form. Page patches stay with the input;
 * this controller reads access/version evidence and preserves folder metadata.
 * Only unpublished documents without release versions are editable in this first
 * field slice. Reviewed live moves and redirects are a separate workflow.
 */
import { getPublishedId } from 'sanity'
import { createUrlAuthoring, type UrlCandidate } from '../../url/authoring.js'
import {
	createPagesRegistry,
	type PagesRouteConfig,
} from '../../url/registry.js'
import { createSanityUrlResolver } from '../../url/resolve.js'
import { createFolderLoader, type FolderSnapshot } from '../folders/load.js'
import type { FolderRecord } from '../folders/planner.js'
import { createFolderWriter } from '../folders/write.js'
import type { PagesClient } from '../pages/data-source.js'
import { createUrlConflictChecker } from './conflicts.js'

export interface UrlEditDocument extends Record<string, unknown> {
	readonly _id: string
	readonly _type: string
}

export interface UrlEditRequest {
	readonly document: UrlEditDocument
	readonly readOnly: boolean
}

export type UrlEditBlocked = {
	readonly status: 'blocked'
	readonly reason: string
}
export type UrlEditLoadResult =
	| UrlEditBlocked
	| {
			readonly status: 'loaded'
			readonly folders: readonly { readonly pathname: string }[]
			readonly editable: boolean
			readonly reason?: string
	  }
export type UrlEditPrepareResult =
	| UrlEditBlocked
	| { readonly status: 'ready'; readonly candidate: UrlCandidate }
export type UrlEditCreateResult = UrlEditBlocked | { readonly status: 'saved' }

const blocked = (reason: string): UrlEditBlocked => ({
	status: 'blocked',
	reason,
})
const record = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value)

function fieldValue(document: Record<string, unknown>, path: string) {
	let value: unknown = document
	for (const part of path.split('.')) {
		if (!record(value) || !Object.hasOwn(value, part)) return undefined
		value = value[part]
	}
	return value
}

/**
 * Accept only explicitly unconditional read grants. An empty GROQ result is not
 * proof of visibility. Custom filtered grants need a future reviewed evaluator;
 * this first integration refuses them rather than guessing about their coverage.
 */
function hasCompleteReadAccess(input: unknown): boolean {
	return (
		Array.isArray(input) &&
		input.some(
			(grant: unknown) =>
				record(grant) &&
				(grant.filter === 'true' || grant.filter === '_id in path("**")') &&
				Array.isArray(grant.permissions) &&
				grant.permissions.includes('read'),
		)
	)
}

/**
 * One controller belongs to one mounted field. invalidate() stops stale actions,
 * but never forgets an uncertain folder mutation. A fresh read must confirm its
 * exact keys/paths before another mutation can be attempted by this controller.
 */
export function createUrlEditController(
	routes: PagesRouteConfig,
	client: PagesClient,
) {
	const registry = createPagesRegistry(routes)
	const authoring = createUrlAuthoring(routes)
	const resolve = createSanityUrlResolver(routes)
	const loadFolders = createFolderLoader({ routes }, client)
	const writer = createFolderWriter({ routes }, client)
	const checkConflicts = createUrlConflictChecker(routes, client)
	const source = client.withConfig({
		apiVersion: '2026-10-01',
		useCdn: false,
		stega: false,
		perspective: 'raw',
	})
	const { projectId, dataset } = source.config()
	if (
		!projectId ||
		!/^[a-z0-9]+$/u.test(projectId) ||
		!dataset ||
		!/^[a-z0-9_][a-z0-9_-]*$/u.test(dataset)
	)
		throw new Error('URL editing needs a concrete project and dataset.')
	const groups = new Set(
		registry.collections.map((group) => group.overview.pathname),
	)
	let epoch = 0
	let busy = false
	let uncertain: readonly FolderRecord[] = []
	const controllers = new Set<AbortController>()

	function operation(signal?: AbortSignal) {
		const controller = new AbortController()
		controllers.add(controller)
		const abort = () => controller.abort()
		if (signal?.aborted) abort()
		else signal?.addEventListener('abort', abort, { once: true })
		const started = epoch
		return {
			signal: controller.signal,
			stopped: () => controller.signal.aborted || started !== epoch,
			finish() {
				controllers.delete(controller)
				signal?.removeEventListener('abort', abort)
			},
		}
	}

	async function evidence(
		signal: AbortSignal,
	): Promise<FolderSnapshot | UrlEditBlocked> {
		if (signal.aborted) return blocked('aborted')
		let grants: unknown
		try {
			const options = {
				url: `/projects/${projectId}/datasets/${dataset}/acl`,
				tag: 'sanity-kit.url-access',
				signal,
				fetch: { cache: 'no-store', next: undefined },
			} as const
			grants = await source.request(options)
		} catch {
			return blocked(signal.aborted ? 'aborted' : 'access-unavailable')
		}
		if (signal.aborted) return blocked('aborted')
		if (!hasCompleteReadAccess(grants)) return blocked('unknown-read-access')
		const loaded = await loadFolders(
			{ readAccess: 'all-registered-versions' },
			signal,
		)
		if (loaded.status !== 'loaded') return blocked(`folders-${loaded.reason}`)
		if (uncertain.length) {
			const saved = loaded.snapshot.registry?.folders ?? []
			if (
				!uncertain.every((pending) =>
					saved.some(
						(item) =>
							item._key === pending._key && item.pathname === pending.pathname,
					),
				)
			)
				return blocked('folder-outcome-unknown')
			uncertain = []
		}
		return loaded.snapshot
	}

	function versionReason(
		document: UrlEditDocument,
		snapshot: FolderSnapshot,
	): string | undefined {
		if (!registry.types.some((type) => type.schemaType === document._type))
			return 'unregistered-type'
		const id = document._id
		if (
			typeof id !== 'string' ||
			!/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,127}$/u.test(id) ||
			id.includes('..') ||
			id.endsWith('.')
		)
			return 'invalid-document-id'
		if (id.startsWith('versions.')) return 'release-version'
		const publishedId = getPublishedId(id)
		for (const value of snapshot.inventory.documents) {
			if (
				!record(value) ||
				typeof value._id !== 'string' ||
				getPublishedId(value._id) !== publishedId
			)
				continue
			if (value._id.startsWith('versions.')) return 'release-version'
			if (!value._id.startsWith('drafts.')) return 'published-document'
		}
	}

	function displayedFolders(snapshot: FolderSnapshot) {
		const paths = new Set(
			(snapshot.registry?.folders ?? []).map((item) => item.pathname),
		)
		const addAncestors = (initial: string) => {
			let parent = initial
			while (parent !== '/') {
				if (!groups.has(parent)) paths.add(parent)
				parent = parent.slice(0, parent.lastIndexOf('/')) || '/'
			}
		}
		for (const group of groups)
			addAncestors(group.slice(0, group.lastIndexOf('/')) || '/')
		// This is display-only inference. Invalid paths stay the URL field's concern;
		// they must not prevent an editor from correcting that document's URL.
		for (const value of snapshot.inventory.documents) {
			if (
				!record(value) ||
				registry.types.find((type) => type.schemaType === value._type)
					?.collection
			)
				continue
			const resolved = resolve(value)
			if (!resolved.ok) continue
			addAncestors(resolved.value.prefix)
		}
		return [...paths].sort().map((pathname) => ({ pathname }))
	}

	async function preserve(
		pathname: string,
		signal: AbortSignal,
	): Promise<UrlEditBlocked | undefined> {
		if (pathname === '/') return
		if (groups.has(pathname))
			return preserve(
				pathname.slice(0, pathname.lastIndexOf('/')) || '/',
				signal,
			)
		const result = await writer.create({
			pathname,
			readAccess: 'all-registered-versions',
			signal,
		})
		if (result.status === 'outcome-unknown') {
			uncertain = result.added
			return blocked('folder-outcome-unknown')
		}
		if (result.status !== 'written' && result.status !== 'unchanged')
			return blocked(`folders-${result.reason}`)
	}

	return Object.freeze({
		invalidate() {
			epoch += 1
			for (const controller of controllers) controller.abort()
		},
		async load(
			document: UrlEditDocument,
			signal?: AbortSignal,
		): Promise<UrlEditLoadResult> {
			// The input cancels this read on document identity changes and unmount.
			// Editing an unrelated title invalidates actions, not folder display:
			// otherwise a pending initial read could leave the field disabled forever.
			const readSignal = signal ?? new AbortController().signal
			const snapshot = await evidence(readSignal)
			if (readSignal.aborted) return blocked('aborted')
			if ('status' in snapshot) return snapshot
			const reason = versionReason(document, snapshot)
			return {
				status: 'loaded',
				folders: displayedFolders(snapshot),
				editable: !reason,
				...(reason ? { reason } : {}),
			}
		},
		async prepare(
			request: UrlEditRequest & { readonly storedValue: unknown },
			signal?: AbortSignal,
		): Promise<UrlEditPrepareResult> {
			if (request.readOnly) return blocked('read-only')
			if (busy) return blocked('busy')
			busy = true
			const op = operation(signal)
			try {
				const document = structuredClone(request.document)
				const candidate = authoring.prepareStored(
					document._type,
					request.storedValue,
				)
				if (!candidate.ok) return blocked(candidate.reason)
				const snapshot = await evidence(op.signal)
				if (op.stopped()) return blocked('aborted')
				if ('status' in snapshot) return snapshot
				const reason = versionReason(document, snapshot)
				if (reason) return blocked(reason)
				const checked = await checkConflicts(
					{
						schemaType: document._type,
						storedValue: candidate.value.storedValue,
						documentId: document._id,
					},
					op.signal,
				)
				if (op.stopped()) return blocked('aborted')
				if (checked.status !== 'checked')
					return blocked(`conflicts-${checked.reason}`)
				if (checked.conflicts.length) return blocked('url-in-use')
				const type = registry.types.find(
					(entry) => entry.schemaType === document._type,
				)!
				if (!type.collection) {
					const prefixes = new Set([candidate.value.url.prefix])
					// Preserve both the form's current folder and the latest stored draft
					// folder. They can differ while native form edits are still syncing.
					for (const previousDocument of [
						document,
						...snapshot.inventory.documents,
					]) {
						if (
							!record(previousDocument) ||
							typeof previousDocument._id !== 'string' ||
							getPublishedId(previousDocument._id) !==
								getPublishedId(document._id)
						)
							continue
						const previous = authoring.prepareStored(
							document._type,
							fieldValue(previousDocument, type.pathField),
						)
						if (previous.ok) prefixes.add(previous.value.url.prefix)
					}
					for (const prefix of prefixes) {
						const failure = await preserve(prefix, op.signal)
						if (failure) return failure
						if (op.stopped()) return blocked('aborted')
					}
				}
				// Folder additions can outlive a cancelled page edit, which is harmless:
				// empty folders are persistent by design. Recheck after those writes so
				// a newly published/released page or newly occupied URL is not ignored.
				const latest = await evidence(op.signal)
				if (op.stopped()) return blocked('aborted')
				if ('status' in latest) return latest
				const changed = versionReason(document, latest)
				if (changed) return blocked(changed)
				const finalCheck = await checkConflicts(
					{
						schemaType: document._type,
						storedValue: candidate.value.storedValue,
						documentId: document._id,
					},
					op.signal,
				)
				if (op.stopped()) return blocked('aborted')
				if (finalCheck.status !== 'checked')
					return blocked(`conflicts-${finalCheck.reason}`)
				if (finalCheck.conflicts.length) return blocked('url-in-use')
				// This still is not a transaction or URL reservation. The input must
				// reject stale results and honor the latest native read-only state.
				return { status: 'ready', candidate: candidate.value }
			} finally {
				op.finish()
				busy = false
			}
		},
		async createFolder(
			request: UrlEditRequest & { readonly pathname: string },
			signal?: AbortSignal,
		): Promise<UrlEditCreateResult> {
			if (request.readOnly) return blocked('read-only')
			if (busy) return blocked('busy')
			busy = true
			const op = operation(signal)
			try {
				const snapshot = await evidence(op.signal)
				if (op.stopped()) return blocked('aborted')
				if ('status' in snapshot) return snapshot
				const reason = versionReason(request.document, snapshot)
				if (reason) return blocked(reason)
				if (groups.has(request.pathname)) return blocked('collection-group')
				const failure = await preserve(request.pathname, op.signal)
				if (failure) return failure
				return op.stopped() ? blocked('aborted') : { status: 'saved' }
			} finally {
				op.finish()
				busy = false
			}
		},
	})
}
