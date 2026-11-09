/**
 * Prove visibility before treating a URL inventory as complete. Successful GROQ
 * reads can omit inaccessible documents, so querying cannot establish access.
 *
 * Parse real GROQ, then interpret only a small, provable subset over whole
 * document scopes. Never sample invented documents: a filter can allow a sample
 * while hiding other records. Unknown expressions remain unverified. See
 * docs/url-field.md for supported grants and the editor-facing requirements.
 */
import { parse, Path, type ExprNode } from 'groq-js'
import {
	createPagesRegistry,
	type PagesRouteConfig,
} from '../../url/registry.js'

export interface UrlAccessIssue {
	readonly key: string
	readonly label: string
	readonly status: 'missing' | 'unverified'
}

export type UrlReadOperation =
	'edit' | 'publish' | 'folder-rename' | 'redirect-publish'

type Coverage = true | false | 'unknown'
type Version = 'published' | 'drafts' | 'releases'
interface Scope {
	readonly key: string
	readonly label: string
	readonly schemaType?: string
	readonly version?: Version
	readonly id?: string
	readonly prefix?: string
	/** All release identities for one configured, non-dotted settings ID. */
	readonly releaseOf?: string
}
const unknown = 'unknown'
const and = (a: Coverage, b: Coverage): Coverage =>
	a === false || b === false ? false : a === true && b === true ? true : unknown
const or = (a: Coverage, b: Coverage): Coverage =>
	a === true || b === true ? true : a === false && b === false ? false : unknown
const not = (value: Coverage): Coverage =>
	value === unknown ? unknown : !value
const record = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value)

function unwrap(node: ExprNode): ExprNode {
	return node.type === 'Group' ? unwrap(node.base) : node
}
function attribute(node: ExprNode): string | undefined {
	node = unwrap(node)
	return node.type === 'AccessAttribute' && !node.base ? node.name : undefined
}
function literal(node: ExprNode): unknown {
	node = unwrap(node)
	return node.type === 'Value' ? node.value : undefined
}

/** Exact metadata IDs can use any valid GROQ path; open sets need a proof. */
function pathCoverage(pattern: string, scope: Scope): Coverage {
	if (scope.id) return new Path(pattern).matches(scope.id)
	if (pattern === '**') return true
	if (scope.releaseOf && pattern.startsWith('versions.*.')) {
		const base = pattern.slice('versions.*.'.length)
		// A wildcard release name covers future releases too. A literal release
		// name would only cover one existing release, not this whole scope.
		if (base && !base.includes('*')) return base === scope.releaseOf
	}
	if (scope.prefix) {
		// A namespace's descendants may contain more than one path segment.
		if (pattern.endsWith('.**') && !pattern.slice(0, -3).includes('*')) {
			const prefix = pattern.slice(0, -2)
			if (scope.prefix.startsWith(prefix)) return true
		}
		return unknown
	}
	if (pattern === 'drafts.**') return scope.version === 'drafts'
	if (pattern === 'versions.**') return scope.version === 'releases'
	// Literal namespaces can also prove that version sets do not overlap. This
	// distinguishes missing draft access from an unrelated metadata grant.
	const namespace = pattern.split('.')[0]!
	if (pattern.includes('.') && !namespace.includes('*')) {
		if (scope.version === 'drafts' && namespace !== 'drafts') return false
		if (scope.version === 'releases' && namespace !== 'versions') return false
		if (
			scope.version === 'published' &&
			['drafts', 'versions'].includes(namespace)
		)
			return false
	}
	// A prefix narrower than a whole version namespace cannot prove coverage.
	return unknown
}
function equals(
	field: string | undefined,
	value: unknown,
	scope: Scope,
): Coverage {
	if (typeof value !== 'string') return unknown
	if (field === '_type' && scope.schemaType !== undefined)
		return scope.schemaType === value
	if (field === '_id' && scope.id !== undefined) return scope.id === value
	return unknown
}

/** Three-valued logic preserves uncertainty through NOT, AND and OR. */
function covers(node: ExprNode, scope: Scope): Coverage {
	node = unwrap(node)
	if (node.type === 'Value')
		return typeof node.value === 'boolean' ? node.value : unknown
	if (node.type === 'And')
		return and(covers(node.left, scope), covers(node.right, scope))
	if (node.type === 'Or')
		return or(covers(node.left, scope), covers(node.right, scope))
	if (node.type === 'Not') return not(covers(node.base, scope))
	if (node.type !== 'OpCall') return unknown
	if (node.op === '==' || node.op === '!=') {
		const result = attribute(node.left)
			? equals(attribute(node.left), literal(node.right), scope)
			: equals(attribute(node.right), literal(node.left), scope)
		return node.op === '==' ? result : not(result)
	}
	if (node.op !== 'in') return unknown
	const field = attribute(node.left)
	const right = unwrap(node.right)
	if (right.type === 'Array') {
		return right.elements.reduce<Coverage>(
			(result, item) =>
				or(
					result,
					item.isSplat ? unknown : equals(field, literal(item.value), scope),
				),
			false,
		)
	}
	if (
		field === '_id' &&
		right.type === 'FuncCall' &&
		right.namespace === 'global' &&
		right.name === 'path' &&
		right.args.length === 1
	) {
		const pattern = literal(right.args[0]!)
		if (typeof pattern === 'string') return pathCoverage(pattern, scope)
	}
	return unknown
}

/** Only actual readers are required: editing does not load redirect records. */
function requirements(
	routes: PagesRouteConfig,
	operation: UrlReadOperation,
): Scope[] {
	const registry = createPagesRegistry(routes)
	const scopes: Scope[] = []
	const addType = (schemaType: string, label: string) => {
		for (const version of ['published', 'drafts', 'releases'] as const) {
			scopes.push({
				key: `${schemaType}:${version}`,
				schemaType,
				version,
				label: `Read all ${label} — ${version === 'releases' ? 'release versions' : version}`,
			})
		}
	}
	for (const type of registry.types)
		addType(type.schemaType, `${type.schemaType} documents`)
	// Read by ID, irrespective of type: a malformed registry must remain visible
	// so the loader can reject it rather than mistake it for an absent registry.
	scopes.push({
		key: 'folder-registry',
		label: 'Read the folder registry',
		id: 'sanityKit.folders',
	})
	if (operation !== 'edit') {
		addType('sanityKitRedirect', 'redirect records')
		// Confirm access to this operation's recovery records before dispatch.
		// A page-publish grant must not imply access to another writer's receipts.
		const receipts = {
			publish: {
				key: 'publication-receipts',
				label: 'Read records used to confirm whether a page was published',
				prefix: 'sanityKit.urlPublication.',
			},
			'folder-rename': {
				key: 'folder-rename-receipts',
				label: 'Read records used to confirm whether a folder was renamed',
				prefix: 'sanityKit.folderRename.',
			},
			'redirect-publish': {
				key: 'redirect-publication-receipts',
				label: 'Read records used to confirm whether a redirect was published',
				prefix: 'sanityKit.redirectPublication.',
			},
		}[operation]
		scopes.push(receipts)
	}
	return scopes
}

/**
 * Grants are additive. A recognized grant can prove coverage even alongside an
 * unsupported grant. A malformed ACL response cannot prove missing access.
 * Bounds limit parser/evaluator work; excess input fails closed as unverified.
 */
export function checkUrlReadAccess(
	routes: PagesRouteConfig,
	input: unknown,
	operation: UrlReadOperation,
): { readonly ok: boolean; readonly issues: readonly UrlAccessIssue[] } {
	return checkScopes(requirements(routes, operation), input)
}

/**
 * Prove access to exact routing identities before accepting a missing draft as
 * permission to use its published counterpart. Do not assume a document's type:
 * a malformed record at that ID must remain visible so the loader can reject it.
 */
export function checkRoutingSettingsReadAccess(
	ids: readonly string[],
	input: unknown,
): { readonly ok: boolean; readonly issues: readonly UrlAccessIssue[] } {
	return checkScopes(
		ids.map((id) => ({
			key: `routing-settings:${id}`,
			id,
			label: `Read collection routing settings: ${id}`,
		})),
		input,
	)
}

/** Whole-version coverage, shared with collection-prefix inventory checks. */
export function checkDocumentTypeReadAccess(
	schemaType: string,
	input: unknown,
): { readonly ok: boolean; readonly issues: readonly UrlAccessIssue[] } {
	return checkScopes(
		(['published', 'drafts', 'releases'] as const).map((version) => ({
			key: `${schemaType}:${version}`,
			schemaType,
			version,
			label: `Read all ${schemaType} documents — ${version === 'releases' ? 'release versions' : version}`,
		})),
		input,
	)
}

/** Release settings must remain visible even when their document type is wrong. */
export function checkRoutingSettingsReleaseReadAccess(
	ids: readonly string[],
	input: unknown,
): { readonly ok: boolean; readonly issues: readonly UrlAccessIssue[] } {
	return checkScopes(
		ids.map((id) => ({
			key: `routing-settings-releases:${id}`,
			version: 'releases',
			releaseOf: id,
			label: `Read all release versions of collection routing settings: ${id}`,
		})),
		input,
	)
}

/** Occupancy reads all page versions and active published redirect sources only. */
export function checkUrlConflictReadAccess(
	routes: PagesRouteConfig,
	input: unknown,
): { readonly ok: boolean; readonly issues: readonly UrlAccessIssue[] } {
	const registry = createPagesRegistry(routes)
	const scopes: Scope[] = registry.types.flatMap((type) =>
		(['published', 'drafts', 'releases'] as const).map((version) => ({
			key: `${type.schemaType}:${version}`,
			schemaType: type.schemaType,
			version,
			label: `Read all ${type.schemaType} documents — ${version === 'releases' ? 'release versions' : version}`,
		})),
	)
	scopes.push({
		key: 'redirect-sources:published',
		schemaType: 'sanityKitRedirect',
		version: 'published',
		label: 'Read published redirect sources',
	})
	return checkScopes(scopes, input)
}

function checkScopes(
	scopes: readonly Scope[],
	input: unknown,
): { readonly ok: boolean; readonly issues: readonly UrlAccessIssue[] } {
	const filters: (ExprNode | null)[] = []
	if (!Array.isArray(input) || input.length > 256) filters.push(null)
	else
		for (const grant of input) {
			if (
				!record(grant) ||
				!Array.isArray(grant.permissions) ||
				grant.permissions.some((permission) => typeof permission !== 'string')
			) {
				filters.push(null)
				continue
			}
			if (!grant.permissions.includes('read')) continue
			if (typeof grant.filter !== 'string' || grant.filter.length > 8192) {
				filters.push(null)
				continue
			}
			try {
				const node = parse(grant.filter)
				// Limit AST depth before recursive interpretation, including group nodes.
				const pending: { value: unknown; depth: number }[] = [
					{ value: node, depth: 0 },
				]
				let count = 0
				while (pending.length) {
					const { value, depth } = pending.pop()!
					if (++count > 2048 || depth > 64)
						throw new Error('Filter exceeds analysis limits')
					if (value && typeof value === 'object')
						for (const child of Object.values(value))
							pending.push({ value: child, depth: depth + 1 })
				}
				filters.push(node)
			} catch {
				filters.push(null)
			}
		}
	const issues = scopes.flatMap((scope): UrlAccessIssue[] => {
		const coverage = filters.reduce<Coverage>(
			(result, filter) => or(result, filter ? covers(filter, scope) : unknown),
			false,
		)
		return coverage === true
			? []
			: [
					{
						key: scope.key,
						label: scope.label,
						status: coverage === false ? 'missing' : 'unverified',
					},
				]
	})
	return { ok: issues.length === 0, issues }
}
