/**
 * Connect one native slug field to the shared route registration and URL input.
 * Storage stays native: only `current` holds the pathname or collection slug.
 * See docs/url.md for the distinction between resolving and authoring a URL.
 */
import {
	defineField,
	usePerspective,
	type ObjectFieldProps,
	type SlugValue,
	type SlugDefinition,
	type SlugInputProps,
	type SlugOptions,
} from 'sanity'
import { Button, Card, Stack, Text } from '@sanity/ui'
import { createUrlAuthoring } from '../../url/authoring.js'
import {
	createPagesRegistry,
	pageSlug,
	type PagesRouteConfig,
} from '../../url/registry.js'
import { createSanityUrlResolver } from '../../url/resolve.js'
import { SanityUrlInput } from './input.js'
import { useUrlCreationContext } from './creation-presentation.js'
import { createUrlIsUnique } from './is-unique.js'
import { UrlValidationField } from './validation.js'
import {
	useUrlPublicationEnabled,
	assertCollectionRouteRegistration,
	urlPublicationConfigKey,
} from './publication-context.js'
import { createCollectionUrlIsUnique } from '../collections/url-conflicts.js'
import { useCollectionRouting } from '../collections/use-routing.js'
import { type CollectionRoutingConfig } from '../../url/settings/resolve.js'

export interface SanityUrlFieldDefinition extends Omit<
	SlugDefinition,
	'type' | 'options'
> {
	readonly routes: PagesRouteConfig
	/** Opt into settings-backed prefixes; routes supply registration only. */
	readonly collectionRouting?: CollectionRoutingConfig
	/** Page pathname controls only; collection prefixes remain locked. */
	readonly inputMode?: 'folders' | 'text'
	/** Native generation callbacks; uniqueness belongs to the shared URL space. */
	readonly options?: Pick<SlugOptions, 'source' | 'maxLength' | 'slugify'>
	readonly group?: string | string[]
	readonly fieldset?: string
}

/**
 * One factory handles both pathname pages and slug-only collection items. The
 * document's registered type determines storage and its fixed route prefix.
 */
export function defineSanityUrlField(definition: SanityUrlFieldDefinition) {
	const {
		routes,
		collectionRouting,
		validation,
		options,
		inputMode = 'folders',
		...native
	} = definition
	if (inputMode !== 'folders' && inputMode !== 'text')
		throw new Error('URL inputMode must be "folders" or "text".')
	const registry = createPagesRegistry(routes)
	const settings = collectionRouting
		? structuredClone(collectionRouting)
		: undefined
	if (settings) assertCollectionRouteRegistration(routes, settings)
	const publicationKey = urlPublicationConfigKey(routes, settings)
	// Take a copy so input, native validation, and uniqueness cannot disagree if
	// an application later mutates its original configuration object.
	const snapshot: PagesRouteConfig = Object.freeze({
		pages: Object.freeze(
			registry.types
				.filter((type) => !type.collection)
				.map((type) =>
					Object.freeze({
						schemaType: type.schemaType,
						pathnameField: type.pathField,
						titleField: type.titleField,
					}),
				),
		),
		collections: registry.collections,
		excludePaths: registry.excludePaths,
		reservedPathPrefixes: registry.reservedPathPrefixes,
	})
	// Fail during schema setup for configurations unsafe to author. Other route
	// types may still use string fields; only this input requires a slug object.
	createUrlAuthoring(snapshot)
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(native.name))
		throw new Error('The URL field name must be one native field name.')
	if (options && Object.hasOwn(options, 'isUnique'))
		throw new Error('The URL field supplies its own shared uniqueness check.')
	const resolve = createSanityUrlResolver(snapshot)
	function SettingsInput(props: SlugInputProps) {
		const perspective = usePerspective()
		// This form edits the draft even when Presentation previews the live site.
		// A published iframe must not change the prefix attached to a draft slug.
		const routing = useCollectionRouting(
			settings!,
			perspective.selectedReleaseId ? perspective.perspectiveStack : ['drafts'],
			perspective.selectedReleaseId || perspective.selectedVariantNames[0],
		)
		const allowPublishedDrafts = useUrlPublicationEnabled(publicationKey)
		const creationContext = useUrlCreationContext(props.path)
		if (routing.snapshot.status !== 'ready')
			return (
				<Card
					padding={3}
					radius={2}
					tone={
						routing.snapshot.status === 'loading' ? 'transparent' : 'caution'
					}
				>
					<Stack gap={3}>
						<Text size={1}>
							{routing.snapshot.status === 'loading'
								? 'Loading collection URLs…'
								: 'Collection URLs could not be loaded. Check the collection settings before editing this URL.'}
						</Text>
						{routing.snapshot.status !== 'loading' && (
							<Button text="Retry" mode="ghost" onClick={routing.retry} />
						)}
					</Stack>
				</Card>
			)
		return (
			<SanityUrlInput
				{...props}
				routes={routing.snapshot.value.routes}
				collectionRouting={settings!}
				inputMode={inputMode}
				allowPublishedDrafts={allowPublishedDrafts}
				{...(creationContext ? { creationContext } : {})}
			/>
		)
	}
	function Input(props: SlugInputProps) {
		const allowPublishedDrafts = useUrlPublicationEnabled(publicationKey)
		const creationContext = useUrlCreationContext(props.path)
		return (
			<SanityUrlInput
				{...props}
				routes={snapshot}
				inputMode={inputMode}
				allowPublishedDrafts={allowPublishedDrafts}
				{...(creationContext ? { creationContext } : {})}
			/>
		)
	}
	function Field(props: ObjectFieldProps<SlugValue>) {
		return (
			<UrlValidationField
				fieldProps={props}
				customField={native.components?.field}
			/>
		)
	}
	return defineField({
		...native,
		type: 'slug',
		options: {
			...options,
			isUnique: settings
				? createCollectionUrlIsUnique(settings)
				: createUrlIsUnique(snapshot),
			// Pages uses this marker to offer folder creation only for fields that
			// consume the intent hint through the guarded URL editing workflow.
			__sanityKitUrlField: true,
		} as SlugOptions & { __sanityKitUrlField: true },
		components: {
			...native.components,
			input: settings ? SettingsInput : Input,
			field: Field,
		},
		validation: (rule, context) => {
			const format = rule.custom((value, nativeContext) => {
				const type = registry.types.find(
					(entry) => entry.schemaType === nativeContext.document?._type,
				)
				const expected = type?.pathField.split('.')
				const actual = [...(nativeContext.path ?? []), 'current']
				if (
					!type ||
					!expected ||
					expected.at(-1) !== 'current' ||
					actual.length !== expected.length ||
					actual.some((part, index) => part !== expected[index])
				)
					return 'Use the URL field at the slug-object path registered for this document type.'
				// Missing URLs are allowed in incomplete drafts unless the app adds
				// rule.required(). Invalid nonempty values are never cleaned on read.
				if (
					value === undefined ||
					value === null ||
					value.current === undefined ||
					value.current === ''
				)
					return true
				// A collection's effective prefix belongs to the fresh uniqueness
				// check below, not the static registration used to locate its field.
				if (settings && type.pathMode === 'slug')
					return pageSlug(value.current)
						? true
						: 'Enter one valid URL segment without slashes.'
				const document: Record<string, unknown> = { _type: type.schemaType }
				let parent = document
				for (const part of expected.slice(0, -1)) {
					const child: Record<string, unknown> = {}
					parent[part] = child
					parent = child
				}
				parent.current = value.current
				const result = resolve(document)
				if (result.ok) return true
				if (result.reason === 'noncanonical-path')
					return 'Remove repeated or trailing slashes from this URL.'
				if (result.reason === 'disallowed-path')
					return 'This URL is outside the paths allowed for this document type.'
				return type.pathMode === 'slug'
					? 'Enter one valid URL segment without slashes.'
					: 'Enter a valid path starting with /, without a query or fragment.'
			})
			const additional = validation?.(rule, context)
			return additional
				? [format, ...(Array.isArray(additional) ? additional : [additional])]
				: format
		},
	})
}
