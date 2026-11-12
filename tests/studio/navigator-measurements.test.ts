import { describe, expect, it } from 'vitest'
import {
	createMeasurements,
	SAMPLE_LIMIT_MS,
	ordinaryInventoryReadiness,
	ordinaryRenderReadiness,
	queryKind,
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

describe('virtualized navigator measurement evidence', () => {
	it('requires the actual completed inventory, not the fixture source or mounted window', () => {
		const ready = {
			loading: false,
			refreshing: false,
			error: false,
			disconnected: false,
			data: { documents: [{ _id: 'home' }, { _id: 'page-1' }] },
		}
		expect(ordinaryInventoryReadiness(ready, ['home', 'page-1']).ready).toBe(
			true,
		)
		expect(
			ordinaryInventoryReadiness({ ...ready, loading: true }, [
				'home',
				'page-1',
			]).ready,
		).toBe(false)
		expect(
			ordinaryInventoryReadiness({ ...ready, refreshing: true }, [
				'home',
				'page-1',
			]).ready,
		).toBe(false)
		expect(
			ordinaryInventoryReadiness({ ...ready, error: true }, ['home', 'page-1'])
				.ready,
		).toBe(false)
		expect(
			ordinaryInventoryReadiness({ ...ready, disconnected: true }, [
				'home',
				'page-1',
			]).ready,
		).toBe(false)
		expect(ordinaryInventoryReadiness(ready, ['home', 'page-2']).ready).toBe(
			false,
		)
		expect(
			ordinaryInventoryReadiness(
				{ ...ready, data: { documents: [{ _id: 'home' }, { _id: 'home' }] } },
				['home', 'page-1'],
			).ready,
		).toBe(false)
	})
	it('checks a separate mounted-window budget without equating renderer units and documents', () => {
		const window = {
			ordinaryRows: 15,
			viewportHeight: 600,
			virtual: { logical: 1008, rendered: 20 },
		}
		expect(ordinaryRenderReadiness(window).ready).toBe(true)
		expect(
			ordinaryRenderReadiness({ ...window, virtual: undefined }).ready,
		).toBe(false)
		expect(ordinaryRenderReadiness({ ...window, ordinaryRows: 0 }).ready).toBe(
			false,
		)
		expect(
			ordinaryRenderReadiness({ ...window, viewportHeight: 0 }).ready,
		).toBe(false)
		expect(
			ordinaryRenderReadiness({
				...window,
				virtual: { logical: 1008, rendered: 1008 },
			}).ready,
		).toBe(false)
		expect(
			ordinaryRenderReadiness({
				...window,
				virtual: { logical: 1008, rendered: 101 },
			}).ready,
		).toBe(false)
		expect(
			ordinaryRenderReadiness({
				...window,
				virtual: { logical: 1008, rendered: NaN },
			}).ready,
		).toBe(false)
	})
	it('classifies collection cursor IDs before identity queries and leaves unknown reads visible', () => {
		expect(queryKind('*[]', { after: '' })).toBe('pages')
		expect(queryKind('*[]', { registryId: 'sanityKit.folders' })).toBe(
			'folders',
		)
		expect(queryKind('*[]', { id: 'page' })).toBe('identity')
		expect(queryKind('*[]', { path: '/about' })).toBe('identity')
		expect(queryKind('{"total": 1}', { types: ['post'] })).toBe('recent')
		expect(queryKind('*[]', { search: '', hasCursor: true, id: 'post' })).toBe(
			'collection',
		)
		expect(queryKind('*[]', {})).toBe('other')
	})
	it('reports completed permitted recent reads as query-inclusive, never render-only', () => {
		const { metrics, queries } = recorder()
		queries.byKind = { recent: { started: 3, completed: 3, failed: 0 } }
		metrics.reset('Clear search', false, ['recent'])
		queries.started++
		queries.completed++
		queries.byKind.recent!.started++
		queries.byKind.recent!.completed++
		metrics.record('update', 5, 2)
		const report = metrics.finish()!
		expect(report.valid).toBe(true)
		expect(report.timing).toBe('query-inclusive')
		expect(report.queries.byKind.recent).toEqual({
			started: 1,
			completed: 1,
			failed: 0,
		})
		metrics.reset('Clear search', false, ['recent'])
		metrics.record('update', 1, 3)
		expect(metrics.finish()?.timing).toBe('render-only')
	})
	it('does not accept an initial render with a failed secondary request', () => {
		const { metrics, queries } = recorder()
		metrics.reset('Initial load', true)
		queries.started++
		queries.byKind = { folders: { started: 1, completed: 0, failed: 1 } }
		metrics.record('update', 1, 1)
		const report = metrics.finish()!
		expect(report.valid).toBe(false)
		expect(report.reasons).toContain(
			'A data request failed during this sample.',
		)
	})
	it('does not excuse failed, unrelated, unclassified, or pending reads during clear search', () => {
		for (const mode of [
			'failed',
			'unrelated',
			'unclassified',
			'pending',
		] as const) {
			const { metrics, queries } = recorder()
			metrics.reset('Clear search', false, ['recent'])
			queries.started++
			if (mode === 'pending') queries.pending++
			else if (mode !== 'failed') queries.completed++
			if (mode !== 'unclassified')
				queries.byKind = {
					[mode === 'unrelated' ? 'pages' : 'recent']: {
						started: 1,
						completed: mode === 'failed' || mode === 'pending' ? 0 : 1,
						failed: mode === 'failed' ? 1 : 0,
					},
				}
			metrics.record('update', 5, 2)
			const report = metrics.finish()!
			expect(report.valid, mode).toBe(false)
			expect(report.timing).toBe('query-inclusive')
		}
	})
})
