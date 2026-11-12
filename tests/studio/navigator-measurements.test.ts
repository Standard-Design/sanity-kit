import { describe, expect, it } from 'vitest'
import {
	createMeasurements,
	SAMPLE_LIMIT_MS,
	type QueryCounters,
} from '../fixtures/navigator-acceptance/measurements.js'
import { fixture, useClient } from '../fixtures/navigator-acceptance/native.js'

function recorder() {
	let time = 0
	const queries: QueryCounters = {
		started: 0,
		completed: 0,
		pending: 0,
		milliseconds: 0,
	}
	return {
		metrics: createMeasurements(
			() => time,
			() => queries,
		),
		queries,
		advance: (elapsed: number) => {
			time += elapsed
		},
	}
}
describe('navigator acceptance measurements', () => {
	it('closes a sample before reporting and excludes later renders from the next sample', () => {
		const { metrics, advance } = recorder()
		metrics.reset('Search update')
		advance(10)
		metrics.record('update', 3, 10)
		const report = metrics.finish()!
		expect(report.valid).toBe(true)
		expect(report.metrics.renderMilliseconds).toBe(3)
		metrics.record('update', 999, 11)
		expect(metrics.finish()).toBeUndefined()
		metrics.reset('Scroll')
		advance(5)
		metrics.record('update', 2, 15)
		expect(metrics.finish()?.metrics.renderMilliseconds).toBe(2)
		expect(report.metrics.renderMilliseconds).toBe(3)
	})
	it('accepts initial data loading but rejects requests during an interaction, including failures', () => {
		const { metrics, queries } = recorder()
		metrics.reset('Initial load', true)
		queries.started++
		queries.completed++
		metrics.record('mount', 25, 1)
		expect(metrics.finish()?.valid).toBe(true)
		metrics.reset('Search update')
		queries.started++ // A failed request still contaminates an interaction.
		metrics.record('update', 5, 2)
		const report = metrics.finish()!
		expect(report.valid).toBe(false)
		expect(report.queries).toMatchObject({ started: 1, completed: 0 })
		expect(report.reasons).toContain(
			'Data requests started during this interaction.',
		)
	})
	it('rejects pending requests, missing actions and expired or oversized samples', () => {
		const { metrics, queries, advance } = recorder()
		queries.pending = 1
		metrics.reset('Search update')
		queries.pending = 0
		metrics.record('update', 1, 1)
		expect(metrics.finish()?.valid).toBe(false)
		metrics.reset('Scroll')
		expect(metrics.finish()?.valid).toBe(false)
		metrics.reset('Scroll')
		advance(SAMPLE_LIMIT_MS + 1)
		metrics.record('update', 1, 1)
		expect(metrics.finish()?.valid).toBe(false)
		metrics.reset('Scroll')
		for (let index = 0; index < 201; index++) metrics.record('update', 1, index)
		const report = metrics.finish()!
		expect(report.valid).toBe(false)
		expect(report.commits).toHaveLength(200)
	})
	it('clears pending synthetic fetches after both success and failure', async () => {
		const started = fixture.queryStarts
		const completed = fixture.queries
		const client = useClient()
		const request = client.fetch<unknown[]>('*[]')
		expect(fixture.pendingQueries).toBe(1)
		await request
		expect(fixture.pendingQueries).toBe(0)
		await expect(client.fetch('*[')).rejects.toThrow()
		expect(fixture.pendingQueries).toBe(0)
		expect(fixture.queryStarts - started).toBe(2)
		expect(fixture.queries - completed).toBe(1)
	})
})
