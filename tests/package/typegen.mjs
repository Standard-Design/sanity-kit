import assert from 'node:assert/strict'
import { findQueriesInPath } from '@sanity/codegen'

const { queries } = findQueriesInPath({ path: '../web/app/data/queries.ts' })
const extracted = []
for await (const result of queries) {
	assert.deepEqual(
		result.errors,
		[],
		'Installed-package TypeGen extraction failed.',
	)
	extracted.push(...result.queries)
}
assert.equal(extracted.length, 1)
const query = extracted[0].query
assert.equal((query.match(/internalDestination->/gu) ?? []).length, 2)
assert.equal((query.match(/pathname\.current/gu) ?? []).length, 2)
assert.ok(query.includes('label,'))
assert.ok(query.includes('markDefs'))
console.log(
	'Sanity TypeGen extracted installed canonical fragments without resolver overrides or path aliases.',
)
