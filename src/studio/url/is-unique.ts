/**
 * Native slug validation adapter, not a second validation UI. The future URL
 * field factory will install this as options.isUnique. It is private until that
 * factory is ready; no existing schema is modified by importing this module.
 */
import type { SlugIsUniqueValidator } from 'sanity'
import {
	createPagesRegistry,
	type PagesRouteConfig,
} from '../../url/registry.js'
import { createSanityUrlResolver } from '../../url/resolve.js'
import { createUrlConflictChecker } from './conflicts.js'

/**
 * Sanity supplies the current document, field path, authenticated client, and
 * cancellation signal. We supply the cross-type, full-URL comparison. Native
 * validation turns false into its usual “slug already in use” error.
 * Throw for checks that cannot finish: a network failure is not a duplicate,
 * and must never be turned into a successful uniqueness result.
 */
export function createUrlIsUnique(
	config: PagesRouteConfig,
): SlugIsUniqueValidator {
	const registry = createPagesRegistry(config)
	const resolve = createSanityUrlResolver(config)
	const snapshot: PagesRouteConfig = {
		pages: registry.types
			.filter((entry) => !entry.collection)
			.map((entry) => ({
				schemaType: entry.schemaType,
				pathnameField: entry.pathField,
				titleField: entry.titleField,
			})),
		collections: registry.collections,
		excludePaths: registry.excludePaths,
	}
	return async (value, context) => {
		const document = context.document
		const type = registry.types.find(
			(entry) => entry.schemaType === document?._type,
		)
		if (!document || !type)
			throw new Error('URL uniqueness needs a registered document type.')
		// Native context.path points to the slug object, not its current string.
		// Refuse accidental use on another slug field or an array item. Do not
		// validate a URL using the registration for a different field.
		const expected = type.pathField.split('.')
		const actual = [...(context.path ?? []), 'current']
		if (
			actual.length !== expected.length ||
			actual.some((part, index) => part !== expected[index])
		)
			throw new Error('URL uniqueness must use the registered slug field.')

		// Validation reads the stored value; unlike explicit authoring preparation,
		// it must not silently check a repaired URL instead of the one being saved.
		const candidate: Record<string, unknown> = { _type: document._type }
		let parent = candidate
		for (const part of expected.slice(0, -1)) {
			const child: Record<string, unknown> = {}
			parent[part] = child
			parent = child
		}
		parent[expected.at(-1)!] = value
		const resolved = resolve(candidate)
		if (!resolved.ok)
			throw new Error(`Cannot check URL uniqueness: ${resolved.reason}.`)

		const check = createUrlConflictChecker(
			snapshot,
			context.getClient({ apiVersion: '2026-10-01' }),
		)
		const result = await check(
			{
				schemaType: document._type,
				storedValue: value,
				...(document._id === undefined ? {} : { documentId: document._id }),
			},
			context.signal,
		)
		if (result.status !== 'checked')
			throw new Error(`Cannot check URL uniqueness: ${result.reason}.`)
		return result.conflicts.length === 0
	}
}
