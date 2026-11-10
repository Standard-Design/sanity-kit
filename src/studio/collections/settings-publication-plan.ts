/**
 * Decide which settings-publishing workflow a document needs. This is a pure
 * classification step, not a routing review or permission to publish. In
 * particular, activating a collection still needs a complete URL collision
 * check before its first settings draft can become live.
 *
 * Resolve only the selected collection here. Other collections may also be
 * awaiting their first settings document; requiring a complete live routing
 * context just to classify this one would prevent that setup from progressing.
 * Never substitute configured defaults for missing published settings.
 * @see docs/collection-prefix-publication.md
 */
import {
	COLLECTION_ROUTE_TYPE,
	createCollectionRouting,
	type CollectionRoutingConfig,
} from '../../url/settings/resolve.js'

interface ClassificationIdentity {
	readonly collection: string
	readonly documentId: string
	readonly draftRevision: string
	readonly prefixOwnership: 'editable' | 'locked'
}

export type CollectionSettingsPublicationClassification =
	ClassificationIdentity &
		(
			| {
					readonly kind: 'first-publication'
					readonly publishedRevision: null
					readonly prefix: string
					/** A code-locked prefix already exists without a settings document. */
					readonly activatesUrls: boolean
			  }
			| {
					readonly kind: 'unchanged-prefix'
					readonly publishedRevision: string
					readonly prefix: string
			  }
			| {
					readonly kind: 'prefix-change'
					readonly publishedRevision: string
					readonly oldPrefix: string
					readonly newPrefix: string
			  }
		)

export type CollectionSettingsPublicationClassificationResult =
	| {
			readonly ok: true
			readonly value: CollectionSettingsPublicationClassification
	  }
	| {
			readonly ok: false
			readonly reason:
				| 'invalid-input'
				| 'unknown-collection'
				| 'settings-not-configured'
				| 'incomplete-evidence'
				| 'missing-draft'
				| 'release-version-unsupported'
				| 'wrong-settings-identity'
				| 'invalid-settings'
				| 'invalid-prefix'
			readonly version?: 'published' | 'draft'
	  }

const record = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value)
const own = (value: Record<string, unknown>, key: string): unknown =>
	Object.hasOwn(value, key) ? value[key] : undefined
type Failure = Extract<
	CollectionSettingsPublicationClassificationResult,
	{ ok: false }
>

/**
 * Snapshot and validate registration once. Calls need actual raw document
 * versions: `null` means the caller established absence, while missing or
 * undefined values mean it has not finished loading. This function cannot
 * prove that a missing document was readable; the caller must establish that.
 *
 * No result checks other collections, page/redirect inventories, schema rules,
 * read/write access, synchronization, or existing release versions. A supplied
 * release document is rejected rather than treated as the ordinary draft.
 */
export function createCollectionSettingsPublicationClassifier(
	configuration: CollectionRoutingConfig,
) {
	const config = structuredClone(configuration)
	createCollectionRouting(config)
	const entries = new Map(
		(config.collections ?? []).map((collection) => [
			collection.name,
			{
				collection,
				// This resolver supplies the shared native slug/prefix validation.
				// It is deliberately not the complete application's routing context.
				routing: createCollectionRouting({
					...config,
					collections: [collection],
				}),
			},
		]),
	)
	return Object.freeze({
		classify(
			input: unknown,
		): CollectionSettingsPublicationClassificationResult {
			if (!record(input) || typeof own(input, 'collection') !== 'string')
				return { ok: false, reason: 'invalid-input' }
			const entry = entries.get(input.collection as string)
			if (!entry) return { ok: false, reason: 'unknown-collection' }
			const { collection, routing } = entry
			const documentId = collection.settingsDocumentId
			if (!documentId) return { ok: false, reason: 'settings-not-configured' }
			const published = own(input, 'published')
			const draft = own(input, 'draft')
			if (published === undefined || draft === undefined)
				return { ok: false, reason: 'incomplete-evidence' }
			if (draft === null) return { ok: false, reason: 'missing-draft' }
			function checkIdentity(
				value: unknown,
				version: 'published' | 'draft',
			): Failure | undefined {
				if (!record(value))
					return { ok: false, reason: 'invalid-settings', version }
				const id = own(value, '_id')
				if (typeof id === 'string' && id.startsWith('versions.'))
					return { ok: false, reason: 'release-version-unsupported', version }
				if (
					id !== (version === 'draft' ? `drafts.${documentId}` : documentId) ||
					(own(value, '_originalId') !== undefined &&
						own(value, '_originalId') !== id)
				)
					return { ok: false, reason: 'wrong-settings-identity', version }
				const revision = own(value, '_rev')
				if (
					own(value, '_type') !== COLLECTION_ROUTE_TYPE ||
					own(value, 'collection') !== collection.name ||
					typeof revision !== 'string' ||
					!revision.trim()
				)
					return { ok: false, reason: 'invalid-settings', version }
			}
			const draftError = checkIdentity(draft, 'draft')
			if (draftError) return draftError
			if (published !== null) {
				const publishedError = checkIdentity(published, 'published')
				if (publishedError) return publishedError
			}
			const prefixOwnership =
				typeof collection.routePrefix === 'string' ||
				collection.routePrefix?.mode === 'locked'
					? 'locked'
					: 'editable'
			function resolvePrefix(
				document: unknown,
				version: 'published' | 'draft',
			) {
				const result = routing.resolve(
					{
						status: 'available',
						perspective: 'raw',
						coverage: 'published-and-drafts',
						complete: true,
						documents: [document],
					},
					version === 'draft' ? 'drafts' : 'published',
				)
				return result.ok
					? result.value.routes.collections![0]!.routePrefix
					: null
			}
			const newPrefix = resolvePrefix(draft, 'draft')
			if (newPrefix === null)
				return { ok: false, reason: 'invalid-prefix', version: 'draft' }
			const identity: ClassificationIdentity = {
				collection: collection.name,
				documentId,
				draftRevision: (draft as Record<string, unknown>)._rev as string,
				prefixOwnership,
			}
			if (published === null)
				return {
					ok: true,
					value: Object.freeze({
						...identity,
						kind: 'first-publication',
						publishedRevision: null,
						prefix: newPrefix,
						activatesUrls: prefixOwnership === 'editable',
					}),
				}
			const oldPrefix = resolvePrefix(published, 'published')
			if (oldPrefix === null)
				return { ok: false, reason: 'invalid-prefix', version: 'published' }
			const publishedRevision = (published as Record<string, unknown>)
				._rev as string
			return {
				ok: true,
				value: Object.freeze(
					oldPrefix === newPrefix
						? {
								...identity,
								kind: 'unchanged-prefix',
								publishedRevision,
								prefix: newPrefix,
							}
						: {
								...identity,
								kind: 'prefix-change',
								publishedRevision,
								oldPrefix,
								newPrefix,
							},
				),
			}
		},
	})
}
