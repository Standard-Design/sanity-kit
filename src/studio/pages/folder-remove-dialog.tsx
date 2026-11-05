/**
 * Confirm an empty-folder removal. The visible tree is only a convenience; the
 * shared service checks current raw versions and access before every write.
 * Keep uncertain results open for a read-only reconciliation, never blind retry.
 */
import { useState } from 'react'
import { Button, Card, Dialog, Flex, Spinner, Stack, Text } from '@sanity/ui'
import { CheckmarkCircleIcon } from '@sanity/icons/CheckmarkCircle'
import type { createFolderSyncController } from '../folders/sync-controller.js'
import type { FolderSyncResult } from '../folders/synchronize.js'
import { folderOperationExplanation } from './folder-feedback.js'

export function FolderRemoveDialog({
	pathname,
	folderSync,
	onClose,
}: {
	pathname: string
	folderSync: ReturnType<typeof createFolderSyncController>
	onClose: () => void
}) {
	const [busy, setBusy] = useState(false)
	const [result, setResult] = useState<FolderSyncResult>()
	const done = result?.status === 'synced'
	const blocked = result?.status === 'blocked' ? result : undefined
	const noRetry =
		blocked?.reason === 'folder-not-empty' ||
		blocked?.reason === 'folder-not-found' ||
		blocked?.reason === 'collection-group'
	async function remove() {
		if (busy) return
		setBusy(true)
		try {
			setResult(await folderSync.remove(pathname))
		} finally {
			setBusy(false)
		}
	}
	return (
		<Dialog
			id="pages-folder-remove"
			header="Remove folder"
			width={1}
			{...(!busy ? { onClose, onClickOutside: onClose } : {})}
			footer={
				<Flex justify="flex-end" gap={2} padding={3}>
					<Button
						mode="bleed"
						text={done || noRetry ? 'Close' : 'Cancel'}
						disabled={busy}
						onClick={onClose}
					/>
					{!done && !noRetry && (
						<Button
							tone={
								blocked?.reason === 'outcome-unknown' ? 'default' : 'critical'
							}
							text={
								blocked?.reason === 'outcome-unknown'
									? 'Check again'
									: 'Remove folder'
							}
							disabled={busy}
							onClick={() => {
								void remove()
							}}
						/>
					)}
				</Flex>
			}
		>
			<Stack padding={4} gap={4}>
				{busy ? (
					<Flex justify="center" align="center" gap={3} role="status">
						<Spinner muted />
						<Text size={1}>Checking and removing folder…</Text>
					</Flex>
				) : done ? (
					<Flex justify="center" align="center" gap={3} role="status">
						<Card tone="positive" style={{ background: 'transparent' }}>
							<Text size={3}>
								<CheckmarkCircleIcon aria-hidden />
							</Text>
						</Card>
						<Text size={2} weight="semibold">
							Folder removed
						</Text>
					</Flex>
				) : (
					<>
						<Card border muted padding={3} radius={2}>
							<Text
								size={2}
								weight="semibold"
								style={{ overflowWrap: 'anywhere' }}
							>
								{pathname}
							</Text>
						</Card>
						<Text size={1}>
							Remove this empty folder from Pages? Only the folder is removed.
							Page content and URLs stay unchanged.
						</Text>
						{blocked && (
							<Card
								tone={
									blocked.reason === 'outcome-unknown' ? 'caution' : 'critical'
								}
								padding={3}
								radius={2}
								role="alert"
							>
								<Stack gap={3}>
									<Text size={1} weight="semibold">
										{blocked.reason === 'outcome-unknown'
											? 'Removal could not be confirmed'
											: 'Folder could not be removed'}
									</Text>
									<Text size={1}>
										{folderOperationExplanation(blocked.reason, 'remove')}
									</Text>
									{blocked.accessIssues?.map((issue) => (
										<Text key={issue.key} size={1}>
											{issue.label} (
											{issue.status === 'missing'
												? 'not granted'
												: 'unverified'}
											)
										</Text>
									))}
								</Stack>
							</Card>
						)}
					</>
				)}
			</Stack>
		</Dialog>
	)
}
