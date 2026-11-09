/**
 * Keep the native editor mounted while settings change. Only route-dependent
 * controls and resolvers wait for fresh settings; editing settings remains
 * available when their current values cannot describe a usable route.
 */
import { Box, Button, Card, Spinner, Stack, Text } from '@sanity/ui'
import {
	createContext,
	useContext,
	useMemo,
	type ComponentType,
	type ComponentProps,
} from 'react'
import { usePerspective, useSchema, type Tool } from 'sanity'
import { useRouter } from 'sanity/router'
import {
	usePresentationParams,
	type PreviewHeaderProps,
} from 'sanity/presentation'
import {
	COLLECTION_ROUTE_TYPE,
	type CollectionRoutingConfig,
} from '../../url/settings/resolve.js'
import { useCollectionRouting } from '../collections/use-routing.js'
import { CollectionSettingsContext } from '../collections/settings-context.js'
import { BrowserStateProvider } from './browser-state.js'
import { PagesBrowser } from './browser.js'
import { PagesHeader } from './header.js'
import {
	resolveCollectionPagesRuntime,
	type PagesRuntime,
	type PagesToolOptions,
} from './runtime.js'
import { validatePagesSchema } from './registry.js'

type ToolProps = ComponentProps<Tool['component']>

type RoutingState = NonNullable<ReturnType<typeof useCollectionRouting>>
const RoutingViewContext = createContext<RoutingState | undefined>(undefined)

function RoutingNotice() {
	const state = useContext(RoutingViewContext)!
	const params = usePresentationParams()
	const router = useRouter()
	return (
		<Box padding={3}>
			<Stack gap={3}>
				<Card
					padding={3}
					radius={2}
					tone={state.snapshot.status === 'loading' ? 'default' : 'caution'}
				>
					<Stack gap={3}>
						{state.snapshot.status === 'loading' && <Spinner />}
						<Text size={1} weight="semibold">
							{state.snapshot.status === 'loading'
								? 'Loading collection URLs…'
								: 'Collection URLs are unavailable'}
						</Text>
						{state.snapshot.status !== 'loading' && (
							<>
								<Text size={1}>
									Pages needs current collection settings before it can show
									page URLs. Check the settings below, then retry.
								</Text>
								<Button text="Retry" mode="ghost" onClick={state.retry} />
							</>
						)}
					</Stack>
				</Card>
				{state.settingsDocuments.map((target) => (
					<Button
						key={target.documentId}
						text={`${target.title} settings`}
						mode="ghost"
						onClick={() =>
							router.navigate({
								id: target.documentId,
								type: COLLECTION_ROUTE_TYPE,
								_searchParams: Object.entries({
									...(params.preview ? { preview: params.preview } : {}),
									template: `${COLLECTION_ROUTE_TYPE}-${target.collection}`,
								}),
							})
						}
					/>
				))}
			</Stack>
		</Box>
	)
}

/** Slots read the same snapshot that supplies native main-document resolvers. */
export function CollectionPagesBrowser() {
	const state = useContext(RoutingViewContext)!
	return state.snapshot.status === 'ready' ? (
		<PagesBrowser />
	) : (
		<RoutingNotice />
	)
}
export function CollectionPagesHeader(props: PreviewHeaderProps) {
	const state = useContext(RoutingViewContext)!
	return state.snapshot.status === 'ready' ? (
		<PagesHeader {...props} />
	) : (
		props.renderDefault(props)
	)
}

export function CollectionPagesTool({
	NativeTool,
	options,
	registration,
	...props
}: ToolProps & {
	NativeTool: ComponentType<ToolProps>
	options: PagesToolOptions
	registration: PagesRuntime
}) {
	const configuration = options.collectionRouting as CollectionRoutingConfig
	const perspective = usePerspective()
	const router = useRouter()
	const schema = useSchema()
	const search = Object.fromEntries(router.state._searchParams ?? [])
	const stack = search.scheduledDraft
		? ['unsupported-scheduled-draft']
		: perspective.perspectiveStack
	const variant = perspective.selectedVariantNames?.length
		? 'unsupported-variant'
		: undefined
	const routing = useCollectionRouting(configuration, stack, variant)
	const view = useMemo(
		() => resolveCollectionPagesRuntime(routing.snapshot, options),
		[routing.snapshot, options],
	)
	const ready = view.status === 'ready'
	const runtime = ready ? view.runtime : registration
	if (ready) validatePagesSchema(runtime.registry, schema)
	const resolve = useMemo(
		() =>
			ready
				? view.resolve
				: {
						mainDocuments: [],
						locations: Object.fromEntries(
							registration.registry.types.map((type) => [
								type.schemaType,
								{
									select: {},
									resolve: () => ({
										locations: [],
										tone: 'caution' as const,
										message:
											'Collection URLs are unavailable. Check collection settings before previewing this page.',
									}),
								},
							]),
						),
					},
		[ready, view, registration],
	)
	const tool = useMemo(
		() => ({
			...props.tool,
			options: { ...(props.tool.options as object), resolve },
		}),
		[props.tool, resolve],
	)
	return (
		<CollectionSettingsContext.Provider value={configuration}>
			<RoutingViewContext.Provider value={routing}>
				<BrowserStateProvider
					runtime={runtime}
					routingReady={ready}
					collectionRouting={configuration}
				>
					<NativeTool {...props} tool={tool} />
				</BrowserStateProvider>
			</RoutingViewContext.Provider>
		</CollectionSettingsContext.Provider>
	)
}
