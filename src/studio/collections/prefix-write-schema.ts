/**
 * Publishing settings includes the whole draft. Check only fields whose values
 * change, so an unchanged read-only identifier does not prevent normal Publish.
 * Both old and proposed contexts matter: a draft must not turn off its own lock.
 */
import type { useCurrentUser, useSchema } from 'sanity'

type CurrentUser = ReturnType<typeof useCurrentUser>
type Schema = ReturnType<typeof useSchema>
type Path = (string | number | { _key: string })[]
type Row = Record<string, unknown>
const record = (value: unknown): value is Row =>
	!!value && typeof value === 'object' && !Array.isArray(value)
const metadata = new Set([
	'_id',
	'_type',
	'_rev',
	'_createdAt',
	'_updatedAt',
	'_key',
])

function equal(a: unknown, b: unknown): boolean {
	if (a === b) return true
	if (Array.isArray(a) && Array.isArray(b))
		return a.length === b.length && a.every((item, i) => equal(item, b[i]))
	if (record(a) && record(b)) {
		const keys = Object.keys(a)
		return (
			keys.length === Object.keys(b).length &&
			keys.every((key) => equal(a[key], b[key]))
		)
	}
	return false
}

function locked(
	node: Row,
	document: Row,
	value: unknown,
	parent: unknown,
	path: Path,
	currentUser: CurrentUser,
) {
	const rule = node.readOnly
	if (rule === undefined || rule === false) return false
	if (rule === true) return true
	if (typeof rule !== 'function') throw new Error('Unsupported readOnly rule')
	const answer: unknown = (rule as (context: unknown) => unknown)({
		document,
		value,
		parent,
		path,
		currentUser,
	})
	if (answer !== undefined && typeof answer !== 'boolean') {
		void Promise.resolve(answer).catch(() => undefined)
		throw new Error('Unverified readOnly rule')
	}
	return answer === true
}

/** Unknown changed schema paths fail closed; unchanged legacy data is retained. */
export function prefixChangesAreProtected(options: {
	schema: Schema
	currentUser: CurrentUser
	before?: Row
	after: Row
	/** The kit initializes this immutable provenance when creating a redirect. */
	initializeRedirectOrigin?: boolean
}): boolean {
	const { before, after, currentUser } = options
	const type =
		typeof after._type === 'string'
			? options.schema.get(after._type)
			: undefined
	if (!record(type)) throw new Error('Missing document schema')
	if (
		(before && locked(type, before, before, null, [], currentUser)) ||
		locked(type, after, after, null, [], currentUser)
	)
		return true

	function visit(
		node: Row,
		old: unknown,
		next: unknown,
		oldParent: unknown,
		nextParent: unknown,
		path: Path,
		moved = false,
	): boolean {
		if (equal(old, next) && !moved) return false
		if (
			(before && locked(node, before, old, oldParent, path, currentUser)) ||
			locked(node, after, next, nextParent, path, currentUser)
		)
			return true
		if (equal(old, next)) return false
		if (Array.isArray(old) || Array.isArray(next)) {
			const previous: unknown[] = Array.isArray(old) ? old : []
			const proposed: unknown[] = Array.isArray(next) ? next : []
			const keyOf = (item: unknown) => (record(item) ? item._key : undefined)
			if (!Array.isArray(node.of)) throw new Error('Missing array schema')
			const keyed = [...previous, ...proposed].every(
				(item) => record(item) && typeof item._key === 'string',
			)
			if (keyed) {
				for (const list of [previous, proposed]) {
					if (new Set(list.map(keyOf)).size !== list.length)
						throw new Error('Duplicate array keys')
				}
			}
			const keys = keyed
				? [
						...new Set(
							[...previous, ...proposed].map((item) => String(keyOf(item))),
						),
					]
				: Array.from(
						{ length: Math.max(previous.length, proposed.length) },
						(_, i) => i,
					)
			for (const key of keys) {
				const a: unknown = keyed
					? previous.find((item) => keyOf(item) === key)
					: previous[Number(key)]
				const b: unknown = keyed
					? proposed.find((item) => keyOf(item) === key)
					: proposed[Number(key)]
				const moved =
					keyed &&
					a !== undefined &&
					b !== undefined &&
					previous.findIndex((item) => keyOf(item) === key) !==
						proposed.findIndex((item) => keyOf(item) === key)
				if (equal(a, b) && !moved) continue
				const value = b ?? a
				const candidates = node.of.filter(
					(member: unknown) =>
						record(member) &&
						(record(value)
							? member.name === value._type
							: member.jsonType === typeof value),
				)
				if (candidates.length !== 1 || !record(candidates[0]))
					throw new Error('Unknown array member schema')
				if (record(a) && record(b) && a._type !== b._type)
					throw new Error('Changed array member type')
				if (
					visit(
						candidates[0],
						a,
						b,
						previous,
						proposed,
						[...path, keyed ? { _key: String(key) } : Number(key)],
						moved,
					)
				)
					return true
			}
			return false
		}
		if (record(old) || record(next)) {
			const a = record(old) ? old : {}
			const b = record(next) ? next : {}
			if (record(old) && record(next) && old._type !== next._type)
				throw new Error('Changed object type')
			// Reference values are scalar form controls despite storing objects.
			// Their internal keys have no individual field schemas to traverse.
			const referenceNames = new Set(['reference', 'crossDatasetReference'])
			if (
				referenceNames.has(String(node.name)) ||
				(record(node.type) && referenceNames.has(String(node.type.name)))
			) {
				const allowed = new Set([
					...metadata,
					'_ref',
					'_weak',
					'_dataset',
					'_projectId',
					'_strengthenOnPublish',
				])
				if (
					[...Object.keys(a), ...Object.keys(b)].some(
						(key) => !allowed.has(key) && !equal(a[key], b[key]),
					)
				)
					throw new Error('Unknown changed reference field')
				return false
			}
			for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
				if (metadata.has(key) || equal(a[key], b[key])) continue
				// Sanity adds draft ancestry after the first edit of a published
				// document. It is server metadata, not a consumer schema field.
				// Only the document root has this exemption; nested values still
				// require their normal schema and read-only checks.
				if (path.length === 0 && key === '_system') continue
				if (
					options.initializeRedirectOrigin &&
					path.length === 0 &&
					key === 'origin'
				)
					continue
				const field: unknown = Array.isArray(node.fields)
					? node.fields.find(
							(field: unknown) => record(field) && field.name === key,
						)
					: undefined
				if (!record(field) || !record(field.type))
					throw new Error('Unknown changed field schema')
				if (visit(field.type, a[key], b[key], old, next, [...path, key]))
					return true
			}
		}
		return false
	}
	return visit(type, before, after, null, null, [])
}
