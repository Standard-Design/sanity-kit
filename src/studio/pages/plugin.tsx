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

export const pagesTool = definePlugin<PagesToolOptions>((options) => {
	const runtime = createPagesRuntime(options)
	const { pages, collections, excludePaths, create, resolve, ...native } =
		options
	// Route metadata stays in the provider, not in Presentation's options.
	void pages
	void collections
	void excludePaths
	void create
	return {
		name: 'sanity-kit-pages',
		plugins: [
			presentationTool({
				...native,
				name: runtime.name,
				title: runtime.title,
				resolve: createPageResolvers(runtime.registry, resolve),
				components: {
					unstable_navigator: {
						component: PagesBrowser,
						minWidth: 240,
						maxWidth: 440,
					},
					unstable_header: { component: PagesHeader },
				},
			}),
		],
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
