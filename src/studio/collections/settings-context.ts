/**
 * Share only the installed settings registration with Studio navigation. Reading
 * this context does not load a prefix or activate draft settings. Keep context
 * identity separate from hot-reloaded plugin components.
 */
import { createContext, useContext } from 'react'
import {
	useCollectionDisplayNames,
	type CollectionDisplayNames,
} from './display-names.js'
import type { PageCollectionDefinition } from '../../url/registry.js'
import type { CollectionRoutingConfig } from '../../url/settings/resolve.js'
import { COLLECTION_ROUTE_TYPE } from '../../url/settings/resolve.js'

export const CollectionSettingsContext = createContext<
	CollectionRoutingConfig | undefined
>(undefined)
export function useCollectionSettingsRegistration() {
	return useContext(CollectionSettingsContext)
}

/**
 * A shared name alone is not enough: legacy full-path content must not open
 * settings for a different slug-only collection that happens to share its name.
 */
function matchingSettingsCollection(
	collection: PageCollectionDefinition,
	settings: CollectionRoutingConfig | undefined,
) {
	const definition = settings?.collections?.find(
		(item) => item.name === collection.name,
	)
	if (
		!definition ||
		definition.items.length !== collection.items.length ||
		!definition.items.every((item) =>
			collection.items.some(
				(candidate) =>
					candidate.schemaType === item.schemaType &&
					'slugField' in candidate &&
					candidate.slugField === item.slugField,
			),
		)
	)
		return undefined
	return definition
}

export function collectionSettingsTarget(
	collection: PageCollectionDefinition,
	settings: CollectionRoutingConfig | undefined,
) {
	const definition = matchingSettingsCollection(collection, settings)
	if (!definition?.settingsDocumentId) return undefined
	return {
		documentId: definition.settingsDocumentId,
		schemaType: COLLECTION_ROUTE_TYPE,
		templateId: `${COLLECTION_ROUTE_TYPE}-${definition.name}`,
	}
}

/** Only apply a saved name when the settings describe this same collection. */
export function collectionDisplayTitle(
	collection: PageCollectionDefinition,
	settings: CollectionRoutingConfig | undefined,
	names: CollectionDisplayNames,
): string {
	const definition = matchingSettingsCollection(collection, settings)
	if (!definition) return collection.title
	return definition?.displayName?.mode === 'locked'
		? definition.displayName.value
		: (names[collection.name] ??
				definition?.displayName?.value ??
				collection.title)
}
export function useCollectionTitleResolver() {
	const settings = useCollectionSettingsRegistration()
	const names = useCollectionDisplayNames()
	return (collection: PageCollectionDefinition) =>
		collectionDisplayTitle(collection, settings, names)
}
