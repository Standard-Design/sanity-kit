import { useCollectionTitleResolver } from '../collections/settings-context.js'
/**
 * Collection actions change the native editor, never the tree's folder records.
 * Creation reuses the same template/permission checks as the Pages + button.
 * Settings comes from the installed settings registration, not another prefix.
 */
import { useMemo, useRef, useState } from 'react'
import { Menu, MenuButton, MenuItem } from '@sanity/ui/menu'
import { EllipsisHorizontalIcon } from '@sanity/icons/EllipsisHorizontal'
import { AddIcon } from '@sanity/icons/Add'
import { CogIcon } from '@sanity/icons/Cog'
import { useRouter } from 'sanity/router'
import { usePresentationParams } from 'sanity/presentation'
import {
	collectionSettingsTarget,
	useCollectionSettingsRegistration,
} from '../collections/settings-context.js'
import { useBrowserState } from './browser-context.js'
import { PageCreationMenuAction } from './page-create-dialog.js'
import { TooltipButton } from './tooltip.js'

export function CollectionCreateButton({ name }: { name: string }) {
	const { runtime, showCollectionCreate } = useBrowserState()
	const ui = runtime.collectionUi[name]
	if (!ui?.createChoices.length) return null
	const title = `Create ${ui.itemTitle}`
	return (
		<TooltipButton
			icon={AddIcon}
			mode="bleed"
			fontSize={1}
			padding={2}
			tooltip={title}
			aria-label={title}
			onClick={(event) => showCollectionCreate(event.currentTarget, name)}
		/>
	)
}

export function CollectionActions({ name }: { name: string }) {
	const { runtime, setPickerOpen, showCollectionCreate } = useBrowserState()
	const settings = useCollectionSettingsRegistration()
	const collectionTitle = useCollectionTitleResolver()
	const definition = runtime.registry.collections.find(
		(item) => item.name === name,
	)!
	const target = collectionSettingsTarget(definition, settings)
	const ui = runtime.collectionUi[name]
	const creationRuntime = useMemo(
		() => ({ ...runtime, createChoices: ui?.createChoices ?? [] }),
		[runtime, ui],
	)
	const params = usePresentationParams()
	const router = useRouter()
	const trigger = useRef<HTMLButtonElement>(null)
	const [menuVersion, setMenuVersion] = useState(0)
	if (!ui?.createChoices.length && !target) return null
	return (
		<MenuButton
			key={menuVersion}
			ref={trigger}
			id={`collection-options-${name}`}
			button={
				<TooltipButton
					icon={EllipsisHorizontalIcon}
					aria-label={`Collection options: ${collectionTitle(definition)}`}
					tooltip="Collection options"
					mode="bleed"
					fontSize={1}
					padding={2}
				/>
			}
			popover={{ portal: false }}
			menu={
				<Menu>
					{ui?.createChoices.length ? (
						<PageCreationMenuAction
							runtime={creationRuntime}
							title={`Create ${ui.itemTitle}`}
							disabled={false}
							onSingle={() => {
								if (trigger.current) showCollectionCreate(trigger.current, name)
							}}
							onCreated={() => {
								setMenuVersion((value) => value + 1)
								setPickerOpen(false)
							}}
						/>
					) : null}
					{target && (
						<MenuItem
							text="Settings"
							icon={CogIcon}
							onClick={() => {
								// A native menu button keeps hover, focus, and cursor behavior.
								router.navigate({
									id: target.documentId,
									type: target.schemaType,
									_searchParams: Object.entries({
										...(params.preview ? { preview: params.preview } : {}),
										...(params.viewport ? { viewport: params.viewport } : {}),
										...(params.perspective
											? { perspective: params.perspective }
											: {}),
										template: target.templateId,
									}),
								})
								setMenuVersion((value) => value + 1)
								setPickerOpen(false)
							}}
						/>
					)}
				</Menu>
			}
		/>
	)
}
