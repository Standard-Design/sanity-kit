/**
 * Private opt-in integration shared by Structure and Presentation. Installing
 * it enables normal draft URL editing and replaces only registered types'
 * Publish actions. Scheduling bypasses this review and is omitted for those
 * types until its own integration exists. See docs/url-field.md.
 */
import {
	definePlugin,
	useWorkspace,
	type DocumentActionComponent,
	type LayoutProps,
	type SingleWorkspace,
} from 'sanity'
import {
	createPagesRegistry,
	type PagesRouteConfig,
} from '../../url/registry.js'
import {
	createRedirectSchema,
	REDIRECT_MANUAL_TEMPLATE,
} from '../redirects/schema.js'
import { createUrlPublishAction } from './publication-action.js'
import {
	UrlPublicationProvider,
	urlPublicationConfigKey,
} from './publication-context.js'
import type { UrlPublicationOptions } from './publication.js'

export interface UrlPublicationPluginOptions extends UrlPublicationOptions {
	readonly routes: PagesRouteConfig
	/** Private opt-in editor foundation; live redirect publishing remains blocked. */
	readonly redirectManagement?: 'drafts'
}

export const urlPublication = definePlugin<UrlPublicationPluginOptions>(
	(options) => {
		// Field enablement and lazily created action wrappers must retain the same
		// routing policy if the caller later changes its configuration object.
		const routes = structuredClone(options.routes)
		const editableRedirects = options.redirectManagement === 'drafts'
		const publicationOptions: UrlPublicationOptions = options.reservedPaths
			? { reservedPaths: [...options.reservedPaths] }
			: {}
		const registry = createPagesRegistry(routes)
		const configKey = urlPublicationConfigKey(routes)
		const actions = new WeakMap<
			DocumentActionComponent,
			DocumentActionComponent
		>()
		function Layout(props: LayoutProps) {
			const workspace = useWorkspace()
			// Sanity reduces plugin actions in installation order, starting with an
			// empty list. A later Structure/Presentation plugin can otherwise add an
			// unwrapped Publish action after ours. Check the final resolved actions
			// before rendering any editable Studio UI, not just the earlier reducer.
			for (const type of registry.types) {
				const resolved = workspace.document.actions({
					schemaType: type.schemaType,
					versionType: 'draft',
					releaseId: undefined,
				})
				const publishers = resolved.filter(
					(action) => action.action === 'publish',
				)
				if (
					publishers.length === 0 ||
					publishers.some((action) => actions.get(action) !== action) ||
					resolved.some((action) => action.action === 'schedule')
				)
					throw new Error(
						`URL publication is not installed correctly for "${type.schemaType}". Configure the Studio with withUrlPublication so its final document.actions reducer wraps every Publish action and omits scheduling.`,
					)
			}
			if (
				workspace.document
					.actions({
						schemaType: 'sanityKitRedirect',
						versionType: 'draft',
						releaseId: undefined,
					})
					.some(
						(action) =>
							!editableRedirects || action.action !== 'discardChanges',
					)
			)
				throw new Error(
					'Configure the Studio with withUrlPublication so redirect actions cannot change live rules before their guarded publishing workflow is installed.',
				)
			return (
				<UrlPublicationProvider configKey={configKey}>
					{props.renderDefault(props)}
				</UrlPublicationProvider>
			)
		}
		return {
			name: 'sanity-kit-url-publication',
			studio: { components: { layout: Layout } },
			schema: {
				templates: (previous) => [
					...previous.filter(
						(template) => template.schemaType !== 'sanityKitRedirect',
					),
					...(editableRedirects
						? [
								{
									id: REDIRECT_MANUAL_TEMPLATE,
									title: 'Redirect',
									schemaType: 'sanityKitRedirect',
									value: { status: 301, enabled: true, origin: 'manual' },
								},
							]
						: []),
				],
				types: [
					createRedirectSchema({
						editableDrafts: editableRedirects,
						reservedPaths: [
							...registry.excludePaths,
							...(publicationOptions.reservedPaths ?? []),
						],
						reservedPathPrefixes: registry.reservedPathPrefixes,
					}),
				],
			},
			document: {
				actions: (previous, context) => {
					if (context.schemaType === 'sanityKitRedirect')
						return editableRedirects && context.versionType !== 'version'
							? previous.filter((action) => action.action === 'discardChanges')
							: []
					if (
						!registry.types.some(
							(type) => type.schemaType === context.schemaType,
						)
					)
						return previous
					return previous
						.filter((action) => action.action !== 'schedule')
						.map((action) => {
							if (action.action !== 'publish') return action
							let wrapped = actions.get(action)
							if (!wrapped) {
								wrapped = createUrlPublishAction(
									action,
									routes,
									publicationOptions,
								)
								actions.set(action, wrapped)
								actions.set(wrapped, wrapped)
							}
							return wrapped
						})
				},
			},
		}
	},
)

/**
 * Install at the workspace boundary, where Sanity runs document.actions after
 * both consumer plugins and its own built-in plugins. A plugin alone cannot
 * guarantee this ordering. Existing application reducers run first; arrays keep
 * Sanity's additive semantics. Other workspace configuration stays intact.
 */
export function withUrlPublication(
	config: SingleWorkspace,
	options: UrlPublicationPluginOptions,
): SingleWorkspace {
	const plugin = urlPublication(options)
	const finalize = plugin.document?.actions
	if (typeof finalize !== 'function')
		throw new Error(
			'URL publication requires its final document action reducer.',
		)
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
				return finalize(customized, context)
			},
		},
	}
}
