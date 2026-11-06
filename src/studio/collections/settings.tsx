/**
 * Private draft editor for the settings loaded by url/settings. Each collection
 * owns one configured document; collection items continue to store only slugs.
 * This is intentionally not the reviewed prefix-publishing workflow. Ordinary
 * publishing is disabled until that workflow can coordinate URLs and redirects.
 * @see docs/collection-routing.md
 */
import { CogIcon } from '@sanity/icons/Cog'
import { Card, Stack, Text, TextInput } from '@sanity/ui'
import {
	defineField,
	definePlugin,
	defineType,
	useWorkspace,
	useFormValue,
	type DocumentActionComponent,
	type LayoutProps,
	type ObjectInputProps,
	type SingleWorkspace,
	type StringInputProps,
	type SlugInputProps,
} from 'sanity'
import type { StructureBuilder } from 'sanity/structure'
import { CollectionDisplayNamesProvider } from './display-names.js'
import { CollectionSettingsContext } from './settings-context.js'
import { pagePathname } from '../../url/registry.js'
import { isReservedPath } from '../../url/reservations.js'
import {
	COLLECTION_ROUTE_TYPE,
	MAX_COLLECTION_PREFIX_LENGTH,
	MAX_COLLECTION_DISPLAY_NAME_LENGTH,
	createCollectionRouting,
	type CollectionRoutingConfig,
} from '../../url/settings/resolve.js'

export interface CollectionRoutingSettingsOptions {
	readonly routes: CollectionRoutingConfig
}

/** Snapshot and validate registration before creating schema closures or menus. */
function registration(routes: CollectionRoutingConfig) {
	const config = structuredClone(routes)
	createCollectionRouting(config)
	const entries = (config.collections ?? []).flatMap((collection) =>
		!collection.settingsDocumentId
			? []
			: [
					{
						name: collection.name,
						title:
							collection.displayName?.value ??
							collection.title ??
							collection.name,
						displayName: collection.displayName,
						prefix:
							typeof collection.routePrefix === 'string'
								? { mode: 'locked' as const, value: collection.routePrefix }
								: collection.routePrefix,
						documentId: collection.settingsDocumentId,
						templateId: `${COLLECTION_ROUTE_TYPE}-${collection.name}`,
					},
				],
	)
	return { config, entries }
}

/**
 * Local shape checks give immediate feedback without claiming a complete routing
 * inventory. The later Publish review must check other settings, pages, redirects
 * and their latest revisions. Studio validation is not a database constraint.
 */
export function validateCollectionPrefix(
	value: unknown,
	routes: CollectionRoutingConfig,
	currentCollection?: string,
): true | string {
	if (typeof value !== 'string' || !value)
		return 'Enter a URL prefix, such as /journal.'
	if (value.length > MAX_COLLECTION_PREFIX_LENGTH)
		return `Use no more than ${MAX_COLLECTION_PREFIX_LENGTH} characters.`
	if (
		value === '/' ||
		pagePathname(value) !== value ||
		value.endsWith('/') ||
		value.includes('//')
	)
		return 'Use a path such as /journal, with no repeated or trailing slashes. The site root cannot be a collection prefix.'
	if (isReservedPath(value, routes.excludePaths, routes.reservedPathPrefixes))
		return 'This URL is reserved by the app. Choose another prefix.'
	if (
		routes.collections?.some((collection) => {
			if (collection.name === currentCollection) return false
			const prefix =
				typeof collection.routePrefix === 'string'
					? collection.routePrefix
					: collection.routePrefix?.mode === 'locked'
						? collection.routePrefix.value
						: undefined
			return (
				prefix !== undefined &&
				(value === prefix ||
					value.startsWith(`${prefix}/`) ||
					prefix.startsWith(`${value}/`))
			)
		})
	)
		return 'This prefix overlaps a collection whose URL is set in code. Choose another prefix.'
	return true
}

function DraftSettingsInput(props: ObjectInputProps) {
	return (
		<Stack gap={4}>
			<Card padding={3} radius={2} tone="caution">
				<Text size={1}>
					You can save draft changes here. Publishing collection URL changes is
					not available yet. Changes here do not change live URLs.
				</Text>
			</Card>
			{props.renderDefault(props)}
		</Stack>
	)
}

/** Organizational identity is visible for reference, never an editable control. */
export function CollectionIdentifierInput({
	value,
	elementProps,
}: StringInputProps) {
	return <TextInput {...elementProps} value={value ?? ''} readOnly disabled />
}

/** Keep Sanity's permission-aware discard action; no live-routing actions yet. */
function draftActions(actions: DocumentActionComponent[]) {
	return actions.filter((action) => action.action === 'discardChanges')
}

export const collectionRoutingSettings =
	definePlugin<CollectionRoutingSettingsOptions>((options) => {
		const { config, entries } = registration(options.routes)
		const entryFor = (
			document: { _id?: string; collection?: unknown } | undefined,
		) => {
			const id = document?._id?.replace(/^drafts\./u, '')
			return entries.find((entry) => entry.documentId === id)
		}
		// Read locked values from configuration, including on older documents whose
		// stored values differ. Displaying them must not silently rewrite content.
		function DisplayNameInput(props: StringInputProps) {
			const document = useFormValue([]) as { _id?: string }
			const setting = entryFor(document)?.displayName
			return setting?.mode === 'locked' ? (
				<TextInput
					{...props.elementProps}
					value={setting.value}
					readOnly
					disabled
				/>
			) : (
				props.renderDefault(props)
			)
		}
		function PrefixInput(props: SlugInputProps) {
			const document = useFormValue([]) as { _id?: string }
			const setting = entryFor(document)?.prefix
			return setting?.mode === 'locked' ? (
				<TextInput
					{...props.elementProps}
					value={setting.value}
					readOnly
					disabled
				/>
			) : (
				props.renderDefault(props)
			)
		}

		function Layout(props: LayoutProps) {
			const workspace = useWorkspace()
			const actions = workspace.document.actions({
				schemaType: COLLECTION_ROUTE_TYPE,
				versionType: 'draft',
				releaseId: undefined,
			})
			if (actions.some((action) => action.action !== 'discardChanges'))
				throw new Error(
					'Collection settings require withCollectionRoutingSettings at the workspace boundary so native publication cannot bypass the URL-change review.',
				)
			return (
				<CollectionSettingsContext.Provider value={config}>
					<CollectionDisplayNamesProvider routes={config}>
						{props.renderDefault(props)}
					</CollectionDisplayNamesProvider>
				</CollectionSettingsContext.Provider>
			)
		}
		return {
			name: 'sanity-kit-collection-routing-settings',
			studio: { components: { layout: Layout } },
			schema: {
				templates: (previous) => [
					...previous.filter(
						(template) => template.schemaType !== COLLECTION_ROUTE_TYPE,
					),
					...entries.map((entry) => ({
						id: entry.templateId,
						title: `${entry.title} collection settings`,
						schemaType: COLLECTION_ROUTE_TYPE,
						value: {
							collection: entry.name,
							displayName: entry.title,
							...(entry.prefix?.value === undefined
								? {}
								: { prefix: { _type: 'slug', current: entry.prefix.value } }),
						},
					})),
				],
				types: [
					defineType({
						name: COLLECTION_ROUTE_TYPE,
						title: 'Collection settings',
						type: 'document',
						icon: CogIcon,
						components: { input: DraftSettingsInput },
						// A stray creation intent or release version must not become a second
						// editable settings document for the same collection.
						readOnly: ({ document }) =>
							!entryFor(document) ||
							document?.collection !== entryFor(document)?.name,
						validation: (rule) =>
							rule.custom((value) => {
								const entry = entryFor(value)
								return entry && value?.collection === entry.name
									? true
									: 'Open the configured collection settings document. This document does not match a registered collection.'
							}),
						fields: [
							defineField({
								name: 'displayName',
								title: 'Display name',
								type: 'string',
								description:
									'The collection name shown in Studio. Changing it does not change URLs. A name set as locked in configuration is read-only.',
								readOnly: ({ document }) =>
									entryFor(document)?.displayName?.mode === 'locked',
								components: { input: DisplayNameInput },
								validation: (rule) =>
									rule.custom((value, context) =>
										entryFor(context.document)?.displayName?.mode ===
											'locked' ||
										value === undefined ||
										(typeof value === 'string' &&
											value.trim().length > 0 &&
											value.length <= MAX_COLLECTION_DISPLAY_NAME_LENGTH)
											? true
											: 'Enter a name between 1 and 100 characters.',
									),
							}),
							defineField({
								name: 'prefix',
								title: 'URL prefix',
								type: 'slug',
								description:
									'The path before each item’s slug, such as /journal. Changing it does not move listing pages or rewrite item slugs. A prefix set as locked in configuration is read-only.',
								readOnly: ({ document }) =>
									entryFor(document)?.prefix?.mode === 'locked',
								components: { input: PrefixInput },
								// Sanity's default slug uniqueness is scoped to this field/type,
								// not all resolved page URLs. The reviewed publisher will check
								// the complete routing inventory instead.
								options: { isUnique: () => true },
								validation: (rule) =>
									rule.custom((value, context) => {
										const entry = entryFor(context.document)
										return entry?.prefix?.mode === 'locked'
											? true
											: validateCollectionPrefix(
													value?.current,
													config,
													entry?.name,
												)
									}),
							}),
							defineField({
								name: 'collection',
								title: 'Collection identifier',
								type: 'string',
								description: 'Read-only string that identifies the collection',
								readOnly: true,
								components: { input: CollectionIdentifierInput },
								validation: (rule) => rule.required(),
							}),
						],
						preview: {
							select: {
								id: '_id',
								collection: 'collection',
								displayName: 'displayName',
								prefix: 'prefix.current',
							},
							prepare: ({ id, collection, displayName, prefix }) => {
								const entry =
									entries.find((item) => item.name === collection) ??
									entryFor(typeof id === 'string' ? { _id: id } : undefined)
								const name =
									entry?.displayName?.mode === 'locked'
										? entry.displayName.value
										: typeof displayName === 'string' && displayName.trim()
											? displayName.trim()
											: entry?.title
								return {
									title: name
										? `${name} collection settings`
										: 'Collection settings',
									subtitle:
										entry?.prefix?.mode === 'locked'
											? entry.prefix.value
											: typeof prefix === 'string'
												? prefix
												: 'No prefix yet',
								}
							},
						},
					}),
				],
			},
			document: {
				// Singletons are opened through their explicit Structure entries only.
				newDocumentOptions: (previous) =>
					previous.filter(
						(item) =>
							item.templateId !== COLLECTION_ROUTE_TYPE &&
							!entries.some((entry) => entry.templateId === item.templateId),
					),
				actions: (previous, context) =>
					context.schemaType === COLLECTION_ROUTE_TYPE
						? draftActions(previous)
						: previous,
			},
		}
	})

/**
 * Place these items under the app's chosen settings list. The explicit document
 * ID and initial template bind new drafts to their collection. Collections with
 * settingsDocumentId have an entry, regardless of which settings are locked.
 */
export function collectionRoutingSettingsItems(
	S: StructureBuilder,
	routes: CollectionRoutingConfig,
) {
	return registration(routes).entries.map((entry) =>
		S.listItem()
			.id(entry.documentId)
			.title(`${entry.title} collection settings`)
			.icon(CogIcon)
			.child(
				S.document()
					.id(entry.documentId)
					.documentId(entry.documentId)
					.schemaType(COLLECTION_ROUTE_TYPE)
					.title(`${entry.title} collection settings`)
					.initialValueTemplate(entry.templateId),
			),
	)
}

/**
 * Finalize actions after built-in tools and application reducers. A plugin-only
 * reducer runs too early: a later Structure plugin can restore native Publish.
 * Retain harmless draft discard, and leave all other document types untouched.
 */
export function withCollectionRoutingSettings(
	config: SingleWorkspace,
	options: CollectionRoutingSettingsOptions,
): SingleWorkspace {
	const plugin = collectionRoutingSettings(options)
	const previous = config.document?.actions
	return {
		...config,
		plugins: [...(config.plugins ?? []), plugin],
		document: {
			...config.document,
			actions: (actions, context) => {
				const customized =
					typeof previous === 'function'
						? previous(actions, context)
						: Array.isArray(previous)
							? [...actions, ...previous]
							: actions
				return context.schemaType === COLLECTION_ROUTE_TYPE
					? draftActions(customized)
					: customized
			},
		},
	}
}
