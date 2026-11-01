/**
 * Connect one native slug field to the shared route registration and URL input.
 * Storage stays native: only `current` holds the pathname or collection slug.
 * See docs/url.md for the distinction between resolving and authoring a URL.
 */
import {
	defineField,
	type ObjectFieldProps,
	type SlugValue,
	type SlugDefinition,
	type SlugInputProps,
	type SlugOptions,
} from 'sanity'
import { createUrlAuthoring } from '../../url/authoring.js'
import {
	createPagesRegistry,
	type PagesRouteConfig,
} from '../../url/registry.js'
import { createSanityUrlResolver } from '../../url/resolve.js'
import { SanityUrlInput } from './input.js'
import { createUrlIsUnique } from './is-unique.js'
import { UrlValidationField } from './validation.js'

export interface SanityUrlFieldDefinition extends Omit<
	SlugDefinition,
	'type' | 'options'
> {
	readonly routes: PagesRouteConfig
	/** Native generation callbacks; uniqueness belongs to the shared URL space. */
	readonly options?: Pick<SlugOptions, 'source' | 'maxLength' | 'slugify'>
	readonly group?: string | string[]
	readonly fieldset?: string
}

/**
 * Internal until the complete editing workflow is ready for consumers. One
 * factory handles both pathname pages and slug-only collection items. The
 * document's registered type determines storage and its fixed route prefix.
 */
export function defineSanityUrlField(definition: SanityUrlFieldDefinition) {
	const { routes, validation, options, ...native } = definition
	const registry = createPagesRegistry(routes)
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
	})
	// Fail during schema setup for configurations unsafe to author. Other route
	// types may still use string fields; only this input requires a slug object.
	createUrlAuthoring(snapshot)
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(native.name))
		throw new Error('The URL field name must be one native field name.')
	if (options && Object.hasOwn(options, 'isUnique'))
		throw new Error('The URL field supplies its own shared uniqueness check.')
	const resolve = createSanityUrlResolver(snapshot)
	function Input(props: SlugInputProps) {
		return <SanityUrlInput {...props} routes={snapshot} />
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
		options: { ...options, isUnique: createUrlIsUnique(snapshot) },
		components: { ...native.components, input: Input, field: Field },
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
