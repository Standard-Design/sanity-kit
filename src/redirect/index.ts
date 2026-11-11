/**
 * Framework-independent HTTP redirect handling. Consumers supply the client,
 * trusted preview state, validation policy, and optional cache adapter.
 * No Studio installation or React Router runtime is loaded by this entry.
 * @see docs/redirects.md for request placement and cache invalidation.
 */
export {
	resolveRedirectRequest,
	redirectResponse,
	invalidateRedirectCache,
} from './request.js'
export type {
	RedirectRequestClient,
	RedirectRequestOptions,
	RedirectRequestResult,
	RedirectCache,
	RedirectCacheContext,
} from './request.js'
export type {
	RedirectSnapshotOptions,
	RedirectSnapshotReason,
	RedirectMatch,
} from './snapshot.js'
