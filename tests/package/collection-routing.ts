/** Public type contract checked against an installed tarball, without Studio. */
import {
	createCollectionRouting,
	type CollectionRoutingConfig,
	type SettingsCollectionDefinition,
	type CollectionSettingValue,
	type RoutingSettingsSnapshot,
	type RoutingPerspective,
	type ResolvedCollectionSetting,
	type CollectionRoutingResult,
	type SanityResolvedUrl,
} from '@standard-design/sanity-kit/url'

const prefix: CollectionSettingValue = { mode: 'default', value: '/journal' }
const collection: SettingsCollectionDefinition = {
	name: 'journal',
	title: 'Journal',
	settingsDocumentId: 'journal-settings',
	index: { schemaType: 'page', pathname: '/journal' },
	routePrefix: prefix,
	items: [{ schemaType: 'post', slugField: 'slug.current' }],
}
const config: CollectionRoutingConfig = {
	pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
	collections: [collection],
}
const routing = createCollectionRouting(config)
const snapshot: RoutingSettingsSnapshot = {
	status: 'available',
	perspective: 'raw',
	coverage: 'published-and-drafts',
	complete: true,
	documents: [],
}
const perspective: RoutingPerspective = 'drafts'
const result: CollectionRoutingResult = routing.resolve(snapshot, perspective)
if (result.ok) {
	const settings: readonly ResolvedCollectionSetting[] = result.value.settings
	const resolved = result.value.resolveUrl({
		_type: 'post',
		slug: { current: 'first-post' },
	})
	if (resolved.ok) {
		const url: SanityResolvedUrl = resolved.value
		void url
	}
	void settings
} else {
	const reason: string = result.reason
	void reason
	// @ts-expect-error A failed settings resolution never supplies a guessed URL context.
	void result.value
}
// @ts-expect-error Collection settings do not support release perspectives yet.
routing.resolve(snapshot, ['release-one'])
// @ts-expect-error Defaults and locked values require an explicit supported mode.
const invalid: CollectionSettingValue = { mode: 'editable', value: '/journal' }
void invalid
