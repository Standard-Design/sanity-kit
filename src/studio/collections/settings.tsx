/**
 * Private draft editor for the settings loaded by url/settings. Each collection
 * owns one configured document; collection items continue to store only slugs.
 * This is intentionally not the reviewed prefix-publishing workflow. Ordinary
 * publishing is disabled until that workflow can coordinate URLs and redirects.
 * @see docs/collection-routing.md
 */
import { CogIcon } from '@sanity/icons/Cog'
import { Card, Stack, Text } from '@sanity/ui'
import {
	defineField,
	definePlugin,
	defineType,
	useWorkspace,
	type DocumentActionComponent,
	type LayoutProps,
	type ObjectInputProps,
	type SingleWorkspace,
} from 'sanity'
import type { StructureBuilder } from 'sanity/structure'
import { pagePathname } from '../../url/registry.js'
import { isReservedPath } from '../../url/reservations.js'
import {
	COLLECTION_ROUTE_TYPE,
	MAX_COLLECTION_PREFIX_LENGTH,
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
		typeof collection.routePrefix === 'string'
			? []
			: [
					{
						name: collection.name,
						title: collection.title,
						documentId: collection.routePrefix.documentId,
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
		routes.collections?.some(
			(collection) =>
				typeof collection.routePrefix === 'string' &&
				(value === collection.routePrefix ||
					value.startsWith(`${collection.routePrefix}/`) ||
					collection.routePrefix.startsWith(`${value}/`)),
		)
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
					not available yet. The current published prefix stays in use.
				</Text>
			</Card>
			{props.renderDefault(props)}
		</Stack>
	)
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
			return props.renderDefault(props)
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
						title: `${entry.title} URL settings`,
						schemaType: COLLECTION_ROUTE_TYPE,
						value: { collection: entry.name },
					})),
				],
				types: [
					defineType({
						name: COLLECTION_ROUTE_TYPE,
						title: 'Collection URL settings',
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
								name: 'collection',
								title: 'Collection',
								type: 'string',
								readOnly: true,
								validation: (rule) => rule.required(),
							}),
							defineField({
								name: 'prefix',
								title: 'URL prefix',
								type: 'slug',
								description:
									'The path before each item’s slug, such as /journal. Changing it does not move listing pages or rewrite item slugs.',
								// Sanity's default slug uniqueness is scoped to this field/type,
								// not all resolved page URLs. The reviewed publisher will check
								// the complete routing inventory instead.
								options: { isUnique: () => true },
								validation: (rule) =>
									rule
										.required()
										.custom((value) =>
											validateCollectionPrefix(value?.current, config),
										),
							}),
						],
						preview: {
							select: { collection: 'collection', prefix: 'prefix.current' },
							prepare: ({ collection, prefix }) => ({
								title:
									entries.find((entry) => entry.name === collection)?.title ??
									'Collection URL settings',
								subtitle: typeof prefix === 'string' ? prefix : 'No prefix yet',
							}),
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
 * ID and initial template bind new drafts to their collection. Code-fixed
 * prefixes have no settings entry because the app owns those values.
 */
export function collectionRoutingSettingsItems(
	S: StructureBuilder,
	routes: CollectionRoutingConfig,
) {
	return registration(routes).entries.map((entry) =>
		S.listItem()
			.id(entry.documentId)
			.title(`${entry.title} URL settings`)
			.icon(CogIcon)
			.child(
				S.document()
					.id(entry.documentId)
					.documentId(entry.documentId)
					.schemaType(COLLECTION_ROUTE_TYPE)
					.title(`${entry.title} URL settings`)
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
