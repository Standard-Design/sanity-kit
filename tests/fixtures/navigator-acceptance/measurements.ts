/** Bounded React-render samples for the isolated navigator harness. */
export const SAMPLE_LIMIT_MS = 20_000
const COMMIT_LIMIT = 200
export interface QueryCounters {
	started: number
	completed: number
	pending: number
	milliseconds: number
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
				start: number
				queries: QueryCounters
				commits: Commit[]
				overflow: boolean
		  }
		| undefined
	function reset(label: string, initial = false) {
		sample = {
			label,
			initial,
			start: now(),
			queries: { ...queries() },
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
		const endQueries = { ...queries() }
		const reasons: string[] = []
		if (current.overflow || elapsedMilliseconds > SAMPLE_LIMIT_MS)
			reasons.push(
				'Sample exceeded the time or commit limit; repeat a shorter action.',
			)
		if (current.queries.pending || endQueries.pending)
			reasons.push('Data requests were pending at the start or end.')
		if (!current.initial && endQueries.started !== current.queries.started)
			reasons.push('Data requests started during this interaction.')
		if (current.commits.length === 0)
			reasons.push('No navigator render was recorded.')
		return {
			label: current.label,
			kind: current.initial ? 'initial' : 'interaction',
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
				started: endQueries.started - current.queries.started,
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
