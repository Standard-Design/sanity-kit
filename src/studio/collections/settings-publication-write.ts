/**
 * Publish a complete collection settings draft when no existing live URLs move.
 * First editable settings use the activation reader; metadata-only changes and
 * code-locked prefixes do not need a collection-wide URL inventory. Native
 * schema/grant authorization remains mandatory for every branch.
 *
 * Initial publication uses strict-create Mutations because Actions has no
 * documented compare-absence guard. Existing settings use guarded native
 * Actions Publish. Both record a receipt atomically and share the dataset's
 * pending slot with prefix moves. Neither transport writes collection items.
 * This private service does not install a Studio action.
 */
import { createCollectionPublicationAttempts } from './prefix-attempts.js'
import type { Action, Mutation } from '@sanity/client'
import { initialPublishedCopy } from './prefix-initial-publish.js'
import type { CollectionRoutingConfig } from '../../url/settings/resolve.js'
import {
	createCollectionSettingsPublicationClassifier,
	type CollectionSettingsPublicationClassification,
} from './settings-publication-plan.js'
import {
	createCollectionSettingsActivationReviewer,
	type CollectionSettingsActivationReview,
} from './settings-activation-review.js'
import {
	verifyCollectionPrefixReadAccess,
	type CollectionPrefixAccessDecision,
	type CollectionPrefixReadRequirement,
} from './prefix-access.js'
import type {
	CollectionPrefixReadAccessRequest,
	CollectionPrefixReviewClient,
} from './prefix-review.js'
import {
	COLLECTION_PREFIX_MAX_REQUEST_BYTES,
	COLLECTION_PREFIX_MAX_SETTINGS_BYTES,
	type CollectionPrefixWriteAccessRequest,
	type CollectionPrefixWriteAccessAnswer,
	type CollectionPrefixWriteTarget,
} from './prefix-write.js'
import {
	readPendingCollectionPrefix,
	rememberPendingCollectionPrefix,
	settlePendingCollectionPrefix,
	type CollectionPublicationReceipt,
	type CollectionSettingsPublicationReceipt,
	type CollectionPrefixRecoveryStorage,
	type CollectionPrefixSettlement,
	type PendingCollectionPrefix,
} from './prefix-pending.js'

type Row = Readonly<Record<string, unknown>>
type Classification = Exclude<
	CollectionSettingsPublicationClassification,
	{ kind: 'prefix-change' }
>
export interface CollectionSettingsPublicationChoice {
	readonly collection: string
	readonly draftRevision: string
}
export interface CollectionSettingsPublicationReview {
	readonly projectId: string
	readonly dataset: string
	readonly operationId: string
	readonly classification: Classification
	readonly settings: { readonly published: Row | null; readonly draft: Row }
	readonly activation?: CollectionSettingsActivationReview
}
interface Blocked {
	readonly status: 'blocked'
	readonly reason: string
	readonly targetKey?: string
}
export type CollectionSettingsPublishResult =
	| Blocked
	| CollectionPrefixSettlement
	| { readonly status: 'unknown'; readonly operationId: string }
export interface CollectionSettingsPublicationRequest {
	readonly url: string
	readonly method?: 'POST'
	readonly body?:
		| { readonly actions: readonly Action[]; readonly transactionId: string }
		| {
				readonly mutations: readonly Mutation[]
				readonly transactionId: string
		  }
	readonly maxRetries: 0
	readonly fetch: { readonly cache: 'no-store'; readonly next: undefined }
	readonly tag: string
	readonly signal?: AbortSignal
}
export interface CollectionSettingsPublicationClient {
	withConfig(
		options: Parameters<CollectionPrefixReviewClient['withConfig']>[0],
	): ReturnType<CollectionPrefixReviewClient['withConfig']> & {
		request(options: CollectionSettingsPublicationRequest): Promise<unknown>
	}
}
interface Prepared {
	readonly choice: CollectionSettingsPublicationChoice
	readonly review: CollectionSettingsPublicationReview
	readonly targets: readonly CollectionPrefixWriteTarget[]
	readonly receipt: CollectionSettingsPublicationReceipt
	readonly body: NonNullable<CollectionSettingsPublicationRequest['body']>
	readonly fingerprint: string
}
const record = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === 'object' && !Array.isArray(value)
const blocked = (reason: string): Blocked => ({ status: 'blocked', reason })
const bytes = (value: unknown) =>
	new TextEncoder().encode(JSON.stringify(value)).byteLength
function freeze<T>(value: T): T {
	if (value && typeof value === 'object') {
		for (const child of Object.values(value)) freeze(child)
		Object.freeze(value)
	}
	return value
}

export function createCollectionSettingsPublicationController(
	options: {
		readonly configuration: CollectionRoutingConfig
		readonly confirmReadAccess: (
			request: CollectionPrefixReadAccessRequest,
			signal?: AbortSignal,
		) => Promise<readonly CollectionPrefixAccessDecision[]>
		readonly authorize: (
			request: CollectionPrefixWriteAccessRequest,
		) => Promise<CollectionPrefixWriteAccessAnswer>
		readonly recoveryStorage?: CollectionPrefixRecoveryStorage
	},
	client: CollectionSettingsPublicationClient,
) {
	if (typeof options.authorize !== 'function')
		throw new Error(
			'Collection settings publishing requires native schema/write authorization.',
		)
	const configuration = structuredClone(options.configuration)
	const classifier =
		createCollectionSettingsPublicationClassifier(configuration)
	const activation = createCollectionSettingsActivationReviewer(
		configuration,
		client,
		options,
	)
	const source = client.withConfig({
		apiVersion: '2026-10-01',
		perspective: 'raw',
		useCdn: false,
		stega: false,
		maxRetries: 0,
	})
	const { projectId, dataset } = source.config()
	const scope = { projectId: projectId!, dataset: dataset! } // Activation reader validates concrete scope.
	const transport = {
		maxRetries: 0,
		fetch: { cache: 'no-store', next: undefined },
		tag: 'sanity-kit.collection-settings-write',
	} as const
	const storage = options.recoveryStorage
	const proofs = new WeakMap<CollectionSettingsPublicationReview, Prepared>()
	let busy = false
	const attempts = createCollectionPublicationAttempts()
	function getPending(): CollectionPublicationReceipt | null {
		const value = readPendingCollectionPrefix(scope, storage)
		if (value) attempts.remember(value)
		else attempts.compact()
		return value?.receipt ?? null
	}
	function pendingBlock(): Blocked | undefined {
		try {
			if (getPending()) return blocked('outcome-unknown')
		} catch {
			return blocked('recovery-invalid')
		}
	}
	/**
	 * The Doc API supplies the whole draft, including consumer-added fields.
	 * Access to both exact identities must be proven before absence means anything.
	 * Repeating the access check after the read avoids accepting withdrawn grants.
	 */
	async function readSettings(
		choice: CollectionSettingsPublicationChoice,
		signal?: AbortSignal,
	) {
		if (signal?.aborted) return blocked('aborted')
		const collection = configuration.collections?.find(
			(row) => row.name === choice.collection,
		)
		if (!collection?.settingsDocumentId)
			return blocked('settings-not-configured')
		const id = collection.settingsDocumentId
		const ids = [id, `drafts.${id}`]
		const requirements: readonly CollectionPrefixReadRequirement[] = [
			{
				key: 'settings:exact',
				kind: 'exact-identities',
				ids,
				regardlessOfType: true,
				label: 'Read this collection settings document and its draft',
			},
		]
		async function access() {
			const answer = await options.confirmReadAccess(
				{ ...scope, requirements },
				signal,
			)
			return signal?.aborted
				? blocked('aborted')
				: verifyCollectionPrefixReadAccess(requirements, answer).ok
					? undefined
					: blocked('read-access-unverified')
		}
		const denied = await access()
		if (denied) return denied
		const response = await source.request({
			...transport,
			url: `/data/doc/${dataset}/${ids.map(encodeURIComponent).join(',')}`,
			...(signal ? { signal } : {}),
		})
		if (signal?.aborted) return blocked('aborted')
		if (
			!record(response) ||
			!Array.isArray(response.documents) ||
			response.documents.length > 2 ||
			!response.documents.every(
				(row) => record(row) && ids.includes(String(row._id)),
			) ||
			new Set(response.documents.map((row) => (row as Row)._id)).size !==
				response.documents.length
		)
			return blocked('settings-unavailable')
		if (bytes(response.documents) > COLLECTION_PREFIX_MAX_SETTINGS_BYTES)
			return blocked('settings-size-limit')
		const settings = {
			published:
				(response.documents.find((row) => (row as Row)._id === id) as
					Row | undefined) ?? null,
			draft:
				(response.documents.find(
					(row) => (row as Row)._id === `drafts.${id}`,
				) as Row | undefined) ?? null,
		}
		const after = await access()
		if (after) return after
		const result = classifier.classify({
			collection: choice.collection,
			...settings,
		})
		if (!result.ok) return blocked(result.reason)
		if (result.value.draftRevision !== choice.draftRevision)
			return blocked('review-stale')
		if (result.value.kind === 'prefix-change')
			return blocked('prefix-review-required')
		return freeze({
			classification: result.value,
			settings: {
				published: structuredClone(settings.published),
				draft: structuredClone(settings.draft!),
			},
		})
	}
	/** Bind the full draft, routing evidence, request, and receipt to one attempt. */
	function prepare(
		choice: CollectionSettingsPublicationChoice,
		evidence: Exclude<Awaited<ReturnType<typeof readSettings>>, Blocked>,
		activated?: CollectionSettingsActivationReview,
	): Prepared {
		const operationId = crypto.randomUUID()
		const { classification, settings } = evidence
		const receipt: CollectionSettingsPublicationReceipt = {
			_id: `sanityKit.collectionSettingsPublication.${operationId}`,
			_type: 'sanityKitCollectionSettingsPublication',
			operationId,
			documentId: classification.documentId,
			collection: classification.collection,
			draftRevision: classification.draftRevision,
			publishedRevision: classification.publishedRevision,
			prefix: classification.prefix,
			activatesUrls:
				classification.kind === 'first-publication' &&
				classification.activatesUrls,
			evidence: JSON.stringify({
				classification,
				...(activated ? { activation: activated.plan } : {}),
			}),
		}
		const review = freeze({
			...scope,
			operationId,
			classification,
			settings,
			...(activated ? { activation: activated } : {}),
		})
		const targets: CollectionPrefixWriteTarget[] = []
		let body: Prepared['body']
		if (classification.kind === 'first-publication') {
			const published = initialPublishedCopy(
				settings.draft,
				classification.documentId,
			)
			targets.push(
				{
					key: `settings:${classification.documentId}`,
					kind: 'publish-initial-settings',
					publishedId: classification.documentId,
					draft: settings.draft,
					configuration,
				},
				{
					key: `receipt:${receipt._id}`,
					kind: 'create-settings-receipt',
					published: { ...receipt },
				},
			)
			const mutations: Mutation[] = [
				{
					patch: {
						id: `drafts.${classification.documentId}`,
						ifRevisionID: classification.draftRevision,
						set: { _type: 'sanityKitCollectionRoute' },
					},
				},
				{ create: published as { _id: string; _type: string } },
				{ delete: { id: `drafts.${classification.documentId}` } },
				{ create: receipt },
			]
			body = { mutations, transactionId: operationId }
		} else {
			const receiptDraft = { ...receipt, _id: `drafts.${receipt._id}` }
			targets.push(
				{
					key: `settings:${classification.documentId}`,
					kind: 'publish-settings',
					published: settings.published!,
					draft: settings.draft,
				},
				{
					key: `receipt:${receipt._id}`,
					kind: 'create-and-publish',
					publishedId: receipt._id,
					draft: receiptDraft,
				},
			)
			body = {
				transactionId: operationId,
				actions: [
					{
						actionType: 'sanity.action.document.publish',
						publishedId: classification.documentId,
						draftId: `drafts.${classification.documentId}`,
						ifPublishedRevisionId: classification.publishedRevision,
						ifDraftRevisionId: classification.draftRevision,
					},
					{
						actionType: 'sanity.action.document.create',
						publishedId: receipt._id,
						attributes: receiptDraft,
						ifExists: 'fail',
					},
					{
						actionType: 'sanity.action.document.publish',
						publishedId: receipt._id,
						draftId: receiptDraft._id,
					},
				],
			}
		}
		return freeze({
			choice,
			review,
			targets,
			receipt,
			body,
			fingerprint: JSON.stringify(evidence),
		})
	}
	async function authorize(
		prepared: Prepared,
		signal?: AbortSignal,
	): Promise<Blocked | undefined> {
		const answer: unknown = await options.authorize({
			...scope,
			targets: prepared.targets,
			receiptReadId: prepared.receipt._id,
			...(signal ? { signal } : {}),
		})
		if (signal?.aborted) return blocked('aborted')
		if (!record(answer) || answer.receiptRead !== 'granted')
			return blocked('receipt-read-unverified')
		if (
			!Array.isArray(answer.targets) ||
			answer.targets.length !== prepared.targets.length
		)
			return blocked('write-access-unverified')
		for (const target of prepared.targets) {
			const entries = answer.targets.filter(
				(row) => record(row) && row.key === target.key,
			)
			if (entries.length !== 1 || !record(entries[0]))
				return blocked('write-access-unverified')
			if (entries[0].status !== 'granted')
				return {
					...blocked(
						['missing', 'protected'].includes(String(entries[0].status))
							? `write-access-${String(entries[0].status)}`
							: 'write-access-unverified',
					),
					targetKey: target.key,
				}
		}
	}
	/**
	 * Prepare an instance-owned review. This can run behind the normal Publish
	 * button without a routine dialog; it does not grant permission to dispatch.
	 */
	async function review(
		input: CollectionSettingsPublicationChoice,
		signal?: AbortSignal,
	): Promise<
		| Blocked
		| {
				readonly status: 'ready'
				readonly review: CollectionSettingsPublicationReview
		  }
	> {
		if (busy) return blocked('busy')
		const waiting = pendingBlock()
		if (waiting) return waiting
		const choice = { ...input }
		try {
			const evidence = await readSettings(choice, signal)
			if ('status' in evidence) return evidence
			let activated: CollectionSettingsActivationReview | undefined
			if (
				evidence.classification.kind === 'first-publication' &&
				evidence.classification.activatesUrls
			) {
				const found = await activation.review(choice, signal)
				if (found.status === 'blocked') return found
				activated = found.review
			}
			const prepared = prepare(choice, evidence, activated)
			if (bytes(prepared.body) > COLLECTION_PREFIX_MAX_REQUEST_BYTES)
				return blocked('request-size-limit')
			const denied = await authorize(prepared, signal)
			if (denied) return denied
			const pending = pendingBlock()
			if (pending) return pending
			proofs.set(prepared.review, prepared)
			return { status: 'ready', review: prepared.review }
		} catch {
			return blocked(signal?.aborted ? 'aborted' : 'request-failed')
		}
	}
	/**
	 * A timeout belongs to one attempt even if another view has since started a
	 * newer one. The optional ID keeps that older attempt's settlement separate.
	 * A missing receipt means unknown, never permission to submit the write again.
	 */
	async function reconcile(
		operationId?: string,
	): Promise<CollectionSettingsPublishResult> {
		let pending: PendingCollectionPrefix | undefined
		try {
			const current = readPendingCollectionPrefix(scope, storage)
			if (
				current &&
				(!operationId || current.receipt.operationId === operationId)
			)
				attempts.remember(current)
			const attempt = attempts.get(operationId)
			if (attempt && !('receipt' in attempt))
				return attempt.receiptType === 'sanityKitCollectionSettingsPublication'
					? attempt.result
					: blocked('other-publication-pending')
			pending = attempt
		} catch {
			return blocked('recovery-invalid')
		}
		if (!pending) return blocked('no-pending-publish')
		if (pending.receipt._type !== 'sanityKitCollectionSettingsPublication')
			return blocked('other-publication-pending')
		attempts.remember(pending)
		if (pending.result) return pending.result
		try {
			const response = await source.request({
				...transport,
				url: `/data/doc/${dataset}/${pending.receipt._id}`,
			})
			const row: unknown =
				record(response) &&
				Array.isArray(response.documents) &&
				response.documents.length === 1
					? response.documents[0]
					: undefined
			if (
				record(row) &&
				Object.entries(pending.receipt).every(
					([key, value]) => row[key] === value,
				)
			) {
				const result = {
					status: 'published',
					operationId: pending.receipt.operationId,
				} as const
				settlePendingCollectionPrefix(scope, pending, result, storage)
				attempts.compact()
				return result
			}
		} catch {
			/* Missing evidence never authorizes resubmission. */
		}
		attempts.compact()
		return (
			pending.result ?? {
				status: 'unknown',
				operationId: pending.receipt.operationId,
			}
		)
	}
	/** Recheck, persist recovery evidence, and submit at most once per review. */
	async function publish(
		reviewed: CollectionSettingsPublicationReview,
		choice: {
			readonly isCurrent: () => boolean
			readonly signal?: AbortSignal
		},
	): Promise<CollectionSettingsPublishResult> {
		if (busy) return blocked('busy')
		const waiting = pendingBlock()
		if (waiting) return waiting
		const prepared = proofs.get(reviewed)
		if (!prepared) return blocked('invalid-review')
		busy = true
		try {
			try {
				const current = await readSettings(prepared.choice, choice.signal)
				if ('status' in current) return current
				if (JSON.stringify(current) !== prepared.fingerprint)
					return blocked('review-stale')
				if (prepared.review.activation) {
					const checked = await activation.recheck(
						prepared.review.activation,
						choice.signal,
					)
					if (checked.status === 'blocked') return checked
				}
				const denied = await authorize(prepared, choice.signal)
				if (denied) return denied
				if (!choice.isCurrent()) return blocked('review-stale')
				if (choice.signal?.aborted) return blocked('aborted')
			} catch {
				return blocked(choice.signal?.aborted ? 'aborted' : 'request-failed')
			}
			const pending = pendingBlock()
			if (pending) return pending
			const operation = { receipt: prepared.receipt }
			try {
				rememberPendingCollectionPrefix(scope, operation, storage)
			} catch {
				return blocked('recovery-unavailable')
			}
			attempts.remember(operation)
			proofs.delete(reviewed)
			try {
				const response = await source.request({
					...transport,
					url: `/data/${'mutations' in prepared.body ? 'mutate' : 'actions'}/${dataset}${'mutations' in prepared.body ? '?visibility=sync' : ''}`,
					method: 'POST',
					body: prepared.body,
					...(choice.signal ? { signal: choice.signal } : {}),
				})
				if (
					record(response) &&
					response.transactionId === prepared.receipt.operationId
				) {
					const result = {
						status: 'published',
						operationId: prepared.receipt.operationId,
					} as const
					settlePendingCollectionPrefix(scope, operation, result, storage)
					attempts.compact()
					return result
				}
			} catch (error) {
				const status = record(error) ? error.statusCode : undefined
				if (
					typeof status === 'number' &&
					[400, 401, 403, 404, 409, 413, 422, 429].includes(status)
				) {
					const result: CollectionPrefixSettlement = {
						status: 'rejected',
						operationId: prepared.receipt.operationId,
						reason:
							status === 409
								? 'conflict'
								: status === 401 || status === 403
									? 'permission-denied'
									: 'request-rejected',
					}
					settlePendingCollectionPrefix(scope, operation, result, storage)
					attempts.compact()
					return result
				}
			}
			// Once dispatched, failure to read recovery evidence cannot prove rejection.
			const recovered = await reconcile(prepared.receipt.operationId)
			return recovered.status === 'blocked'
				? { status: 'unknown', operationId: prepared.receipt.operationId }
				: recovered
		} finally {
			busy = false
		}
	}
	return Object.freeze({ review, publish, getPending, reconcile })
}
