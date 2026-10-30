import { Button, Card, Stack, Text } from '@sanity/ui'

/** Stale results remain visible, but cannot be selected until loading recovers. */
export function DataWarning({ retry }: { retry: () => void }) {
	return (
		<Card padding={3} tone="critical">
			<Stack gap={3}>
				<Text size={1} role="alert">
					Pages may be out of date. Check connection and dataset access.
				</Text>
				<Button text="Retry loading pages" onClick={retry} />
			</Stack>
		</Card>
	)
}
