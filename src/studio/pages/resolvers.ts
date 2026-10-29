/**
 * Translate the shared registry into native Presentation configuration. Location
 * links go from a document to its URL; main-document lookup goes from a URL to a
 * document. The fixture passes both to Presentation in sanity.config.ts.
 *
 * Presentation owns when lookup runs and when the editor changes. A shared footer
 * can be edited while another document's page remains visible in the iframe.
 * See docs/pages.md for these flows and tests/fixtures/pages-studio/ROUTING.md
 * for the internal configuration and override rules.
 */
import type {
	DocumentLocationResolverObject,
	DocumentResolver,
	PresentationPluginOptions,
} from 'sanity/presentation'
import {
	assertFieldPath,
	registeredPathname,
	type PagesRegistry,
} from './registry.js'

type NativeResolvers = NonNullable<PresentationPluginOptions['resolve']>

/** Quoted access also handles field names that happen to be GROQ keywords. */
function fieldExpression(path: string): string {
	assertFieldPath(path, 'Registered field')
	return `@${path
		.split('.')
		.map((part) => `[${JSON.stringify(part)}]`)
		.join('')}`
}

/**
 * Build the field selection used by the fixture's model.ts query. Each type's
 * configured fields become the same title/pathname properties in browser records.
 * This returns query text, not fetched data; document bodies are not selected.
 */
export function pageProjection(registry: PagesRegistry): string {
	const select = (field: 'pathnameField' | 'titleField') =>
		`select(${registry.types.map((type) => `_type == ${JSON.stringify(type.schemaType)} => ${fieldExpression(type[field])}`).join(', ')})`
	return `_id, _type, "title": ${select('titleField')}, "pathname": ${select('pathnameField')}`
}

/**
 * Tell Sanity where each document can be previewed. An unusable path produces a
 * caution message instead of a link; it does not prevent editing the document.
 */
export function pageLocationResolvers(
	registry: PagesRegistry,
): Record<string, DocumentLocationResolverObject<'title' | 'pathname'>> {
	return Object.fromEntries(
		registry.types.map((type) => [
			type.schemaType,
			{
				select: { title: type.titleField, pathname: type.pathnameField },
				resolve: (document: Record<'title' | 'pathname', unknown> | null) => {
					const href = registeredPathname(
						registry,
						type.schemaType,
						document?.pathname,
					)
					return href
						? {
								locations: [
									{
										title:
											typeof document?.title === 'string' &&
											document.title.trim()
												? document.title
												: 'Untitled',
										href,
									},
								],
							}
						: {
								locations: [],
								message:
									'This document has no previewable page URL. Check its path and the app’s route configuration.',
								tone: 'caution' as const,
							}
				},
			},
		]),
	)
}

/**
 * One catch-all lookup covers the explicitly registered types. A path exclusion
 * stops the lookup before it reaches Content Lake. A bounded uniqueness check
 * avoids opening an arbitrary document when two documents claim the same URL.
 * Sanity applies its selected perspective to this query, including the subquery.
 * The /* pattern is only a Presentation lookup rule: it does not install or
 * require a splat route in the website. Duplicate checks here avoid ambiguous
 * lookup; they do not stop an editor from saving a duplicate pathname.
 */
export function pageMainDocuments(registry: PagesRegistry): DocumentResolver[] {
	return [
		{
			route: '/*',
			resolve: ({ path }) => {
				const types = registry.types.filter(
					(type) =>
						registeredPathname(registry, type.schemaType, path) !== undefined,
				)
				if (!types.length) return undefined
				const params: Record<string, string> = { path }
				const predicate = types
					.map((type, index) => {
						params[`type${index}`] = type.schemaType
						return `(_type == $type${index} && ${fieldExpression(type.pathnameField)} == $path)`
					})
					.join(' || ')
				return {
					filter: `(${predicate}) && count(*[${predicate}][0...2]) == 1`,
					params,
				}
			},
		},
	]
}

/**
 * Explicit overrides win. A locations map replaces named entries; a callback
 * replaces all generated locations. mainDocuments replaces the complete list,
 * including an empty list to disable automatic URL-to-document resolution.
 * Overrides own their routing policy; they are not secretly amended by the kit.
 */
export function createPageResolvers(
	registry: PagesRegistry,
	overrides: NativeResolvers = {},
): NativeResolvers {
	return {
		mainDocuments: overrides.mainDocuments ?? pageMainDocuments(registry),
		locations:
			typeof overrides.locations === 'function'
				? overrides.locations
				: { ...pageLocationResolvers(registry), ...overrides.locations },
	}
}
