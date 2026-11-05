/** Plain-language recovery advice shared by folder creation and synchronization. */
export function folderOperationExplanation(
	reason: string,
	operation: 'sync' | 'create' = 'sync',
) {
	if (operation === 'create' && reason === 'outcome-unknown')
		return 'We could not confirm whether the folder was saved. Close this dialog and choose Pages → … → Sync folders to check before trying another change.'
	if (operation === 'create' && reason === 'unknown-read-access')
		return 'Before saving a folder, we need to read all registered pages and their versions, plus the saved folder list. Some access could not be confirmed. Ask someone who manages project permissions to check these requirements:'
	if (operation === 'create' && reason === 'limit-exceeded')
		return 'The folder list or page inventory is larger than this check supports. A developer can review the dataset and arrange a larger folder operation. No partial folder list was saved.'
	if (operation === 'create' && reason === 'collection-group')
		return 'That path belongs to a collection. Choose a different folder name or parent folder.'
	if (reason === 'busy')
		return 'Another folder check or save is still running. Wait for it to finish, then try again.'
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
		return 'The saved folder or page data could not be used safely. Ask a developer or Studio administrator to check the folder registry and registered URL fields before trying again.'
	return 'We could not finish checking or saving the folder list. Check your connection and try again. Your pages and URLs have not been changed.'
}
