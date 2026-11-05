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

export interface PageCreationOption {
	readonly id: string
	readonly schemaType: string
	readonly templateId: string
	readonly title: string
	readonly granted: boolean
	readonly icon?: ComponentType | undefined
}

export function usePageCreationOptions(choices: readonly PagesCreateOptions[]) {
	const schema = useSchema()
	const templates = useTemplates()
	const prepared = useMemo(() => {
		const items: InitialValueTemplateItem[] = []
		const configurationErrors: string[] = []
		for (const [index, choice] of choices.entries()) {
			const template = templates.find((item) => item.id === choice.templateId)
			const type = schema.get(choice.schemaType)
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
			items.push({
				type: 'initialValueTemplateItem',
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
	}, [choices, schema, templates])
	const permissionOptions = useMemo(
		() => ({ templateItems: prepared.items }),
		[prepared.items],
	)
	const [permissions, loading] = useTemplatePermissions(permissionOptions)
	const options = useMemo<PageCreationOption[]>(
		() =>
			prepared.items.map((item) => ({
				id: item.id,
				schemaType: item.schemaType,
				templateId: item.templateId,
				title: item.title!,
				icon: item.icon as ComponentType | undefined,
				// The native hook can keep its previous result while new choices load.
				// Never let those stale grants enable a new or changed choice.
				granted:
					!loading &&
					prepared.configurationErrors.length === 0 &&
					permissions?.some(
						(permission) =>
							permission.id === item.id &&
							permission.templateId === item.templateId &&
							permission.schemaType === item.schemaType &&
							permission.granted === true,
					) === true,
			})),
		[prepared, permissions, loading],
	)
	return { options, loading, configurationErrors: prepared.configurationErrors }
}
