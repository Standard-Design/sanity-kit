/**
 * Saved folders are display metadata, independent of the selected page perspective.
 * This read never adopts paths or supplies evidence for a write. See docs/folders.md.
 */
import { defineQuery } from 'groq'
import {
	createFolderPlanner,
	FOLDER_LIMITS,
	type FolderRecord,
} from '../folders/planner.js'
import type { PagesRegistry } from './registry.js'

export const FOLDER_REGISTRY_ID = 'sanityKit.folders'

// Preserve malformed values for validation. An extra array item detects overflow;
// the result must never look like a valid, silently truncated folder registry.
export const folderRegistryQuery = defineQuery(`
	*[_id == $registryId][0] {
		_id, _type, _rev, _originalId, schemaVersion,
		"folders": select(count(folders) > ${FOLDER_LIMITS.folders} => folders[0...${FOLDER_LIMITS.folders + 1}], folders)
	}
`)

export function readNavigationFolders(
	registry: PagesRegistry,
	input: unknown,
): readonly FolderRecord[] {
	// A null display read means no visible metadata. It cannot establish whether
	// the document is absent or hidden by permissions, and never authorizes create.
	if (input === null) return []
	if (
		input !== null &&
		typeof input === 'object' &&
		'_originalId' in input &&
		input._originalId != null &&
		(!('_id' in input) || input._originalId !== input._id)
	)
		throw new Error(
			'Saved folder metadata must be read without version merging.',
		)
	// Reconstruct the planner's route input from the already copied registry.
	// Do this only for an actual saved record: older navigation configurations
	// may permit paths that persistent folders cannot safely represent.
	const planner = createFolderPlanner({
		routes: {
			pages: registry.types
				.filter((type) => !type.collection)
				.map((type) => ({
					schemaType: type.schemaType,
					pathnameField: type.pathField,
					titleField: type.titleField,
				})),
			collections: registry.collections,
			excludePaths: registry.excludePaths,
		},
	})
	const checked = planner.validateRegistry(input)
	if (!checked.ok)
		throw new Error(`Saved folder metadata is unavailable: ${checked.reason}.`)
	return checked.value.document.folders
}
