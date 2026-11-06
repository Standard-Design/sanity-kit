/**
 * Studio authorization for URL-only folder renames. The writer has already
 * checked broad read coverage; this adapter checks each exact mutation using
 * native document grants and the schema's document/field readOnly rules.
 * Full current documents are necessary for conditional rules. Publish-button
 * eligibility does not authorize these lower-level updates or receipt creates.
 */
import type { useCurrentUser, useGrantsStore, useSchema } from 'sanity'
import type {
	FolderRenameAuthorization,
	FolderRenameWriteTarget,
} from './rename-write.js'

interface AccessClient {
	withConfig(options: {
		apiVersion: string
		perspective: 'raw'
		useCdn: false
		stega: false
	}): {
		config(): { dataset?: string }
		request(options: {
			url: string
			maxRetries: 0
			fetch: { cache: 'no-store'; next: undefined }
			tag: string
			signal?: AbortSignal
		}): Promise<unknown>
	}
}
type GrantsStore = ReturnType<typeof useGrantsStore>
type CurrentUser = ReturnType<typeof useCurrentUser>
type Schema = ReturnType<typeof useSchema>
type Segment = string | { _key: string }
const record = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value)
const blocked = (
	reason: 'protected' | 'missing' | 'unverified',
	documentId?: string,
): FolderRenameAuthorization => ({
	ok: false,
	reason,
	...(documentId ? { documentId } : {}),
})

// Only the registry uses a keyed-array selector. Page fields are ordinary
// named paths; rejecting other expressions avoids interpreting mutation syntax.
function pathParts(path: string): Segment[] | undefined {
	const registry =
		/^folders\[_key=="([A-Za-z0-9_-]{1,128})"\]\.pathname$/u.exec(path)
	if (registry) return ['folders', { _key: registry[1]! }, 'pathname']
	if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/u.test(path))
		return undefined
	return path.split('.')
}

function protectedBySchema(
	type: unknown,
	document: Record<string, unknown>,
	paths: readonly Segment[][],
	currentUser: CurrentUser,
): boolean {
	function check(
		node: Record<string, unknown>,
		value: unknown,
		parent: unknown,
		path: Segment[],
	) {
		const rule = node.readOnly
		if (rule === undefined || rule === false) return false
		if (rule === true) return true
		if (typeof rule !== 'function') throw new Error('Unsupported readOnly rule')
		const result: unknown = (rule as (context: unknown) => unknown)({
			document,
			parent,
			value,
			path,
			currentUser,
		})
		// Sanity's conditional properties are synchronous. A promise or unexpected
		// result must not silently be treated as writable by this bulk workflow.
		if (result !== undefined && typeof result !== 'boolean') {
			// Consume a rejected promise from unsupported async configuration too.
			void Promise.resolve(result).catch(() => undefined)
			throw new Error('Unverified readOnly rule')
		}
		return result === true
	}
	if (!record(type)) throw new Error('Missing schema')
	if (check(type, document, undefined, [])) return true
	for (const path of paths) {
		let node = type
		let value: unknown = document
		const visited: Segment[] = []
		for (const part of path) {
			const parent = value
			if (typeof part === 'string') {
				const field: unknown = Array.isArray(node.fields)
					? node.fields.find(
							(entry: unknown) => record(entry) && entry.name === part,
						)
					: undefined
				if (!record(field) || !record(field.type))
					throw new Error('Missing field schema')
				node = field.type
				value = record(parent) ? parent[part] : undefined
			} else {
				const members: unknown[] = Array.isArray(parent)
					? parent.filter(
							(entry: unknown) => record(entry) && entry._key === part._key,
						)
					: []
				if (members.length !== 1 || !record(members[0]))
					throw new Error('Missing keyed member')
				const member = members[0]
				value = member
				const memberType: unknown = Array.isArray(node.of)
					? node.of.find(
							(entry: unknown) => record(entry) && entry.name === member._type,
						)
					: undefined
				if (!record(memberType)) throw new Error('Missing member schema')
				node = memberType
			}
			visited.push(part)
			if (check(node, value, parent, [...visited])) return true
		}
	}
	return false
}

/** Subscribe once with cancellation and a bound; never leave a dialog waiting indefinitely. */
function permission(
	store: GrantsStore,
	target: FolderRenameWriteTarget,
	document: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<boolean | undefined> {
	return new Promise((resolve) => {
		let done = false
		let subscription: { unsubscribe(): void } | undefined
		const finish = (result: boolean | undefined) => {
			if (done) return
			done = true
			clearTimeout(timer)
			signal?.removeEventListener('abort', abort)
			subscription?.unsubscribe()
			resolve(result)
		}
		const abort = () => finish(undefined)
		const timer = setTimeout(abort, 10_000)
		signal?.addEventListener('abort', abort, { once: true })
		if (signal?.aborted) return finish(undefined)
		try {
			subscription = store
				.checkDocumentPermission(target.operation, document)
				.subscribe({
					next: (result) =>
						finish(
							typeof result?.granted === 'boolean' ? result.granted : undefined,
						),
					error: abort,
					complete: abort,
				})
			// Native stores may synchronously emit their cached current value.
			if (done) subscription.unsubscribe()
		} catch {
			finish(undefined)
		}
	})
}

export function createFolderRenameAuthorizer(options: {
	readonly client: AccessClient
	readonly schema: Schema
	readonly currentUser: CurrentUser
	readonly grantsStore: GrantsStore
}) {
	const source = options.client.withConfig({
		apiVersion: '2026-10-01',
		perspective: 'raw',
		useCdn: false,
		stega: false,
	})
	const dataset = source.config().dataset
	return async ({
		targets,
		signal,
	}: {
		readonly targets: readonly FolderRenameWriteTarget[]
		readonly signal?: AbortSignal
	}): Promise<FolderRenameAuthorization> => {
		if (
			!dataset ||
			!/^[a-z0-9_][a-z0-9_-]*$/u.test(dataset) ||
			!options.currentUser ||
			signal?.aborted
		)
			return blocked('unverified')
		const documents = new Map<string, Record<string, unknown>>()
		try {
			const updates = targets.filter((target) => target.operation === 'update')
			// The Doc API supplies complete documents without the query index's delay.
			// Small batches avoid long request URLs and bounded work remains cancellable.
			for (let offset = 0; offset < updates.length; offset += 30) {
				const batch = updates.slice(offset, offset + 30)
				const result = await source.request({
					url: `/data/doc/${dataset}/${batch.map((target) => encodeURIComponent(target.id)).join(',')}`,
					maxRetries: 0,
					fetch: { cache: 'no-store', next: undefined },
					tag: 'sanity-kit.folder-rename-access',
					...(signal ? { signal } : {}),
				})
				if (
					signal?.aborted ||
					!record(result) ||
					!Array.isArray(result.documents)
				)
					return blocked('unverified')
				for (const row of result.documents) {
					if (
						!record(row) ||
						typeof row._id !== 'string' ||
						documents.has(row._id) ||
						!batch.some((target) => target.id === row._id)
					)
						return blocked('unverified')
					documents.set(row._id, row)
				}
			}
			for (const target of targets) {
				if (signal?.aborted) return blocked('unverified', target.id)
				const document =
					target.operation === 'create'
						? target.attributes
						: documents.get(target.id)
				if (
					!document ||
					document._id !== target.id ||
					document._type !== target.schemaType ||
					(target.operation === 'update' &&
						(!target.revision || document._rev !== target.revision))
				)
					return blocked('unverified', target.id)
				const parts = target.fields.map(pathParts)
				if (parts.some((path) => !path)) return blocked('unverified', target.id)
				const schema = options.schema.get(target.schemaType)
				if (!schema) {
					// These two records are private kit metadata, intentionally absent
					// from Studio content schemas. Only their known operations qualify.
					const registry =
						target.schemaType === 'sanityKitFolderRegistry' &&
						target.id === 'sanityKit.folders' &&
						target.operation === 'update' &&
						target.fields.length > 0 &&
						target.fields.every((field) =>
							/^folders\[_key=="[A-Za-z0-9_-]{1,128}"\]\.pathname$/u.test(
								field,
							),
						)
					const receipt =
						target.schemaType === 'sanityKitFolderRename' &&
						target.operation === 'create' &&
						target.id ===
							`sanityKit.folderRename.${String(document.operationId)}` &&
						/^[a-f0-9-]{36}$/u.test(String(document.operationId)) &&
						target.fields.every((field) =>
							[
								'_id',
								'_type',
								'operationId',
								'oldPathname',
								'newPathname',
								'createRedirects',
								'evidence',
							].includes(field),
						)
					if (!registry && !receipt) return blocked('unverified', target.id)
				} else {
					// Metadata initialized during creation is not an editor field change.
					// Generated redirects keep immutable origin; document and editable
					// route fields still obey all registered readOnly rules.
					const paths = parts
						.filter((path): path is Segment[] => !!path)
						.filter(
							(path) =>
								!(
									target.operation === 'create' &&
									((path.length === 1 &&
										(path[0] === '_id' || path[0] === '_type')) ||
										(target.schemaType === 'sanityKitRedirect' &&
											path.length === 1 &&
											path[0] === 'origin'))
								),
						)
					if (protectedBySchema(schema, document, paths, options.currentUser))
						return blocked('protected', target.id)
				}
				const granted = await permission(
					options.grantsStore,
					target,
					document,
					signal,
				)
				if (signal?.aborted || granted === undefined)
					return blocked('unverified', target.id)
				if (!granted) return blocked('missing', target.id)
			}
			return { ok: true }
		} catch {
			return blocked('unverified')
		}
	}
}
