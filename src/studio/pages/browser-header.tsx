/**
 * Shared Pages/collection chrome, measured against Structure's document-list
 * header. Keep public UI primitives here: native PaneHeader needs Structure's
 * pane router and must not be mounted inside Presentation. See docs/pages.md.
 */
import type { ReactNode } from 'react'
import { Box, Flex, Stack, Text, TextInput, useTheme } from '@sanity/ui'
import { SearchIcon } from '@sanity/icons/Search'

export function BrowserHeader({
	title,
	actions,
	backButton,
	searchLabel,
	query,
	onQueryChange,
	children,
}: {
	title: string
	actions?: ReactNode
	backButton?: ReactNode
	searchLabel: string
	query: string
	onQueryChange: (value: string) => void
	children?: ReactNode
}) {
	const theme = useTheme()
	return (
		<Box data-pages-header="" style={{ flexShrink: 0 }}>
			<Flex padding={3} align="center" gap={3}>
				{backButton}
				<Box
					flex={1}
					padding={2}
					paddingLeft={backButton ? 1 : 2}
					style={{ minWidth: 0 }}
				>
					<Text
						size={1}
						weight="semibold"
						textOverflow="ellipsis"
						// Same theme token as Structure's TitleCard; not a fixed gray.
						style={{ color: theme.sanity.color.card.enabled.fg }}
					>
						{title}
					</Text>
				</Box>
				{actions && <Flex gap={1}>{actions}</Flex>}
			</Flex>
			<Box paddingX={3} paddingBottom={3}>
				<Stack gap={3}>
					<TextInput
						aria-label={searchLabel}
						placeholder="Search list"
						icon={SearchIcon}
						fontSize={1}
						padding={2}
						radius={2}
						border={false}
						autoComplete="off"
						spellCheck={false}
						clearButton={Boolean(query)}
						onClear={() => onQueryChange('')}
						value={query}
						onChange={(event) => onQueryChange(event.currentTarget.value)}
					/>
					{children}
				</Stack>
			</Box>
		</Box>
	)
}
