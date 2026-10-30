/**
 * Public Sanity UI primitives, with the same presentation defaults as Studio's
 * tooltip wrapper. Keep these details here rather than importing private Studio
 * components or giving each Pages control a different hover style.
 */
import { Box, Button, Text, type ButtonProps } from '@sanity/ui'
import { Tooltip } from '@sanity/ui/tooltip'
import type { ReactElement } from 'react'

export function PagesTooltip({
	children,
	content,
	disabled = false,
}: {
	children: ReactElement
	content: string
	disabled?: boolean
}) {
	return (
		<Tooltip
			animate
			arrow={false}
			boundaryElement={null}
			delay={{ open: 400 }}
			fallbackPlacements={[
				'bottom-start',
				'bottom-end',
				'top-start',
				'top-end',
			]}
			placement="bottom"
			portal
			padding={1}
			disabled={disabled}
			content={
				<Box padding={1}>
					<Text size={1}>{content}</Text>
				</Box>
			}
		>
			{children}
		</Tooltip>
	)
}

/** Keep the actual button's ref and event props for MenuButton/Popover anchors. */
export function TooltipButton({
	tooltip,
	...props
}: ButtonProps & { tooltip: string }) {
	return (
		<PagesTooltip content={tooltip} disabled={props['aria-expanded'] === true}>
			<span style={{ display: 'inline-flex' }}>
				<Button {...props} />
			</span>
		</PagesTooltip>
	)
}
