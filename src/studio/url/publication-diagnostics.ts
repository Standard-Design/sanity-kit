/**
 * Build editor evidence from an already access-checked redirect inventory.
 * These descriptions do not authorize writes or relax redirect validation.
 * Display only known fields; malformed nested content is never serialized.
 */
import { REDIRECT_MAX_RECORDS } from '../../redirect/snapshot.js'
import type { RedirectSnapshotReason } from '../../redirect/snapshot.js'

const record = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value)
const maxDisplayLength = 240
const hasControlCharacters = (value: string) => {
	for (const character of value) {
		const code = character.charCodeAt(0)
		if (code < 32 || code === 127) return true
	}
	return false
}

/** A bad field can still belong to a known redirect; a bad identity cannot. */
export function safeRedirectRecordId(value: unknown): string | undefined {
	if (
		!record(value) ||
		!Object.hasOwn(value, '_id') ||
		!Object.hasOwn(value, '_type') ||
		value._type !== 'sanityKitRedirect'
	)
		return
	const id = value._id
	if (
		typeof id !== 'string' ||
		!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/u.test(id) ||
		id.includes('..') ||
		id.endsWith('.')
	)
		return
	const parts = id.split('.')
	if (parts[0] === 'versions' && parts.length < 3) return
	const base = id.startsWith('drafts.')
		? id.slice(7)
		: id.startsWith('versions.')
			? parts.slice(2).join('.')
			: id
	if (
		!base ||
		base.startsWith('-') ||
		base.startsWith('drafts.') ||
		base.split('.').includes('versions')
	)
		return
	return id
}

export function redirectDisplayValue(value: unknown): string {
	if (value === undefined || value === null) return 'Not set'
	if (typeof value === 'string') {
		if (!value) return 'Empty value'
		if (!value.trim()) return 'Whitespace only'
		return value.length > maxDisplayLength
			? `${value.slice(0, maxDisplayLength - 1)}…`
			: value
	}
	if (typeof value === 'boolean') return String(value)
	if (typeof value === 'number')
		return Number.isFinite(value) ? String(value) : 'Invalid number'
	return Array.isArray(value)
		? 'Unsupported array value'
		: 'Unsupported object value'
}

export interface RedirectFieldIssue {
	readonly field: string
	readonly value: string
	readonly message: string
}

/** Explain the failing path condition; validation itself stays in the compiler. */
function pathIssue(value: unknown): string {
	if (value === undefined || value === null || value === '')
		return 'Enter the missing URL path.'
	if (typeof value !== 'string')
		return 'Enter the URL path as text, beginning with /.'
	if (!value.startsWith('/')) return 'Start this URL path with /.'
	if (value.includes('?'))
		return 'Remove the query string beginning with ? from this URL path.'
	if (value.includes('#'))
		return 'Remove the fragment beginning with # from this URL path.'
	if (value.includes('\\'))
		return 'Replace backslashes with forward slashes in this URL path.'
	if (hasControlCharacters(value))
		return 'Remove control characters from this URL path.'
	if (/\s/u.test(value))
		return 'Remove spaces and other whitespace from this URL path.'
	if (value.includes('//'))
		return 'Use one / between path segments; remove repeated slashes.'
	if (value !== '/' && value.endsWith('/'))
		return 'Remove the trailing / from this URL path.'
	if (/%(?:2f|5c)/iu.test(value))
		return 'Remove encoded slash or backslash characters from this URL path.'
	try {
		const decoded = decodeURIComponent(value)
		if (hasControlCharacters(decoded))
			return 'Remove encoded control characters from this URL path.'
	} catch {
		return 'Correct the invalid percent encoding in this URL path.'
	}
	if (/(?:^|\/)\.{1,2}(?:\/|$)/u.test(value))
		return 'Replace . or .. path segments with the complete destination path.'
	return 'Use a complete URL path with valid URL encoding, beginning with /.'
}

export function redirectFieldIssues(
	row: Record<string, unknown>,
	reason?: RedirectSnapshotReason,
): readonly RedirectFieldIssue[] {
	const issue = (
		field: string,
		key: string,
		message: string,
	): RedirectFieldIssue => ({
		field,
		value: redirectDisplayValue(row[key]),
		message,
	})
	if (reason === 'invalid-source')
		return [issue('Source URL', 'source', pathIssue(row.source))]
	if (reason === 'invalid-destination')
		return [issue('Destination URL', 'destination', pathIssue(row.destination))]
	if (reason === 'unsupported-status')
		return [
			issue(
				'Status',
				'status',
				typeof row.status === 'string'
					? 'Use the number 301 for a permanent redirect or 302 for a temporary redirect, rather than a text value.'
					: 'Use 301 for a permanent redirect or 302 for a temporary redirect.',
			),
		]
	if (reason !== 'invalid-record') return []
	const issues: RedirectFieldIssue[] = []
	if (typeof row._rev !== 'string' || !row._rev)
		issues.push(
			issue(
				'Record revision',
				'_rev',
				'The saved record needs a valid revision before it can be checked. Ask a developer to inspect the loaded redirect data.',
			),
		)
	if (typeof row.enabled !== 'boolean')
		issues.push(
			issue(
				'Enabled',
				'enabled',
				'Choose whether this redirect is enabled. The saved value must be true or false.',
			),
		)
	for (const [key, field] of [
		['source', 'Source URL'],
		['destination', 'Destination URL'],
		['status', 'Status'],
	] as const) {
		if (row.enabled === true && (row[key] === undefined || row[key] === null))
			issues.push(
				issue(
					field,
					key,
					`Provide the missing ${field === 'Status' ? 'status' : field.replace('Source', 'source').replace('Destination', 'destination')} before using this redirect.`,
				),
			)
		else if (
			row[key] !== undefined &&
			row[key] !== null &&
			(typeof row[key] === 'object' ||
				typeof row[key] === 'function' ||
				typeof row[key] === 'symbol')
		)
			issues.push(
				issue(
					field,
					key,
					`Replace this unsupported value with ${key === 'status' ? '301 or 302' : 'a URL path'}.`,
				),
			)
	}
	if (!issues.length)
		issues.push({
			field: 'Record shape',
			value: 'Unsupported record data',
			message:
				'The loaded redirect contains unexpected or unsupported fields. Ask a developer to inspect its data shape.',
		})
	return issues
}

interface DiagnosticRow extends Record<string, unknown> {
	_id: string
	source: string
}
export function redirectRowDetails(row: Record<string, unknown>) {
	const source =
		typeof row.source === 'string' && row.source
			? redirectDisplayValue(row.source)
			: 'Source URL unavailable'
	return {
		documentId: safeRedirectRecordId(row)!,
		pathname: source,
		...(typeof row.destination === 'string'
			? { destination: redirectDisplayValue(row.destination) }
			: {}),
	}
}

/** Follow the detected path first, then its incoming branches, without repeats. */
export function relatedRedirectDetails(
	rows: readonly unknown[],
	primary: Record<string, unknown>,
	reason?: RedirectSnapshotReason,
) {
	const active = rows
		.slice(0, REDIRECT_MAX_RECORDS)
		.filter((row): row is DiagnosticRow => {
			const id = safeRedirectRecordId(row)
			return (
				!!id &&
				!id.startsWith('drafts.') &&
				!id.startsWith('versions.') &&
				record(row) &&
				row.enabled === true &&
				typeof row.source === 'string'
			)
		})
	if (reason === 'duplicate-source')
		return {
			relatedRedirects: active
				.filter(
					(row) => row._id !== primary._id && row.source === primary.source,
				)
				.map(redirectRowDetails),
		}
	if (reason !== 'redirect-chain' && reason !== 'redirect-cycle') return {}
	const bySource = new Map(active.map((row) => [row.source, row]))
	const incoming = new Map<string, DiagnosticRow[]>()
	for (const row of active) {
		if (typeof row.destination !== 'string') continue
		const list = incoming.get(row.destination) ?? []
		list.push(row)
		incoming.set(row.destination, list)
	}
	const visited = new Set<string>()
	const ordered: DiagnosticRow[] = []
	const starts: DiagnosticRow[] = []
	const first = active.find((row) => row._id === primary._id)
	if (!first) return {}
	starts.push(first)
	let finalDestination: string | undefined
	for (
		let index = 0;
		index < starts.length && visited.size < REDIRECT_MAX_RECORDS;
		index++
	) {
		let current: DiagnosticRow | undefined = starts[index]
		while (
			current &&
			!visited.has(current._id) &&
			visited.size < REDIRECT_MAX_RECORDS
		) {
			visited.add(current._id)
			ordered.push(current)
			starts.push(
				...(incoming.get(current.source) ?? []).filter(
					(row) => !visited.has(row._id),
				),
			)
			const destination: unknown = current.destination
			const next: DiagnosticRow | undefined =
				typeof destination === 'string' ? bySource.get(destination) : undefined
			if (index === 0 && !next && typeof destination === 'string')
				finalDestination = redirectDisplayValue(destination)
			current = next
		}
	}
	return {
		relatedRedirects: ordered
			.filter((row) => row._id !== primary._id)
			.map(redirectRowDetails),
		...(reason === 'redirect-chain' && finalDestination
			? { finalDestination }
			: {}),
	}
}
