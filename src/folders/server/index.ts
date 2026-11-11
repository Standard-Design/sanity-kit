/** Server-side adoption of folders implied by imported URLs. See docs/folder-import.md. */
export { createFolderSynchronizer } from './synchronize.js'
export type {
	FolderSyncClient,
	FolderSyncResult,
	FolderSyncAccessIssue,
} from './synchronize.js'
