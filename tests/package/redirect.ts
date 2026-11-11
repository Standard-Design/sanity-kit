/** Public redirect types must work with the supported application SDKs. */
import { createClient } from '@sanity/client'
import {
	resolveRedirectRequest,
	redirectResponse,
	invalidateRedirectCache,
	type RedirectRequestClient,
	type RedirectRequestOptions,
	type RedirectRequestResult,
	type RedirectCache,
	type RedirectCacheContext,
	type RedirectSnapshotOptions,
	type RedirectSnapshotReason,
	type RedirectMatch,
} from '@standard-design/sanity-kit/redirect'

const client: RedirectRequestClient = createClient({
	projectId: 'project123',
	dataset: 'test',
	apiVersion: '2026-10-01',
})
const cache: RedirectCache = {
	key: (context: RedirectCacheContext) => context.key,
	getOrLoad: (_key, load) => load(),
	invalidate: () => Promise.resolve(),
}
const policy: RedirectSnapshotOptions = { destinations: 'unverified' }
const options: RedirectRequestOptions = { ...policy, preview: false, cache }
const result: RedirectRequestResult = await resolveRedirectRequest(
	client,
	new Request('https://example.com/old'),
	options,
)
const response: Response | undefined = redirectResponse(result)
if (result.kind === 'error') {
	const reason: RedirectSnapshotReason | undefined = result.snapshotReason
	void reason
} else if (result.kind === 'redirect') {
	const match: RedirectMatch = result
	void match
}
void response
void invalidateRedirectCache(client, policy, cache)
// @ts-expect-error Preview authorization must be an explicit app decision.
void resolveRedirectRequest(client, new Request('https://example.com'), policy)
