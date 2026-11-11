/** The loader accepts both supported SDK client majors without Studio types. */
import { createClient } from '@sanity/client'
import type { CollectionRoutingConfig } from '@standard-design/sanity-kit/url'
import {
	createCollectionRoutingLoader,
	type CollectionSettingsClient,
	type CollectionSettingsLoadRequest,
	type CollectionSettingsLoadResult,
	type CollectionSettingsPairResult,
} from '@standard-design/sanity-kit/url/settings'

const client: CollectionSettingsClient = createClient({
	projectId: 'testproject',
	dataset: 'test',
	apiVersion: '2026-10-01',
})
const config: CollectionRoutingConfig = {
	pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
	collections: [
		{
			name: 'journal',
			title: 'Journal',
			settingsDocumentId: 'journal-settings',
			index: { schemaType: 'page', pathname: '/journal' },
			routePrefix: { mode: 'default', value: '/journal' },
			items: [{ schemaType: 'post', slugField: 'slug.current' }],
		},
	],
}
const loader = createCollectionRoutingLoader(config, client)
const request: CollectionSettingsLoadRequest = {
	perspective: 'drafts',
	draftVisibility: 'all-required-drafts',
	signal: new AbortController().signal,
}
const single: Promise<CollectionSettingsLoadResult> = loader.load(request)
const pair: Promise<CollectionSettingsPairResult> = loader.loadBoth({
	draftVisibility: 'all-required-drafts',
})
void single
void pair
// @ts-expect-error An arbitrary boolean does not represent the required visibility assertion.
void loader.load({ perspective: 'drafts', draftVisibility: true })
// @ts-expect-error Release perspectives need a separate supported integration.
void loader.load({ perspective: 'release-one' })
