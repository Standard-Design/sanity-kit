/**
 * Install one native Presentation tool with Pages navigation around it.
 * This file alone owns the unstable component slots; callers cannot replace
 * those slots and accidentally detach the browser from its shared state.
 */
import { definePlugin } from 'sanity'
import { presentationTool } from 'sanity/presentation'
import type { ComponentProps } from 'react'
import { BrowserStateProvider } from './browser-state.js'
import { PagesBrowser } from './browser.js'
import { PagesHeader } from './header.js'
import { createPagesRuntime, type PagesToolOptions } from './runtime.js'
import { validatePagesSchema } from './registry.js'
import { createPageResolvers } from './resolvers.js'
import {
	CollectionPagesTool,
	CollectionPagesBrowser,
	CollectionPagesHeader,
} from './routing-tool.js'
import { CollectionRoutingProvider } from '../collections/use-routing.js'
import { createCollectionLocationBridge } from '../collections/location-resolver.js'
import { createCollectionRouting } from '../../url/settings/resolve.js'

export const pagesTool = definePlugin<PagesToolOptions>((supplied) => {
	const options = supplied.collectionRouting
		? {
				...supplied,
				collectionRouting: structuredClone(supplied.collectionRouting),
			}
		: supplied
	const runtime = createPagesRuntime(options)
	if (options.collectionRouting) {
		createCollectionRouting(options.collectionRouting)
		// The fixed routes register schema/creation metadata only. Requiring the
		// same types prevents a settings snapshot from silently adding editable types.
		const types = (config: typeof options.collectionRouting) =>
			[
				...config.pages.map((page) => [
					page.schemaType,
					page.pathnameField,
					page.titleField ?? 'title',
				]),
				...(config.collections ?? []).flatMap((collection) =>
					collection.items.map((item) => [
						item.schemaType,
						'slugField' in item ? item.slugField : item.pathnameField,
						item.titleField ?? 'title',
					]),
				),
			].sort((a, b) => a[0]!.localeCompare(b[0]!))
		if (
			JSON.stringify(types(options)) !==
			JSON.stringify(types(options.collectionRouting))
		)
			throw new Error(
				'Pages collectionRouting must register the same document types and fields as its routes.',
			)
	}
	const {
		pages,
		collections,
		excludePaths,
		reservedPathPrefixes,
		create,
		collectionUi,
		collectionRouting,
		resolve,
		...native
	} = options
	// Route metadata stays in the provider, not in Presentation's options.
	void pages
	void collections
	void excludePaths
	void reservedPathPrefixes
	void collectionUi
	void create
	void collectionRouting
	const locationBridge = collectionRouting
		? createCollectionLocationBridge(collectionRouting, resolve?.locations)
		: undefined
	const nativePlugin = presentationTool({
		...native,
		name: runtime.name,
		title: runtime.title,
		resolve: collectionRouting
			? {
					mainDocuments: [],
					locations: locationBridge!.locations,
				}
			: createPageResolvers(runtime.registry, resolve),
		components: {
			unstable_navigator: {
				component: collectionRouting ? CollectionPagesBrowser : PagesBrowser,
				minWidth: 240,
				maxWidth: 440,
			},
			unstable_header: {
				component: collectionRouting ? CollectionPagesHeader : PagesHeader,
			},
		},
	})
	const nativeInput = nativePlugin.form?.components?.input
	const installedNative =
		locationBridge && nativeInput
			? {
					...nativePlugin,
					form: {
						...nativePlugin.form,
						components: {
							...nativePlugin.form?.components,
							input: locationBridge.wrap(nativeInput),
						},
					},
				}
			: nativePlugin
	return {
		name: 'sanity-kit-pages',
		plugins: [installedNative],
		tools: (tools, context) => {
			validatePagesSchema(runtime.registry, context.schema)
			if (tools.filter((tool) => tool.name === runtime.name).length !== 1)
				throw new Error(
					`Pages tool name "${runtime.name}" must identify exactly one tool. Do not also register presentationTool with that name.`,
				)
			return tools.map((tool) => {
				if (tool.name !== runtime.name) return tool
				const NativeTool = tool.component
				function ToolWithBrowserState(
					props: ComponentProps<typeof NativeTool>,
				) {
					if (collectionRouting)
						return (
							<CollectionRoutingProvider configuration={collectionRouting}>
								<CollectionPagesTool
									{...props}
									NativeTool={NativeTool}
									options={options}
									registration={runtime}
								/>
							</CollectionRoutingProvider>
						)
					return (
						<BrowserStateProvider
							runtime={runtime}
							key={`${context.projectId}:${context.dataset}:${runtime.name}`}
						>
							<NativeTool {...props} />
						</BrowserStateProvider>
					)
				}
				return { ...tool, component: ToolWithBrowserState }
			})
		},
	}
})
