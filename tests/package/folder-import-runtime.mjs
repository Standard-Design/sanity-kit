/** Installed API contract; transport is local and never reaches a dataset. */
import assert from 'node:assert/strict'
import { createFolderSynchronizer } from '@standard-design/sanity-kit/folders/server'
const routes = {
	pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
}
let registry = null
let value = '/about/company/team'
let grants = [{ filter: 'true', permissions: ['read'] }]
let lost = false
let writes = 0
let reads = 0
let aclReads = 0
const client = {
	withConfig(config) {
		assert.deepEqual(config, {
			apiVersion: '2026-10-01',
			perspective: 'raw',
			useCdn: false,
			stega: false,
		})
		return {
			config: () => ({ projectId: 'testproject', dataset: 'test' }),
			async fetch(_query, _params, options) {
				reads++
				assert.equal(options.cache, 'no-store')
				return {
					registry: globalThis.structuredClone(registry),
					documents: [
						{ _id: 'drafts.team', _type: 'page', _rev: 'page-rev', value },
					],
				}
			},
			async request(options) {
				if (options.url.endsWith('/acl')) {
					aclReads++
					return grants
				}
				assert.equal(options.method, 'POST')
				assert.equal(options.maxRetries, 0)
				const [mutation] = options.body.mutations
				assert.equal(options.body.mutations.length, 1)
				if (mutation.create) {
					if (registry)
						throw Object.assign(new Error('Conflict'), { statusCode: 409 })
					registry = {
						...globalThis.structuredClone(mutation.create),
						_rev: 'revision-1',
					}
				} else {
					const patch = mutation.patch
					assert.equal(patch.id, 'sanityKit.folders')
					assert.equal(patch.ifRevisionID, registry._rev)
					registry.folders.push(
						...globalThis.structuredClone(patch.insert.items),
					)
					registry._rev = 'revision-2'
				}
				writes++
				if (lost) {
					lost = false
					throw new Error('Lost acknowledgment')
				}
				return {
					transactionId: `transaction-${writes}`,
					results: [
						{
							id: 'sanityKit.folders',
							operation: mutation.create ? 'create' : 'update',
						},
					],
				}
			},
		}
	},
}
const service = createFolderSynchronizer(routes, client)
assert.deepEqual(Object.keys(service), ['synchronize'])
assert.equal(aclReads, 0)
lost = true
assert.deepEqual(await service.synchronize(), {
	status: 'outcome-unknown',
	reason: 'request-failed',
})
assert.equal(writes, 1)
assert.deepEqual(
	registry.folders.map((folder) => folder.pathname),
	['/about', '/about/company'],
)
// A restarted caller observes current folders, not proof of its predecessor's result.
assert.deepEqual(await createFolderSynchronizer(routes, client).synchronize(), {
	status: 'synced',
	count: 0,
	evidence: 'already-present',
})
assert.equal(writes, 1)
registry.custom = { preserved: true }
registry.folders[0].custom = 'preserved'
value = '/news/team'
assert.deepEqual(await service.synchronize(), {
	status: 'synced',
	count: 1,
	evidence: 'write-confirmed',
})
assert.deepEqual(registry.custom, { preserved: true })
assert.equal(registry.folders[0].custom, 'preserved')
assert.equal(value, '/news/team')
const before = reads
grants = []
const denied = await service.synchronize()
assert.equal(denied.status, 'blocked')
assert.equal(denied.reason, 'unknown-read-access')
assert.ok(denied.accessIssues.length > 0)
assert.equal(reads, before)
assert.equal(writes, 2)
const abort = new globalThis.AbortController()
abort.abort()
assert.deepEqual(await service.synchronize(abort.signal), {
	status: 'blocked',
	reason: 'aborted',
})
assert.equal(aclReads, 4)
assert.equal(
	'createFolderWriter' in
		(await import('@standard-design/sanity-kit/folders/server')),
	false,
)
await assert.rejects(
	import('@standard-design/sanity-kit/studio/folders/write.js'),
	{ code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' },
)
console.log('PASS installed folder import convergence/access contracts')
