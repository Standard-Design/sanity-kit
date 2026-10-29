/**
 * One immutable configuration per plugin instance. It is provided around the
 * native tool, so a hidden navigator does not discard the picker/search state.
 * No module-level cache is shared between workspaces or tools.
 */
import type { PresentationPluginOptions } from 'sanity/presentation'
import { createPagesRegistry, type PagesRouteConfig } from './registry.js'
import { createBrowserModel } from './model.js'

/** One explicit native creation shortcut; a full template chooser comes later. */
export interface PagesCreateOptions {
	readonly schemaType: string
	readonly templateId: string
}

export interface PagesToolOptions
	extends
		PagesRouteConfig,
		Omit<PresentationPluginOptions, 'components' | 'locate' | 'resolve'> {
	/** Overrides replace generated native resolvers, not browser route metadata. */
	readonly resolve?: PresentationPluginOptions['resolve']
	/** Omit to use Studio's global creation menu only. Never supplies a document ID. */
	readonly create?: PagesCreateOptions
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
	const create = options.create
	if (
		create &&
		(!registry.types.some((type) => type.schemaType === create.schemaType) ||
			typeof create.templateId !== 'string' ||
			!create.templateId.trim())
	)
		throw new Error(
			'Pages create shortcut needs a registered schemaType and templateId.',
		)
	return Object.freeze({
		name,
		title,
		registry,
		create: create ? Object.freeze({ ...create }) : undefined,
		model: createBrowserModel(registry),
	})
}
export type PagesRuntime = ReturnType<typeof createPagesRuntime>
