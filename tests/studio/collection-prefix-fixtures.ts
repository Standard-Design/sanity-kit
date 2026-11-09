import type { CollectionRoutingConfig } from '../../src/url/settings/resolve.js'
import type {
	CollectionPrefixInventory,
	CollectionPrefixChoice,
} from '../../src/studio/collections/prefix-plan.js'
export const configuration: CollectionRoutingConfig = {
	pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
	collections: [
		{
			name: 'journal',
			title: 'Journal',
			settingsDocumentId: 'journal-settings',
			index: { schemaType: 'page', pathname: '/insights' },
			items: [{ schemaType: 'post', slugField: 'slug.current' }],
		},
	],
	reservedPathPrefixes: ['/account'],
	excludePaths: ['/reserved'],
}
export const choice: CollectionPrefixChoice = {
	collection: 'journal',
	publishedRevision: 'live-settings',
	draftRevision: 'draft-settings',
	createRedirects: true,
}
export const setting = (
	id = 'journal-settings',
	prefix = '/journal',
	revision = 'live-settings',
	collection = 'journal',
) => ({
	_id: id,
	_type: 'sanityKitCollectionRoute',
	_rev: revision,
	collection,
	prefix: { _type: 'slug', current: prefix },
	displayName: 'Journal',
})
export const post = (id = 'post-1', slug: unknown = 'alpha') => ({
	_id: id,
	_type: 'post',
	_rev: `revision-${id}`,
	title: 'First post',
	slug: { _type: 'slug', current: slug },
	body: 'Unrelated draft content remains untouched',
})
export const page = (id: string, pathname: unknown) => ({
	_id: id,
	_type: 'page',
	_rev: `revision-${id}`,
	title: 'An ordinary page',
	pathname: { _type: 'slug', current: pathname },
})
export const redirect = (
	id = 'alias',
	source = '/old-alpha',
	destination = '/journal/alpha',
) => ({
	_id: id,
	_type: 'sanityKitRedirect',
	_rev: `revision-${id}`,
	source,
	destination,
	status: 301,
	enabled: true,
	origin: 'manual',
})
export function inventory(): CollectionPrefixInventory {
	return {
		perspective: 'raw',
		complete: true,
		readAccess: 'all-required-versions',
		settings: [
			setting(),
			setting('drafts.journal-settings', '/blog', 'draft-settings'),
		],
		documents: [
			post(),
			post('drafts.post-1', 'draft-title'),
			page('index', '/insights'),
		],
		redirects: [redirect()],
	}
}
