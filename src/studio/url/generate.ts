/**
 * Bind the kit's slug generation to native Studio source and slugify options.
 * One controller belongs to one mounted URL input. It proposes a value; it never
 * patches a document. See docs/url.md#studio-generation-context-internal.
 */
import type {
	Path,
	SanityDocument,
	SlugSchemaType,
	SlugSourceContext,
} from 'sanity'
import {
	createUrlAuthoring,
	generateUrlSlug,
	type SlugGenerationResult,
	type UrlCandidate,
	type UrlPreparationReason,
} from '../../url/authoring.js'
import {
	assertFieldPath,
	createPagesRegistry,
	type PagesRouteConfig,
} from '../../url/registry.js'

export interface UrlGenerationInput {
	readonly document: SanityDocument
	/** Compiled native slug schema, including source, maxLength, and slugify. */
	readonly schemaType: SlugSchemaType
	/** Native input path to the slug object, without its current property. */
	readonly path: Path
	readonly context: Omit<SlugSourceContext, 'parent' | 'parentPath'>
	/** The selected folder or resolved collection prefix; never generated. */
	readonly prefix: unknown
	/** Studio's evaluated field state, including conditional/parent restrictions. */
	readonly readOnly: boolean
	readonly signal?: AbortSignal
}

type GenerationFailure = Extract<SlugGenerationResult, { ok: false }>['reason']
export type UrlGenerationResult =
	| {
			readonly ok: true
			readonly value: UrlCandidate
			/** A nonempty existing value must not be replaced without editor consent. */
			readonly requiresConfirmation: boolean
	  }
	| {
			readonly ok: false
			readonly reason:
				| GenerationFailure
				| UrlPreparationReason
				| 'invalid-field'
				| 'invalid-context'
				| 'invalid-source-path'
				| 'source-failed'
				| 'read-only'
				| 'aborted'
				| 'superseded'
	  }

/** Read document data only, never inherited properties or array slice paths. */
function readPath(value: unknown, path: Path): unknown {
	for (const segment of path) {
		if (Array.isArray(segment))
			throw new Error('Slice paths are not source fields.')
		if (typeof segment === 'object') {
			if (!segment || typeof segment._key !== 'string')
				throw new Error('Invalid key.')
			value = Array.isArray(value)
				? value.find(
						(item: unknown) =>
							item !== null &&
							typeof item === 'object' &&
							Object.hasOwn(item, '_key') &&
							(item as Record<string, unknown>)._key === segment._key,
					)
				: undefined
		} else {
			if (typeof segment !== 'string' && typeof segment !== 'number')
				throw new Error('Invalid path.')
			if (
				typeof segment === 'number' &&
				(!Number.isSafeInteger(segment) || segment < 0)
			)
				throw new Error('Invalid index.')
			if (typeof segment === 'number' && !Array.isArray(value)) {
				value = undefined
				continue
			}
			value =
				value !== null &&
				typeof value === 'object' &&
				Object.hasOwn(value, segment)
					? (value as Record<string | number, unknown>)[segment]
					: undefined
		}
	}
	return value
}

/**
 * Registration must already contain the selected settings prefixes. Recreate
 * this controller when that context changes and invalidate the old controller.
 * Starting a newer generation supersedes earlier work. The input must also call
 * invalidate() on edits, document/settings changes, read-only changes, and unmount.
 */
export function createUrlGeneration(config: PagesRouteConfig) {
	const registry = createPagesRegistry(config)
	const authoring = createUrlAuthoring(config)
	let epoch = 0
	return Object.freeze({
		invalidate() {
			epoch += 1
		},
		async generate(input: UrlGenerationInput): Promise<UrlGenerationResult> {
			const request = ++epoch
			const obsolete = (): UrlGenerationResult | undefined =>
				input.signal?.aborted
					? { ok: false, reason: 'aborted' }
					: request !== epoch
						? { ok: false, reason: 'superseded' }
						: undefined
			const stopped = obsolete()
			if (stopped) return stopped
			if (input.readOnly || input.schemaType.readOnly === true)
				return { ok: false, reason: 'read-only' }
			const type = registry.types.find(
				(entry) => entry.schemaType === input.document._type,
			)
			if (!type) return { ok: false, reason: 'unregistered-type' }
			const storedPath = type.pathField.split('.')
			if (
				storedPath.at(-1) !== 'current' ||
				input.path.length !== storedPath.length - 1 ||
				input.path.some((part, index) => part !== storedPath[index])
			)
				return { ok: false, reason: 'invalid-field' }
			const parentPath = input.path.slice(0, -1)
			const parent = readPath(input.document, parentPath)
			if (!parent || typeof parent !== 'object' || Array.isArray(parent))
				return { ok: false, reason: 'invalid-context' }
			const context: SlugSourceContext = {
				...input.context,
				parent: parent as Record<string, unknown>,
				parentPath,
			}
			const { source, slugify, maxLength } = input.schemaType.options ?? {}
			const prefix = input.prefix
			const previous = readPath(input.document, storedPath)
			let sourceValue: unknown
			if (typeof source === 'function') {
				try {
					sourceValue = await source(input.document, context)
				} catch {
					return obsolete() ?? { ok: false, reason: 'source-failed' }
				}
			} else {
				if (source === undefined || source === '')
					return { ok: false, reason: 'missing-source' }
				try {
					// Dotted names need no Studio-internal parser. For array selectors,
					// supply the native Path array form instead of bracketed strings.
					if (typeof source === 'string') assertFieldPath(source, 'URL source')
					const path = typeof source === 'string' ? source.split('.') : source
					if (!Array.isArray(path) || !path.length)
						throw new Error('Invalid source path.')
					sourceValue = readPath(input.document, path)
				} catch {
					return { ok: false, reason: 'invalid-source-path' }
				}
			}
			const afterSource = obsolete()
			if (afterSource) return afterSource
			const generated = await generateUrlSlug(sourceValue, {
				...(maxLength === undefined ? {} : { maxLength }),
				...(slugify
					? {
							slugify: (value: string) =>
								slugify(value, input.schemaType, context),
						}
					: {}),
			})
			const afterGeneration = obsolete()
			if (afterGeneration) return afterGeneration
			if (!generated.ok) return generated
			const candidate = authoring.prepareParts(type.schemaType, {
				prefix,
				slug: generated.value,
			})
			if (!candidate.ok) return candidate
			return {
				...candidate,
				requiresConfirmation:
					previous !== undefined &&
					previous !== null &&
					previous !== '' &&
					previous !== candidate.value.storedValue,
			}
		},
	})
}
