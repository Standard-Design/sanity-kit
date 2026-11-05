/**
 * Turn the app's explicit creation list into native permission-checked choices.
 * Registration allows a choice to appear; it never grants permission to create.
 *
 * Sanity's exported useTemplatePermissions hook is marked internal. Keep that
 * version-sensitive integration here, alongside its native template item shape.
 * It resolves template values before checking create grants, just like Structure.
 * The component calling this hook needs a local error boundary: upstream grant
 * failures can throw, and must not take down the surrounding Pages navigator.
 */
import { useMemo, type ComponentType } from 'react'
import {
	useSchema,
	useTemplates,
	useTemplatePermissions,
	type InitialValueTemplateItem,
} from 'sanity'
import type { PagesCreateOptions } from './runtime.js'
import type { PagesRegistry } from '../../url/registry.js'
import {
	parseSanityKitCreationContext,
	type SanityKitCreationPayload,
} from '../url/creation-context.js'

export interface PageCreationContext {
	readonly registry: PagesRegistry
	readonly mode: 'page' | 'index'
	readonly pathname: string
}

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Only the kit URL input understands the temporary folder hint. */
function managedUrlField(type: unknown, pathField: string): boolean {
	const parts = pathField.split('.')
	if (parts.pop() !== 'current') return false
	let current = type
	for (const part of parts) {
		if (!record(current) || !Array.isArray(current.fields)) return false
		const field: unknown = current.fields.find(
			(entry: unknown) => record(entry) && entry.name === part,
		)
		if (!record(field)) return false
		current = field.type
	}
	return (
		record(current) &&
		record(current.options) &&
		current.options.__sanityKitUrlField === true
	)
}

const invalidParent = Symbol('invalid URL field parent')

function readPath(value: unknown, path: string): unknown {
	for (const part of path.split('.')) {
		if (value === undefined || value === null) return undefined
		if (!record(value)) return invalidParent
		value = value[part]
	}
	return value
}

export interface PageCreationOption {
	readonly id: string
	readonly schemaType: string
	readonly templateId: string
	readonly title: string
	readonly granted: boolean
	readonly icon?: ComponentType | undefined
	readonly parameters?: Record<string, unknown>
	readonly reason?: string
}

export function usePageCreationOptions(
	choices: readonly PagesCreateOptions[],
	context?: PageCreationContext,
) {
	const schema = useSchema()
	const templates = useTemplates()
	const prepared = useMemo(() => {
		const items: InitialValueTemplateItem[] = []
		const configurationErrors: string[] = []
		for (const [index, choice] of choices.entries()) {
			const template = templates.find((item) => item.id === choice.templateId)
			const type = schema.get(choice.schemaType)
			const registered = context?.registry.types.find(
				(entry) => entry.schemaType === choice.schemaType,
			)
			if (
				context &&
				(!registered ||
					registered.collection !== undefined ||
					registered.pathMode !== 'pathname')
			)
				continue
			const label = `Pages creation choice "${choice.templateId}"`
			if (!template) {
				configurationErrors.push(
					`${label} references a template that is not registered in this Studio.`,
				)
				continue
			}
			if (!type || type.type?.name !== 'document') {
				configurationErrors.push(
					`${label} needs a registered document schema type.`,
				)
				continue
			}
			if (template.schemaType !== choice.schemaType) {
				configurationErrors.push(
					`${label} creates "${template.schemaType}", but its configuration specifies "${choice.schemaType}".`,
				)
				continue
			}
			if (type.liveEdit) {
				configurationErrors.push(
					`${label} uses liveEdit. Pages creation requires a document type that saves drafts.`,
				)
				continue
			}
			if ('singleton' in template && template.singleton !== undefined) {
				configurationErrors.push(
					`${label} belongs to a singleton and cannot create new pages.`,
				)
				continue
			}
			if (template.parameters?.length) {
				configurationErrors.push(
					`${label} requires template parameters, which Pages creation does not support yet.`,
				)
				continue
			}
			if (context && registered && !managedUrlField(type, registered.pathField))
				continue
			const parameters =
				context && registered
					? ({
							sanityKitCreation: {
								version: 1,
								mode: context.mode,
								pathname: context.pathname,
								schemaType: choice.schemaType,
								templateId: choice.templateId,
								pathField: registered.pathField,
							},
						} satisfies SanityKitCreationPayload)
					: undefined
			if (parameters && !parseSanityKitCreationContext(parameters)) {
				configurationErrors.push(
					`${label} needs a valid folder path and a registered URL field.`,
				)
				continue
			}
			items.push({
				type: 'initialValueTemplateItem',
				...(parameters ? { parameters } : {}),
				...((template.icon ?? type.icon)
					? { icon: template.icon ?? type.icon! }
					: {}),
				id: `pages-create-${index}`,
				schemaType: choice.schemaType,
				templateId: choice.templateId,
				title:
					choice.title ?? template.title ?? type.title ?? choice.schemaType,
			})
		}
		return { items, configurationErrors }
	}, [
		choices,
		schema,
		templates,
		context?.registry,
		context?.mode,
		context?.pathname,
	])
	const permissionOptions = useMemo(
		() => ({ templateItems: prepared.items }),
		[prepared.items],
	)
	const [permissions, loading] = useTemplatePermissions(permissionOptions)
	const options = useMemo<PageCreationOption[]>(
		() =>
			prepared.items.map((item) => {
				const permission = !loading
					? permissions?.find(
							(candidate) =>
								candidate.id === item.id &&
								candidate.templateId === item.templateId &&
								candidate.schemaType === item.schemaType &&
								(!context ||
									JSON.stringify(candidate.parameters) ===
										JSON.stringify(item.parameters)),
						)
					: undefined
				let reason: string | undefined
				if (context && permission) {
					const initial = permission.resolvedInitialValue
					const registered = context.registry.types.find(
						(entry) => entry.schemaType === item.schemaType,
					)!
					const stored = readPath(initial, registered.pathField)
					if (
						!record(initial) ||
						Object.keys(initial).length === 0 ||
						(initial._type !== undefined && initial._type !== item.schemaType)
					) {
						reason = 'The template could not be prepared. Try again.'
					} else if (
						stored !== undefined &&
						stored !== null &&
						stored !== '' &&
						!(context.mode === 'index' && stored === context.pathname)
					) {
						reason =
							context.mode === 'index'
								? 'This template already sets a different URL. Create it from the Pages menu instead.'
								: 'This template already sets a URL. Create it from the Pages menu instead.'
					}
				}
				return {
					id: item.id,
					schemaType: item.schemaType,
					templateId: item.templateId,
					title: item.title!,
					icon: item.icon as ComponentType | undefined,
					...(item.parameters ? { parameters: item.parameters } : {}),
					...(reason ? { reason } : {}),
					// Native results can remain visible while a different folder loads.
					// Match the context payload too before enabling a contextual choice.
					granted:
						!loading &&
						!reason &&
						(context !== undefined ||
							prepared.configurationErrors.length === 0) &&
						permission?.granted === true,
				}
			}),
		[
			prepared,
			permissions,
			loading,
			context?.registry,
			context?.mode,
			context?.pathname,
		],
	)
	return { options, loading, configurationErrors: prepared.configurationErrors }
}
