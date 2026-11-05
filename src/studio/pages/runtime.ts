/**
 * One immutable configuration per plugin instance. It is provided around the
 * native tool, so a hidden navigator does not discard the picker/search state.
 * No module-level cache is shared between workspaces or tools.
 */
import type { PresentationPluginOptions } from 'sanity/presentation'
import { createPagesRegistry, type PagesRouteConfig } from './registry.js'
import { createBrowserModel } from './model.js'

/** One explicitly allowed native template. Studio supplies its default title. */
export interface PagesCreateOptions {
	readonly schemaType: string
	readonly templateId: string
	readonly title?: string
}

export interface PagesToolOptions
	extends
		PagesRouteConfig,
		Omit<PresentationPluginOptions, 'components' | 'locate' | 'resolve'> {
	/** Overrides replace generated native resolvers, not browser route metadata. */
	readonly resolve?: PresentationPluginOptions['resolve']
	/**
	 * Eligible creation templates, in display order. A single object remains a
	 * shortcut for one choice. Omit or supply [] to hide Pages creation controls.
	 * Native Studio owns document IDs and template values.
	 */
	readonly create?: PagesCreateOptions | readonly PagesCreateOptions[]
}

export function createPagesRuntime(options: PagesToolOptions) {
	if (!options || typeof options !== 'object')
		throw new Error('pagesTool requires configuration.')
	if ('components' in options || 'locate' in options)
		throw new Error(
			'pagesTool owns Presentation components; use resolve instead of locate.',
		)
	const name = options.name ?? 'pages'
	if (typeof name !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]*$/u.test(name))
		throw new Error('Pages tool name must be a non-empty URL-safe identifier.')
	const title = options.title ?? 'Pages'
	if (typeof title !== 'string' || !title.trim())
		throw new Error('Pages tool title must not be empty.')
	if (options.previewUrl === undefined || options.previewUrl === null)
		throw new Error(
			'pagesTool requires native Presentation previewUrl configuration.',
		)
	const registry = createPagesRegistry(options)
	const suppliedChoices: unknown[] =
		options.create === undefined
			? []
			: Array.isArray(options.create)
				? options.create
				: [options.create]
	const seen = new Set<string>()
	const createChoices = suppliedChoices.map(
		(choice): Readonly<PagesCreateOptions> => {
			if (
				!choice ||
				typeof choice !== 'object' ||
				Array.isArray(choice) ||
				!('schemaType' in choice) ||
				!registry.types.some((type) => type.schemaType === choice.schemaType) ||
				!('templateId' in choice) ||
				typeof choice.templateId !== 'string' ||
				!choice.templateId.trim()
			)
				throw new Error(
					'Pages create choices need a registered schemaType and templateId.',
				)
			if (
				'title' in choice &&
				(typeof choice.title !== 'string' || !choice.title.trim())
			)
				throw new Error('Pages create choice title must not be empty.')
			if (
				Object.keys(choice).some(
					(key) => !['schemaType', 'templateId', 'title'].includes(key),
				)
			)
				throw new Error(
					'Pages create choices only support schemaType, templateId, and title.',
				)
			const key = JSON.stringify([choice.schemaType, choice.templateId])
			if (seen.has(key))
				throw new Error(
					'Pages create choices must not repeat a schemaType/templateId pair.',
				)
			seen.add(key)
			// Store copies so editing the consumer's configuration cannot change an
			// already installed tool. Compiled template compatibility is checked in
			// Studio, where the workspace's templates and schema are available.
			return Object.freeze({
				schemaType: choice.schemaType as string,
				templateId: choice.templateId,
				...('title' in choice ? { title: choice.title as string } : {}),
			})
		},
	)
	return Object.freeze({
		name,
		title,
		registry,
		routes: Object.freeze({
			pages: registry.types
				.filter((type) => !type.collection)
				.map((type) => ({
					schemaType: type.schemaType,
					pathnameField: type.pathField,
					titleField: type.titleField,
				})),
			collections: registry.collections,
			excludePaths: registry.excludePaths,
			reservedPathPrefixes: registry.reservedPathPrefixes,
		}),
		createChoices: Object.freeze(createChoices),
		model: createBrowserModel(registry),
	})
}
export type PagesRuntime = ReturnType<typeof createPagesRuntime>
