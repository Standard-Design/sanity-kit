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

function explanation(reason: string) {
	if (reason === 'configuration')
		return 'This Pages configuration can be browsed, but is not ready to save folders. Ask a developer to check that collection paths are canonical and that the Studio uses a concrete project and dataset.'
	if (reason === 'outcome-unknown')
		return 'We could not confirm whether the last folder save finished. Check again before trying another change. If this continues, ask a developer or Studio administrator to verify the saved folder records.'
	if (reason === 'unknown-read-access')
		return 'To find every folder, we need to read all registered pages and their versions, plus the saved folder list. Some of that access could not be confirmed. Ask someone who manages project permissions to check the requirements below.'
	if (reason === 'permission-denied')
		return 'Your account could not save the folder list. Ask someone who manages project permissions to check your access to folder records.'
	if (reason === 'limit-exceeded')
		return 'The folder list or page inventory is larger than this sync supports. A developer can review the dataset and arrange a larger synchronization. No partial folder list was saved.'
	if (reason === 'conflict')
		return 'The folder list changed while we were checking it. Try again to use the latest saved list.'
	if (
		[
			'invalid-response',
			'invalid-registry',
			'invalid-inventory',
			'invalid-folder',
			'collection-group',
			'invalid-key',
		].includes(reason)
	)
		return 'The saved folder or page data could not be used safely. Ask a developer or Studio administrator to check the folder registry and registered URL fields before syncing again.'
	return 'We could not finish checking or saving the folder list. Check your connection and try again. Your pages and URLs have not been changed by this sync.'
}

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
							<Text size={1}>{explanation(result.reason)}</Text>
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
