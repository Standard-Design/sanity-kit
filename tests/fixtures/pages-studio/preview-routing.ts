/** The fixture website resolves settings in the same perspective as its content. */
import {
	createCollectionRoutingLoader,
	type CollectionSettingsClient,
} from '../../../src/url/settings/load.js'
import { proofLiveCollectionRouting } from './collection-routes.js'

export async function loadFixtureArticlePrefix(
	client: CollectionSettingsClient,
	perspective: unknown,
) {
	const stack = Array.isArray(perspective) ? perspective : [perspective]
	const mode =
		stack.length === 1 && stack[0] === 'published'
			? 'published'
			: (stack.length === 1 && stack[0] === 'drafts') ||
				  (stack.length === 2 &&
						stack[0] === 'drafts' &&
						stack[1] === 'published')
				? 'drafts'
				: undefined
	if (!mode)
		throw new Error('This fixture supports published and draft routing only.')
	const result = await createCollectionRoutingLoader(
		proofLiveCollectionRouting,
		client,
	).load({
		perspective: mode,
		// The fixture's server credential is deliberately authorized to read all
		// required settings drafts. This is never a browser-supplied assertion.
		...(mode === 'drafts'
			? { draftVisibility: 'all-required-drafts' as const }
			: {}),
	})
	if (!result.ok)
		throw new Error(`Collection settings unavailable: ${result.reason}`)
	const prefix = result.value.routes.collections?.find(
		(collection) => collection.name === 'articles',
	)?.routePrefix
	if (!prefix) throw new Error('Articles routing is missing.')
	return prefix
}
