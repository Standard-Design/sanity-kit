/**
 * Save new folders, or explicitly adopt folders already implied by page URLs.
 * Reads and planning remain separate modules; this boundary is the first one
 * allowed to send a mutation. It cannot remove folders or change page URLs.
 * See docs/folders.md for access assumptions and uncertain-outcome recovery.
 */
import type { PagesRouteConfig } from '../../url/registry.js'
import {
	createFolderLoader,
	type FolderLoadResult,
	type FolderReadClient,
} from './load.js'
import {
	createFolderPlanner,
	FOLDER_LIMITS,
	type FolderPlan,
	type FolderRecord,
	type FolderRegistryData,
} from './planner.js'

type FolderMutation =
	| { create: FolderRegistryData }
	| {
			patch: {
				id: string
				ifRevisionID: string
				insert: { after: 'folders[-1]'; items: readonly FolderRecord[] }
			}
	  }

/** Structural types accept the app's or Studio's SDK without an instance check. */
export interface FolderWriteClient {
	withConfig(config: Parameters<FolderReadClient['withConfig']>[0]): ReturnType<
		FolderReadClient['withConfig']
	> & {
		config(): { dataset?: string }
		request(options: {
			url: string
			method: 'POST'
			query: {
				visibility: 'sync'
				returnDocuments: 'false'
				returnIds: 'true'
				autoGenerateArrayKeys: 'false'
			}
			body: { mutations: FolderMutation[] }
			maxRetries: 0
			fetch: { cache: 'no-store'; next: undefined }
			tag: string
			signal?: AbortSignal
		}): Promise<unknown>
	}
}

export interface FolderWriteRequest {
	readonly readAccess: 'all-registered-versions' | 'unknown'
	readonly signal?: AbortSignal
}

type PlanFailure = Extract<
	ReturnType<ReturnType<typeof createFolderPlanner>['planCreate']>,
	{ ok: false }
>['reason']

export type FolderWriteResult =
	| {
			readonly status: 'written'
			readonly transactionId: string
			readonly added: readonly FolderRecord[]
	  }
	| { readonly status: 'unchanged'; readonly added: readonly FolderRecord[] }
	| Extract<FolderLoadResult, { status: 'unavailable' }>
	| { readonly status: 'invalid'; readonly reason: PlanFailure }
	| {
			readonly status: 'rejected'
			readonly reason: 'conflict' | 'permission-denied' | 'request-rejected'
	  }
	| {
			readonly status: 'outcome-unknown'
			readonly reason: 'request-failed' | 'invalid-response'
			/** Reconcile these keys and paths before deciding whether to try again. */
			readonly added: readonly FolderRecord[]
	  }

const record = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * No work starts merely by constructing this service. Each explicit action reads
 * fresh evidence, plans against that read, then attempts at most one mutation.
 * The registry revision protects concurrent folder writes, not document URLs.
 */
export function createFolderWriter(
	options: { readonly routes: PagesRouteConfig },
	client: FolderWriteClient,
) {
	const planner = createFolderPlanner(options)
	const load = createFolderLoader(options, client)
	const source = client.withConfig({
		apiVersion: '2026-10-01',
		perspective: 'raw',
		useCdn: false,
		stega: false,
	})
	const { dataset } = source.config()
	if (typeof dataset !== 'string' || !/^[a-z0-9_][a-z0-9_-]*$/u.test(dataset))
		throw new Error(
			'Folder persistence requires a concrete Sanity dataset name, not an alias.',
		)

	async function save(
		plan: FolderPlan,
		signal?: AbortSignal,
	): Promise<FolderWriteResult> {
		if (signal?.aborted) return { status: 'unavailable', reason: 'aborted' }
		if (plan.operation === 'unchanged')
			return { status: 'unchanged', added: [] }
		// A strict create refuses an already-created singleton. Updates append only
		// new records; existing records and all unknown metadata remain untouched.
		const mutation: FolderMutation =
			plan.guard.kind === 'absent'
				? { create: plan.document }
				: {
						patch: {
							id: planner.id,
							ifRevisionID: plan.guard.revision,
							insert: { after: 'folders[-1]', items: plan.added },
						},
					}
		const body = { mutations: [mutation] }
		// Bound the actual request too, including patch and revision overhead. This
		// cannot measure unrelated metadata retained in the existing Sanity record.
		if (
			new TextEncoder().encode(JSON.stringify(body)).byteLength >
			FOLDER_LIMITS.registryBytes
		)
			return { status: 'invalid', reason: 'limit-exceeded' }
		let response: unknown
		try {
			// The SDK's mutate options do not forward a retry cap, and withConfig
			// retains its transport. A raw request passes maxRetries to that transport.
			response = await source.request({
				url: `/data/mutate/${dataset}`,
				method: 'POST',
				query: {
					visibility: 'sync',
					returnDocuments: 'false',
					returnIds: 'true',
					autoGenerateArrayKeys: 'false',
				},
				body,
				maxRetries: 0,
				// Replace inherited framework caching hints on this write request.
				fetch: { cache: 'no-store', next: undefined },
				tag: 'sanity-kit.folders-write',
				...(signal ? { signal } : {}),
			})
		} catch (error) {
			// Recognize ordinary Sanity rejection responses, not every 4xx: a
			// timeout or client-closed response from a proxy can still be ambiguous.
			// Network errors, aborts and 5xx likewise never trigger a retry here.
			const status = record(error) ? error.statusCode : undefined
			if (
				typeof status === 'number' &&
				[400, 401, 403, 404, 409, 413, 422, 429].includes(status)
			)
				return {
					status: 'rejected',
					reason:
						status === 409
							? 'conflict'
							: status === 401 || status === 403
								? 'permission-denied'
								: 'request-rejected',
				}
			return {
				status: 'outcome-unknown',
				reason: 'request-failed',
				added: plan.added,
			}
		}
		if (
			!record(response) ||
			typeof response.transactionId !== 'string' ||
			!response.transactionId ||
			!Array.isArray(response.results) ||
			response.results.length !== 1 ||
			!record(response.results[0]) ||
			response.results[0].id !== planner.id ||
			response.results[0].operation !== plan.operation
		)
			return {
				status: 'outcome-unknown',
				reason: 'invalid-response',
				added: plan.added,
			}
		// A confirmed write stays confirmed even if the signal was cancelled late.
		return {
			status: 'written',
			transactionId: response.transactionId,
			added: plan.added,
		}
	}

	async function run(
		request: FolderWriteRequest,
		operation: 'create' | 'synchronize',
		pathname?: unknown,
	): Promise<FolderWriteResult> {
		const signal = request?.signal
		const snapshot = await load(request, signal)
		if (snapshot.status !== 'loaded') return snapshot
		const createKey = () => crypto.randomUUID()
		const plan =
			operation === 'synchronize'
				? planner.planSynchronize(
						snapshot.snapshot.registry,
						snapshot.snapshot.inventory,
						createKey,
					)
				: planner.planCreate(snapshot.snapshot.registry, pathname, createKey)
		if (!plan.ok) return { status: 'invalid', reason: plan.reason }
		return save(plan.value, signal)
	}

	return Object.freeze({
		create: (request: FolderWriteRequest & { readonly pathname: string }) =>
			run(request, 'create', request?.pathname),
		synchronize: (request: FolderWriteRequest) => run(request, 'synchronize'),
	})
}
