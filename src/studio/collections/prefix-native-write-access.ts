/**
 * Connect the private prefix writer to Studio's native validation and grants.
 * A routing review proves what should change, not whether the current editor
 * may publish those documents. This adapter supplies that separate decision.
 * @see docs/collection-prefix-write-access.md
 */
import {
	validateDocument,
	type useCurrentUser,
	type useGrantsStore,
} from 'sanity'
import { pagePathname } from '../../url/registry.js'
import { checkCollectionPrefixReceiptReadAccess } from './prefix-native-access.js'
import type {
	CollectionPrefixWriteAccessAnswer,
	CollectionPrefixWriteAccessRequest,
	CollectionPrefixWriteTarget,
} from './prefix-write.js'
import { prefixChangesAreProtected } from './prefix-write-schema.js'

type Row = Record<string, unknown>
type Status = CollectionPrefixWriteAccessAnswer['targets'][number]['status']
type GrantsStore = ReturnType<typeof useGrantsStore>
type Workspace = Parameters<typeof validateDocument>[0]['workspace']
/** Structural boundary accepts the app client and Studio's bundled client. */
export interface CollectionPrefixWriteAccessClient {
	withConfig(options: {
		apiVersion: string
		perspective: 'raw'
		useCdn: false
		stega: false
		maxRetries: 0
	}): {
		config(): { projectId?: string; dataset?: string }
		request(options: {
			url: string
			method?: 'GET'
			maxRetries?: 0
			fetch: { cache: 'no-store'; next: undefined }
			tag: string
			signal?: AbortSignal
		}): Promise<unknown>
	}
}
type Permission = Parameters<GrantsStore['checkDocumentPermission']>[0]
const record = (value: unknown): value is Row =>
	!!value && typeof value === 'object' && !Array.isArray(value)
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u
const metadata = new Set(['_rev', '_createdAt', '_updatedAt'])
const byteLength = (value: unknown) =>
	new TextEncoder().encode(JSON.stringify(value)).byteLength
const publishedId = (value: unknown): value is string =>
	typeof value === 'string' &&
	/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/u.test(value) &&
	!value.startsWith('drafts.') &&
	!value.startsWith('versions.')

/** Use the same create/update permission checks as Studio's Publish operation. */
function permission(
	store: GrantsStore,
	operation: Permission,
	document: Row,
	signal: AbortSignal,
): Promise<Status> {
	return new Promise((resolve) => {
		let done = false
		let subscription: { unsubscribe(): void } | undefined
		const finish = (answer: Status) => {
			if (done) return
			done = true
			signal.removeEventListener('abort', abort)
			subscription?.unsubscribe()
			resolve(answer)
		}
		const abort = () => finish('unverified')
		signal.addEventListener('abort', abort, { once: true })
		if (signal.aborted) return abort()
		try {
			subscription = store
				.checkDocumentPermission(operation, document)
				.subscribe({
					next: (value) =>
						finish(
							value?.granted === true
								? 'granted'
								: value?.granted === false
									? 'missing'
									: 'unverified',
						),
					error: abort,
					complete: abort,
				})
			if (done) subscription.unsubscribe()
		} catch {
			abort()
		}
	})
}

function cleanClone(document: Row, id: string): Row {
	return {
		...Object.fromEntries(
			Object.entries(document).filter(([key]) => !metadata.has(key)),
		),
		_id: id,
	}
}

/** Internal confirmation records are not editor documents and have no form schema. */
function isReceipt(document: Row, id: string, requestedId: string): boolean {
	const fields = [
		'_id',
		'_type',
		'operationId',
		'oldPrefix',
		'newPrefix',
		'createRedirects',
		'evidence',
	]
	return (
		id === requestedId &&
		document._id === `drafts.${id}` &&
		document._type === 'sanityKitCollectionPrefixPublication' &&
		typeof document.operationId === 'string' &&
		uuid.test(document.operationId) &&
		id === `sanityKit.collectionPrefixPublication.${document.operationId}` &&
		typeof document.oldPrefix === 'string' &&
		pagePathname(document.oldPrefix) === document.oldPrefix &&
		typeof document.newPrefix === 'string' &&
		pagePathname(document.newPrefix) === document.newPrefix &&
		document.oldPrefix !== document.newPrefix &&
		typeof document.createRedirects === 'boolean' &&
		typeof document.evidence === 'string' &&
		Object.keys(document).length === fields.length &&
		fields.every((key) => Object.hasOwn(document, key))
	)
}

export function createNativeCollectionPrefixWriteAccess(options: {
	readonly client: CollectionPrefixWriteAccessClient
	readonly workspace: Workspace
	readonly currentUser: ReturnType<typeof useCurrentUser>
	readonly grantsStore: GrantsStore
}) {
	const source = options.client.withConfig({
		apiVersion: '2026-10-01',
		perspective: 'raw',
		useCdn: false,
		stega: false,
		maxRetries: 0,
	})
	const { projectId, dataset } = source.config()
	if (
		!projectId ||
		!/^[a-z0-9]+$/u.test(projectId) ||
		!dataset ||
		!/^[a-z0-9_][a-z0-9_-]{0,63}$/u.test(dataset)
	)
		throw new Error(
			'Collection prefix write access needs a concrete project and dataset.',
		)

	return async (
		request: CollectionPrefixWriteAccessRequest,
	): Promise<CollectionPrefixWriteAccessAnswer> => {
		const initial: CollectionPrefixWriteAccessAnswer = {
			targets: request.targets.map(({ key }) => ({
				key,
				status: 'unverified',
			})),
			receiptRead: 'unverified',
		}
		if (
			!options.currentUser ||
			request.projectId !== projectId ||
			request.dataset !== dataset ||
			request.signal?.aborted ||
			source.config().projectId !== projectId ||
			source.config().dataset !== dataset ||
			!request.targets.length ||
			new Set(request.targets.map(({ key }) => key)).size !==
				request.targets.length
		)
			return initial
		// A hung custom validator or grant stream must not leave review spinning.
		const controller = new AbortController()
		const signal = request.signal
			? AbortSignal.any([request.signal, controller.signal])
			: controller.signal
		const timer = setTimeout(() => controller.abort(), 10_000)
		const aborted = new Promise<CollectionPrefixWriteAccessAnswer>((resolve) =>
			signal.addEventListener('abort', () => resolve(initial), { once: true }),
		)

		async function validate(draft: Row): Promise<Status> {
			if (
				typeof draft._type !== 'string' ||
				!options.workspace.schema.get(draft._type)
			)
				return 'unverified'
			const markers: unknown = await validateDocument({
				document: draft as Parameters<typeof validateDocument>[0]['document'],
				workspace: options.workspace,
				getClient: ({ apiVersion }) => {
					const client = options.workspace
						.getClient({ apiVersion })
						.withConfig({
							perspective: 'raw',
							useCdn: false,
							stega: false,
							maxRetries: 0,
						})
					const scope = client.config()
					if (scope.projectId !== projectId || scope.dataset !== dataset)
						throw new Error(
							'Validation client does not match the reviewed dataset.',
						)
					return client
				},
				currentUser: options.currentUser,
				customValidation: true,
				environment: 'studio',
				signal,
			})
			if (
				signal.aborted ||
				!Array.isArray(markers) ||
				markers.some(
					(marker: unknown) =>
						!record(marker) ||
						!['error', 'warning', 'info'].includes(String(marker.level)) ||
						marker.code === 'validation.exception',
				)
			)
				return 'unverified'
			return markers.some((marker: Row) => marker.level === 'error')
				? 'protected'
				: 'granted'
		}
		async function targetStatus(
			target: CollectionPrefixWriteTarget,
		): Promise<Status> {
			let before: Row | undefined
			let draft: Row
			let id: string
			let initialDraft: Row | undefined
			if (target.kind === 'publish-settings') {
				before = target.published
				draft = target.draft
				if (
					!publishedId(before._id) ||
					before._type !== 'sanityKitCollectionRoute' ||
					draft._type !== before._type ||
					draft._id !== `drafts.${before._id}` ||
					typeof before._rev !== 'string' ||
					!before._rev ||
					typeof draft._rev !== 'string' ||
					!draft._rev
				)
					return 'unverified'
				id = before._id
			} else if (target.kind === 'retarget-redirect') {
				id = target.publishedId
				if (
					!publishedId(id) ||
					target.draftId !== `drafts.${id}` ||
					!target.publishedRevision ||
					pagePathname(target.destination) !== target.destination
				)
					return 'unverified'
				const result: unknown = await source.request({
					url: `/data/doc/${dataset}/${encodeURIComponent(id)},${encodeURIComponent(target.draftId)}`,
					maxRetries: 0,
					fetch: { cache: 'no-store', next: undefined },
					tag: 'sanity-kit.collection-prefix-write-access',
					signal,
				})
				if (
					!record(result) ||
					!Array.isArray(result.documents) ||
					result.documents.length !== 1 ||
					!record(result.documents[0])
				)
					return 'unverified'
				before = result.documents[0]
				if (
					before._id !== id ||
					before._rev !== target.publishedRevision ||
					before._type !== 'sanityKitRedirect' ||
					byteLength(before) > 1_048_576
				)
					return 'unverified'
				initialDraft = cleanClone(before, target.draftId)
				draft = { ...initialDraft, destination: target.destination }
			} else if (target.kind === 'create-and-publish') {
				id = target.publishedId
				draft = target.draft
				if (!publishedId(id) || draft._id !== `drafts.${id}`)
					return 'unverified'
				initialDraft = draft
				if (
					draft._type !== 'sanityKitRedirect' &&
					!isReceipt(draft, id, request.receiptReadId)
				)
					return 'unverified'
				if (
					draft._type === 'sanityKitRedirect' &&
					draft.origin !== 'url-change'
				)
					return 'unverified'
			} else return 'unverified'
			if (signal.aborted || byteLength(draft) > 1_048_576) return 'unverified'
			const internalReceipt = isReceipt(draft, id, request.receiptReadId)
			if (!internalReceipt) {
				if (
					prefixChangesAreProtected({
						schema: options.workspace.schema,
						currentUser: options.currentUser,
						...(before ? { before } : {}),
						after: draft,
						initializeRedirectOrigin:
							!before && draft._type === 'sanityKitRedirect',
					})
				)
					return 'protected'
				const result = await validate(draft)
				if (result !== 'granted') return result
			}
			// These correspond to Studio's publish permissions, plus the draft
			// creation/edit performed by our generated redirect action sequence.
			const checks: [Permission, Row][] = []
			if (initialDraft) checks.push(['create', initialDraft])
			if (before) checks.push(['update', before])
			if (initialDraft && target.kind === 'retarget-redirect')
				checks.push(['update', initialDraft])
			checks.push(['update', draft], ['create', { ...draft, _id: id }])
			for (const [operation, document] of checks) {
				const result = await permission(
					options.grantsStore,
					operation,
					document,
					signal,
				)
				if (result !== 'granted' || signal.aborted)
					return signal.aborted ? 'unverified' : result
			}
			return 'granted'
		}
		async function run(): Promise<CollectionPrefixWriteAccessAnswer> {
			try {
				const receipt = await checkCollectionPrefixReceiptReadAccess(
					options.client,
					request.receiptReadId,
					signal,
				)
				const receiptRead = receipt.ok
					? 'granted'
					: receipt.issues.some(({ status }) => status === 'missing')
						? 'missing'
						: 'unverified'
				if (receiptRead !== 'granted') return { ...initial, receiptRead }
				const answers: { key: string; status: Status }[] = []
				for (const target of request.targets) {
					let status: Status = 'unverified'
					try {
						if (!signal.aborted) status = await targetStatus(target)
					} catch {
						/* Missing evidence never grants a write. */
					}
					answers.push({ key: target.key, status })
				}
				return signal.aborted ? initial : { targets: answers, receiptRead }
			} catch {
				return initial
			}
		}
		try {
			return await Promise.race([run(), aborted])
		} finally {
			clearTimeout(timer)
			controller.abort()
		}
	}
}
