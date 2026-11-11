/** Resolve installed native Studio configs without rendering or performing writes. */
import assert from 'node:assert/strict'
import { createClient } from '@sanity/client'
import { createMockAuthStore, createSourceFromConfig } from 'sanity'
import { createStructureBuilder } from 'sanity/structure'
import * as kit from '@standard-design/sanity-kit/studio'
import {
	createWorkspace,
	collectionRouting,
	applicationPublish,
	applicationSchedule,
} from './studio-installations.js'

const client = createClient({
	projectId: 'testproject',
	dataset: 'test',
	apiVersion: '2026-10-01',
	useCdn: false,
	maxRetries: 0,
	resolveFetch: () => () =>
		Promise.resolve(
			new globalThis.Response(JSON.stringify({ grants: [] }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			}),
		),
})
for (const withPages of [false, true]) {
	const config = createWorkspace(withPages)
	const source = await createSourceFromConfig({
		...config,
		auth: createMockAuthStore({ client, currentUser: null }),
	})
	const actions = (schemaType, versionType = 'draft') =>
		source.document.actions({
			schemaType,
			versionType,
			releaseId: versionType === 'version' ? 'test-release' : undefined,
		})
	assert.equal(
		source.tools.some((tool) => tool.name === 'pages'),
		withPages,
	)
	for (const type of ['page', 'post']) {
		const current = actions(type)
		assert.ok(current.some((action) => action.action === 'publish'))
		assert.ok(!current.includes(applicationPublish))
		assert.ok(!current.some((action) => action.action === 'schedule'))
		const schema = source.schema.get(type)
		const field = schema.fields.find(
			(entry) => entry.name === (type === 'page' ? 'pathname' : 'slug'),
		)
		assert.equal(field.type.name, 'slug')
		assert.equal(typeof field.type.components.input, 'function')
		assert.equal(typeof field.type.options.isUnique, 'function')
	}
	assert.ok(actions('author').includes(applicationPublish))
	assert.ok(actions('author').includes(applicationSchedule))
	const settings = actions('sanityKitCollectionRoute')
	assert.equal(
		settings.filter((action) => action.action === 'publish').length,
		1,
	)
	assert.ok(
		settings.every((action) =>
			['publish', 'discardChanges'].includes(action.action),
		),
	)
	assert.ok(!settings.includes(applicationPublish))
	assert.ok(
		actions('sanityKitCollectionRoute', 'version').every(
			(action) => action.action === 'discardChanges',
		),
	)
	const redirects = actions('sanityKitRedirect')
	assert.ok(redirects.some((action) => action.action === 'publish'))
	assert.ok(!redirects.includes(applicationPublish))
	assert.ok(!redirects.some((action) => action.action === 'schedule'))
	const S = createStructureBuilder({ source, perspectiveStack: ['drafts'] })
	const items = kit
		.collectionRoutingSettingsItems(S, collectionRouting)
		.map((item) => item.serialize())
	assert.equal(items[0].child.options.id, 'journal-settings')
	const selected = kit.collectionRoutingSettingsItem(
		S,
		collectionRouting,
		'journal',
	)
	const selectedValue = selected.serialize()
	assert.equal(selectedValue.id, items[0].id)
	assert.equal(selectedValue.title, items[0].title)
	for (const key of ['id', 'type', 'template'])
		assert.equal(selectedValue.child.options[key], items[0].child.options[key])
	const section = S.list()
		.title('Journal')
		.items([S.documentTypeListItem('post'), selected.title('Settings')])
		.serialize()
	assert.equal(section.items[1].title, 'Settings')
	assert.equal(section.items[1].child.options.id, 'journal-settings')
	assert.equal(
		section.items[1].child.options.template,
		'sanityKitCollectionRoute-journal',
	)
	assert.throws(
		() => kit.collectionRoutingSettingsItem(S, collectionRouting, 'missing'),
		/Unknown collection/,
	)

	assert.equal(
		kit.redirectManagementItem(S).serialize().child.schemaTypeName,
		'sanityKitRedirect',
	)
}
const noPublishSource = await createSourceFromConfig({
	...createWorkspace(false, true),
	auth: createMockAuthStore({ client, currentUser: null }),
})
assert.deepEqual(
	noPublishSource.document
		.actions({
			schemaType: 'sanityKitCollectionRoute',
			versionType: 'draft',
			releaseId: undefined,
		})
		.map((action) => action.action),
	['discardChanges'],
)

for (const privateName of [
	'urlPublication',
	'collectionRoutingSettings',
	'createCollectionSettingsPublishAction',
	'createFolderWriter',
])
	assert.equal(privateName in kit, false)
console.log(
	'PASS installed Studio fields/settings/actions with Pages and standalone Structure',
)
