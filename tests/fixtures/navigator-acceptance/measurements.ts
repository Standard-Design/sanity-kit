/** Bounded React-render samples for the isolated navigator harness. */
export const SAMPLE_LIMIT_MS = 20_000
const COMMIT_LIMIT = 200
export const QUERY_KINDS = [
	'pages',
	'folders',
	'identity',
	'recent',
	'collection',
	'other',
] as const
export type QueryKind = (typeof QUERY_KINDS)[number]
export interface QueryKindCounters {
	started: number
	completed: number
	failed: number
}
export interface QueryCounters {
	started: number
	completed: number
	pending: number
	milliseconds: number
	byKind?: Partial<Record<QueryKind, QueryKindCounters>>
}
interface Commit {
	phase: string
	renderMilliseconds: number
	commitMilliseconds: number
}
export function createMeasurements(
	now: () => number,
	queries: () => QueryCounters,
) {
	let sample:
		| {
				label: string
				initial: boolean
				allowedQueries: readonly QueryKind[]
				start: number
				queries: QueryCounters
				commits: Commit[]
				overflow: boolean
		  }
		| undefined
	function reset(
		label: string,
		initial = false,
		allowedQueries: readonly QueryKind[] = [],
	) {
		sample = {
			label,
			initial,
			allowedQueries: [...allowedQueries],
			start: now(),
			queries: structuredClone(queries()),
			commits: [],
			overflow: false,
		}
	}
	function record(phase: string, actual: number, commitTime: number) {
		if (!sample) return
		if (
			sample.commits.length >= COMMIT_LIMIT ||
			now() - sample.start > SAMPLE_LIMIT_MS
		) {
			sample.overflow = true
			return
		}
		sample.commits.push({
			phase,
			renderMilliseconds: actual,
			commitMilliseconds: commitTime - sample.start,
		})
	}
	function finish() {
		if (!sample) return undefined
		const current = sample
		sample = undefined
		const elapsedMilliseconds = now() - current.start
		const endQueries = structuredClone(queries())
		const byKind = Object.fromEntries(
			QUERY_KINDS.map((kind) => {
				const before = current.queries.byKind?.[kind]
				const after = endQueries.byKind?.[kind]
				return [
					kind,
					{
						started: (after?.started ?? 0) - (before?.started ?? 0),
						completed: (after?.completed ?? 0) - (before?.completed ?? 0),
						failed: (after?.failed ?? 0) - (before?.failed ?? 0),
					},
				]
			}),
		) as Record<QueryKind, QueryKindCounters>
		const started = endQueries.started - current.queries.started
		const classified = Object.values(byKind).reduce(
			(sum, counts) => sum + counts.started,
			0,
		)
		const expectedQueries =
			!current.initial &&
			started > 0 &&
			classified === started &&
			QUERY_KINDS.every(
				(kind) =>
					!byKind[kind].started ||
					(current.allowedQueries.includes(kind) &&
						byKind[kind].failed === 0 &&
						byKind[kind].started === byKind[kind].completed),
			)
		const reasons: string[] = []
		if (current.overflow || elapsedMilliseconds > SAMPLE_LIMIT_MS)
			reasons.push(
				'Sample exceeded the time or commit limit; repeat a shorter action.',
			)
		if (Object.values(byKind).some((counts) => counts.failed > 0))
			reasons.push('A data request failed during this sample.')
		if (current.queries.pending || endQueries.pending)
			reasons.push('Data requests were pending at the start or end.')
		if (!current.initial && started > 0 && !expectedQueries)
			reasons.push('Data requests started during this interaction.')
		if (current.commits.length === 0)
			reasons.push('No navigator render was recorded.')
		return {
			label: current.label,
			kind: current.initial ? 'initial' : 'interaction',
			timing: current.initial
				? 'initial-load'
				: started > 0
					? 'query-inclusive'
					: 'render-only',
			allowedQueryKinds: current.allowedQueries,
			elapsedMilliseconds,
			limitMilliseconds: SAMPLE_LIMIT_MS,
			valid: reasons.length === 0,
			reasons,
			metrics: {
				commits: current.commits.length,
				renderMilliseconds: current.commits.reduce(
					(total, commit) => total + commit.renderMilliseconds,
					0,
				),
				largestCommitMilliseconds: Math.max(
					0,
					...current.commits.map((commit) => commit.renderMilliseconds),
				),
			},
			queries: {
				started,
				byKind,
				completed: endQueries.completed - current.queries.completed,
				pendingAtStart: current.queries.pending,
				pendingAtEnd: endQueries.pending,
				milliseconds: endQueries.milliseconds - current.queries.milliseconds,
			},
			commits: current.commits,
		}
	}
	return { reset, record, finish }
}

/** Inventory completeness is independent of how many rows virtualization mounts. */
export function ordinaryInventoryReadiness(
	snapshot: {
		loading: boolean
		refreshing: boolean
		error: boolean
		disconnected: boolean
		data: { documents: readonly { _id: string }[] }
	},
	expectedIds: readonly string[],
) {
	const actual = snapshot.data.documents.map((document) => document._id)
	const unique = new Set(actual)
	const expected = new Set(expectedIds)
	const ready =
		!snapshot.loading &&
		!snapshot.refreshing &&
		!snapshot.error &&
		!snapshot.disconnected &&
		actual.length === unique.size &&
		unique.size === expected.size &&
		[...expected].every((id) => unique.has(id))
	return {
		ready,
		expected: expected.size,
		loaded: actual.length,
		loading: snapshot.loading,
		refreshing: snapshot.refreshing,
		error: snapshot.error,
		disconnected: snapshot.disconnected,
	}
}

/** This classifies this harness's known query shapes; unknown queries stay visible. */
export function queryKind(
	query: string,
	params: Record<string, unknown>,
): QueryKind {
	if ('registryId' in params) return 'folders'
	if ('search' in params || 'hasCursor' in params) return 'collection'
	if ('after' in params) return 'pages'
	if ('id' in params || 'path' in params) return 'identity'
	if (query.includes('"total":') && Array.isArray(params.types)) return 'recent'
	return 'other'
}

/** Explicit harness budget, not a promise derived from estimated row heights. */
export const ORDINARY_RENDER_BUDGET = 100
export function ordinaryRenderReadiness(input: {
	ordinaryRows: number
	viewportHeight: number
	virtual: { logical: number; rendered: number } | undefined
}) {
	const { virtual, ordinaryRows, viewportHeight } = input
	// The 100/1,000-page profiling scenes both exceed the small-list fallback.
	// Renderer units include folders/notes/recent blocks; they are not document counts.
	const ready =
		viewportHeight > 0 &&
		ordinaryRows > 0 &&
		ordinaryRows <= ORDINARY_RENDER_BUDGET &&
		!!virtual &&
		Number.isSafeInteger(virtual.logical) &&
		Number.isSafeInteger(virtual.rendered) &&
		virtual.logical > 0 &&
		virtual.rendered > 0 &&
		virtual.rendered < virtual.logical &&
		virtual.rendered <= ORDINARY_RENDER_BUDGET
	return { ready, ...input, maximumMountedUnits: ORDINARY_RENDER_BUDGET }
}
