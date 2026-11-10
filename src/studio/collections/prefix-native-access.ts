/**
 * Ask Sanity for the caller's effective dataset grants before a prefix review.
 * This uses the same ACL endpoint as Studio and the shared URL grant interpreter;
 * it never treats a successful content query or a role name as access proof.
 * @see docs/collection-prefix-access.md
 */
import {
	checkDocumentTypeReadAccess,
	checkRoutingSettingsReadAccess,
	checkRoutingSettingsReleaseReadAccess,
	type UrlAccessIssue,
} from '../url/access.js'
import type { CollectionPrefixAccessDecision } from './prefix-access.js'
import type { CollectionPrefixReadAccessRequest } from './prefix-review.js'

export interface CollectionPrefixAclClient {
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
			method: 'GET'
			tag: string
			fetch: { cache: 'no-store'; next: undefined }
			signal?: AbortSignal
		}): Promise<unknown>
	}
}

function decision(
	key: string,
	result: { readonly ok: boolean; readonly issues: readonly UrlAccessIssue[] },
): CollectionPrefixAccessDecision {
	return {
		key,
		status: result.ok
			? 'granted'
			: result.issues.some((issue) => issue.status === 'missing')
				? 'missing'
				: 'unverified',
	}
}

function accessSource(client: CollectionPrefixAclClient) {
	const source = client.withConfig({
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
			'Collection prefix access needs a concrete project and dataset.',
		)
	return { source, projectId, dataset }
}

/**
 * Return the reviewer's confirmReadAccess callback. Every invocation fetches
 * grants again, so the review and recheck cannot reuse earlier permission proof.
 * Failed requests propagate to the reviewer as request-failed/aborted; malformed
 * responses and unsupported filters yield explicit unverified requirements.
 */
export function createNativeCollectionPrefixReadAccess(
	client: CollectionPrefixAclClient,
) {
	const { source, projectId, dataset } = accessSource(client)
	return async (
		request: CollectionPrefixReadAccessRequest,
		signal?: AbortSignal,
	): Promise<readonly CollectionPrefixAccessDecision[]> => {
		signal?.throwIfAborted()
		// The callback cannot transfer proof to another project/dataset. Check the
		// actual clone too, in case a custom transport mutates its configuration.
		const current = source.config()
		if (
			request.projectId !== projectId ||
			request.dataset !== dataset ||
			current.projectId !== projectId ||
			current.dataset !== dataset
		)
			return request.requirements.map(({ key }) => ({
				key,
				status: 'unverified',
			}))
		const grants = await source.request({
			url: `/projects/${projectId}/datasets/${dataset}/acl`,
			method: 'GET',
			tag: 'sanity-kit.collection-prefix-access',
			fetch: { cache: 'no-store', next: undefined },
			...(signal ? { signal } : {}),
		})
		signal?.throwIfAborted()
		return request.requirements.map((requirement) => {
			switch (requirement.kind) {
				case 'type-versions':
					return decision(
						requirement.key,
						checkDocumentTypeReadAccess(requirement.schemaType, grants),
					)
				case 'exact-identities':
					return decision(
						requirement.key,
						checkRoutingSettingsReadAccess(requirement.ids, grants),
					)
				case 'settings-release-identities':
					return decision(
						requirement.key,
						checkRoutingSettingsReleaseReadAccess(
							requirement.publishedIds,
							grants,
						),
					)
			}
		})
	}
}

/**
 * A future writer must read its exact receipt identities to recover an uncertain
 * request. This is separate from inventory visibility and grants no write access.
 * Actions creates and publishes through a draft, so that path checks both IDs.
 * Initial settings strict-create uses only the published receipt identity.
 * The receipt's document type is deliberately unknown to the read interpreter.
 */
export async function checkCollectionPrefixReceiptReadAccess(
	client: CollectionPrefixAclClient,
	receiptId: string,
	signal?: AbortSignal,
	includeDraft = true,
): Promise<{
	readonly ok: boolean
	readonly issues: readonly UrlAccessIssue[]
}> {
	if (
		!/^sanityKit\.collection(?:Prefix|Settings)Publication\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(
			receiptId,
		)
	)
		throw new Error(
			'Collection prefix receipt access needs a generated receipt ID.',
		)
	const { source, projectId, dataset } = accessSource(client)
	signal?.throwIfAborted()
	const grants = await source.request({
		url: `/projects/${projectId}/datasets/${dataset}/acl`,
		method: 'GET',
		tag: 'sanity-kit.collection-prefix-receipt-access',
		fetch: { cache: 'no-store', next: undefined },
		...(signal ? { signal } : {}),
	})
	signal?.throwIfAborted()
	const result = checkRoutingSettingsReadAccess(
		includeDraft ? [receiptId, `drafts.${receiptId}`] : [receiptId],
		grants,
	)
	return {
		ok: result.ok,
		issues: result.issues.map((issue) => {
			const id = issue.key.slice('routing-settings:'.length)
			return {
				key: `collection-prefix-receipt:${id}`,
				label: id.startsWith('drafts.')
					? 'Read the draft record used to confirm whether this collection URL change was published'
					: 'Read the record used to confirm whether this collection URL change was published',
				status: issue.status,
			}
		}),
	}
}
