/**
 * Navigator folder creation shares the URL field's modal, but never edits its
 * document. Keep the requested session alive when the page picker closes.
 * Folder-menu actions lock their parent; Pages-menu actions let editors choose.
 * Display choices are conveniences; the writer checks fresh inventory and access.
 */
import { useSyncExternalStore } from 'react'
import type { createPagesDataSession } from './data-session.js'
import type { createFolderSyncController } from '../folders/sync-controller.js'
import { NewFolderDialog } from '../url/folder-picker.js'
import { folderOperationExplanation } from './folder-feedback.js'

export interface FolderCreationRequest {
	parent: string
	parentLocked: boolean
	folders: readonly { pathname: string }[]
	session: ReturnType<typeof createPagesDataSession>
}

export function PagesFolderCreateDialog({
	request,
	folderSync,
	onClose,
	onCreated,
}: {
	request: FolderCreationRequest
	folderSync: ReturnType<typeof createFolderSyncController>
	onClose: () => void
	onCreated: (pathname: string) => void
}) {
	const resource = request.session.folders
	const folders = useSyncExternalStore(
		resource.subscribe,
		resource.getSnapshot,
		resource.getSnapshot,
	)
	return (
		<NewFolderDialog
			initialParent={request.parent}
			parentLocked={request.parentLocked}
			folders={[...request.folders, ...folders.data]}
			loading={folders.loading}
			{...((folders.error || folders.disconnected) && {
				error:
					'The folder list could not be loaded. Retry before creating a folder.',
			})}
			onRetry={request.session.refreshFolders}
			onClose={onClose}
			onCreated={onCreated}
			onCreate={async (pathname) => {
				const result = await folderSync.create(pathname)
				if (result.status === 'synced') return { ok: true }
				const requirements = result.accessIssues?.map(
					(issue) =>
						`${issue.label} (${issue.status === 'missing' ? 'not granted' : 'unverified'})`,
				)
				return {
					ok: false,
					message: [
						folderOperationExplanation(result.reason, 'create'),
						...(requirements ?? []),
					].join(' '),
				}
			}}
		/>
	)
}
