/**
 * One immutable configuration per plugin instance. It is provided around the
 * native tool, so a hidden navigator does not discard the picker/search state.
 * No module-level cache is shared between workspaces or tools.
 */
import type { PresentationPluginOptions } from 'sanity/presentation'
import type { ComponentType } from 'react'
import { createPagesRegistry, type PagesRouteConfig } from './registry.js'
import { createBrowserModel } from './model.js'

/** One explicitly allowed native template. Studio supplies its default title. */
export interface PagesCreateOptions {
	readonly schemaType: string
	readonly templateId: string
	readonly title?: string
}

/** Studio-only controls; never part of the pure URL registry or loaded settings. */
export interface PagesCollectionUiOptions {
	readonly itemTitle?: string
	readonly create?: PagesCreateOptions | readonly PagesCreateOptions[]
	readonly icon?: ComponentType
}

export interface PagesToolOptions
	extends
		PagesRouteConfig,
		Omit<PresentationPluginOptions, 'components' | 'locate' | 'resolve'> {
	/** Overrides replace generated native resolvers, not browser route metadata. */
	readonly resolve?: PresentationPluginOptions['resolve']
	readonly collectionUi?: Readonly<Record<string, PagesCollectionUiOptions>>
	/**
	 * Eligible creation templates, in display order. A single object remains a
	 * shortcut for one choice. Omit or supply [] to hide Pages creation controls.
	 * Native Studio owns document IDs and template values.
	 */
	readonly create?: PagesCreateOptions | readonly PagesCreateOptions[]
}

/** React memo/forwardRef/lazy wrappers are objects, unlike ordinary components. */
function isIconComponent(value: unknown): boolean {
	if (typeof value === 'function') return true
	if (!value || typeof value !== 'object' || !('$$typeof' in value))
		return false
	return [
		Symbol.for('react.memo'),
		Symbol.for('react.forward_ref'),
		Symbol.for('react.lazy'),
	].some((marker) => value.$$typeof === marker)
}

function creationChoices(
	supplied: PagesCollectionUiOptions['create'],
	allowedTypes: readonly string[],
) {
	const suppliedChoices: unknown[] =
		supplied === undefined
			? []
			: Array.isArray(supplied)
				? supplied
				: [supplied]
	const seen = new Set<string>()
	const choices = suppliedChoices.map(
		(choice): Readonly<PagesCreateOptions> => {
			if (
				!choice ||
				typeof choice !== 'object' ||
				Array.isArray(choice) ||
				!('schemaType' in choice) ||
				!allowedTypes.includes(choice.schemaType as string) ||
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
	return Object.freeze(choices)
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
	const createChoices = creationChoices(
		options.create,
		registry.types.map((type) => type.schemaType),
	)
	if (
		options.collectionUi !== undefined &&
		(!options.collectionUi ||
			typeof options.collectionUi !== 'object' ||
			Array.isArray(options.collectionUi))
	)
		throw new Error('collectionUi must be a collection-name keyed object.')
	const collectionUi = Object.create(null) as Record<
		string,
		Readonly<{
			itemTitle: string
			createChoices: readonly PagesCreateOptions[]
			icon?: ComponentType
		}>
	>
	for (const [collectionName, ui] of Object.entries(
		options.collectionUi ?? {},
	)) {
		const collection = registry.collections.find(
			(item) => item.name === collectionName,
		)
		if (!collection)
			throw new Error(
				`collectionUi references an unregistered collection: ${collectionName}.`,
			)
		if (
			!ui ||
			typeof ui !== 'object' ||
			Array.isArray(ui) ||
			Object.keys(ui).some(
				(key) => !['itemTitle', 'create', 'icon'].includes(key),
			)
		)
			throw new Error(
				'Collection UI only supports itemTitle, create, and icon.',
			)
		if (
			ui.itemTitle !== undefined &&
			(typeof ui.itemTitle !== 'string' || !ui.itemTitle.trim())
		)
			throw new Error('Collection itemTitle must not be empty.')
		if (ui.icon !== undefined && !isIconComponent(ui.icon))
			throw new Error('Collection icon must be a React component.')
		collectionUi[collectionName] = Object.freeze({
			itemTitle: ui.itemTitle ?? 'item',
			createChoices: creationChoices(
				ui.create,
				collection.items.map((item) => item.schemaType),
			),
			...(ui.icon ? { icon: ui.icon } : {}),
		})
	}

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
		createChoices,
		collectionUi: Object.freeze(collectionUi),
		model: createBrowserModel(registry),
	})
}
export type PagesRuntime = ReturnType<typeof createPagesRuntime>
