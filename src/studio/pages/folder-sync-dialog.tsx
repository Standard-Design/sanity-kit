/** Manual recovery feedback; ordinary background success stays silent. */
import {
	Box,
	Button,
	Card,
	Dialog,
	Flex,
	Spinner,
	Stack,
	Text,
} from '@sanity/ui'
import { CheckmarkCircleIcon } from '@sanity/icons/CheckmarkCircle'
import { useEffect, useState } from 'react'
import type { FolderSyncResult } from '../folders/synchronize.js'
import type { createFolderSyncController } from '../folders/sync-controller.js'
import { folderOperationExplanation } from './folder-feedback.js'

export function FolderSyncDialog({
	folderSync,
	onClose,
}: {
	folderSync: ReturnType<typeof createFolderSyncController>
	onClose: () => void
}) {
	const [result, setResult] = useState<FolderSyncResult | null>(null)
	const [attempt, setAttempt] = useState(0)
	useEffect(() => {
		let mounted = true
		void folderSync.manual().then((value) => {
			if (mounted) setResult(value)
		})
		// Closing feedback does not cancel a shared operation or forget its result.
		return () => {
			mounted = false
		}
	}, [folderSync, attempt])
	return (
		<Dialog
			id="pages-folder-sync"
			header="Sync folders"
			width={1}
			onClose={onClose}
			onClickOutside={onClose}
			footer={
				<Flex justify="flex-end" gap={2} padding={3}>
					<Button mode="bleed" text="Close" onClick={onClose} />
					{result?.status === 'blocked' && (
						<Button
							text={
								result.reason === 'outcome-unknown' ? 'Check again' : 'Retry'
							}
							onClick={() => {
								setResult(null)
								setAttempt((value) => value + 1)
							}}
						/>
					)}
				</Flex>
			}
		>
			<Stack padding={4} gap={4}>
				{!result ? (
					<Flex align="center" justify="center" gap={3} role="status">
						<Spinner muted />
						<Text size={1}>Checking folders…</Text>
					</Flex>
				) : result.status === 'synced' ? (
					<Box padding={4} role="status">
						<Stack gap={4}>
							<Flex align="center" justify="center" gap={3}>
								<Card tone="positive" style={{ background: 'transparent' }}>
									<Text size={3}>
										<CheckmarkCircleIcon aria-hidden />
									</Text>
								</Card>
								<Text size={2} weight="semibold" align="center">
									{result.count
										? `${result.count} ${result.count === 1 ? 'folder saved' : 'folders saved'}.`
										: 'Folders are up to date.'}
								</Text>
							</Flex>
							<Text size={1} muted>
								Folders are saved and will stay in the navigator even when
								empty. Page content and URLs have not changed.
							</Text>
						</Stack>
					</Box>
				) : (
					<Card tone="caution" padding={3} radius={2} role="alert">
						<Stack gap={3}>
							<Text size={1} weight="semibold">
								Folder sync needs attention
							</Text>
							<Text size={1}>{folderOperationExplanation(result.reason)}</Text>
							{result.accessIssues?.map((issue) => (
								<Text key={issue.key} size={1}>
									{issue.label} (
									{issue.status === 'missing' ? 'not granted' : 'unverified'})
								</Text>
							))}
						</Stack>
					</Card>
				)}
			</Stack>
		</Dialog>
	)
}
