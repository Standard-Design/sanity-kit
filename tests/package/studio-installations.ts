/** Installed consumer setups: the same field and wrappers with or without Pages. */
import {
	defineType,
	type DocumentActionComponent,
	type SingleWorkspace,
} from 'sanity'
import { structureTool } from 'sanity/structure'
import {
	pagesTool,
	defineSanityUrlField,
	withUrlPublication,
	withCollectionRoutingSettings,
	collectionRoutingSettingsItems,
	collectionRoutingSettingsItem,
	redirectManagementItem,
	type SanityUrlFieldDefinition,
	type UrlPublicationPluginOptions,
	type CollectionRoutingSettingsOptions,
} from '@standard-design/sanity-kit/studio'
import type {
	PagesRouteConfig,
	CollectionRoutingConfig,
} from '@standard-design/sanity-kit/url'

export const routes: PagesRouteConfig = {
	pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
	collections: [
		{
			name: 'journal',
			title: 'Journal',
			index: { schemaType: 'page', pathname: '/journal' },
			routePrefix: '/journal',
			items: [{ schemaType: 'post', slugField: 'slug.current' }],
		},
	],
}
export const collectionRouting: CollectionRoutingConfig = {
	pages: routes.pages,
	collections: [
		{
			name: 'journal',
			title: 'Journal',
			index: { schemaType: 'page', pathname: '/journal' },
			settingsDocumentId: 'journal-settings',
			displayName: { mode: 'default', value: 'Journal' },
			routePrefix: { mode: 'default', value: '/journal' },
			items: [{ schemaType: 'post', slugField: 'slug.current' }],
		},
	],
}
export const applicationPublish: DocumentActionComponent = () => ({
	label: 'Application publish',
})
applicationPublish.action = 'publish'
export const applicationSchedule: DocumentActionComponent = () => ({
	label: 'Application schedule',
})
applicationSchedule.action = 'schedule'

export function createWorkspace(
	withPages: boolean,
	omitSettingsPublish = false,
): SingleWorkspace {
	const field = {
		name: 'pathname',
		title: 'URL',
		routes,
		collectionRouting,
		inputMode: 'folders',
		options: { source: 'title' },
	} satisfies SanityUrlFieldDefinition
	const config: SingleWorkspace = {
		projectId: 'testproject',
		dataset: 'test',
		schema: {
			types: [
				defineType({
					name: 'page',
					type: 'document',
					fields: [
						{ name: 'title', type: 'string' },
						defineSanityUrlField(field),
					],
				}),
				defineType({
					name: 'post',
					type: 'document',
					fields: [
						{ name: 'title', type: 'string' },
						defineSanityUrlField({ ...field, name: 'slug', inputMode: 'text' }),
					],
				}),
				defineType({
					name: 'author',
					type: 'document',
					fields: [{ name: 'name', type: 'string' }],
				}),
			],
		},
		plugins: [
			structureTool({
				structure: (S) =>
					S.list()
						.title('Content')
						.items([
							...S.documentTypeListItems().filter(
								(item) =>
									!['sanityKitCollectionRoute', 'sanityKitRedirect'].includes(
										item.getId() ?? '',
									),
							),
							S.listItem()
								.id('journal-section')
								.title('Journal')
								.child(
									S.list()
										.title('Journal')
										.items([
											S.documentTypeListItem('post'),
											collectionRoutingSettingsItem(
												S,
												collectionRouting,
												'journal',
											).title('Settings'),
										]),
								),
							...collectionRoutingSettingsItems(S, collectionRouting),
							redirectManagementItem(S),
						]),
			}),
			...(withPages
				? [
						pagesTool({
							...routes,
							collectionRouting,
							name: 'pages',
							previewUrl: 'https://app.example',
						}),
					]
				: []),
		],
		document: {
			actions: (previous, context) => {
				const actions = [...previous, applicationPublish, applicationSchedule]
				return omitSettingsPublish &&
					context.schemaType === 'sanityKitCollectionRoute'
					? actions.filter((item) => item.action !== 'publish')
					: actions
			},
		},
	}
	const urlOptions = {
		routes,
		collectionRouting,
		redirectManagement: 'publish',
	} satisfies UrlPublicationPluginOptions
	const settingsOptions = {
		routes: collectionRouting,
	} satisfies CollectionRoutingSettingsOptions
	return withCollectionRoutingSettings(
		withUrlPublication(config, urlOptions),
		settingsOptions,
	)
}

const obsoleteGate: CollectionRoutingSettingsOptions = {
	routes: collectionRouting,
	// @ts-expect-error The development-only switch is not part of the public options.
	_enablePublication: true,
}
void obsoleteGate
const invalidMode: CollectionRoutingSettingsOptions = {
	routes: collectionRouting,
	// @ts-expect-error Collection settings always use checked Publish; there is no mode option.
	publication: 'drafts',
}
void invalidMode
