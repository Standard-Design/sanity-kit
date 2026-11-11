/** Application SDKs can use the public server boundary without Studio types. */
import { createClient } from '@sanity/client'
import {
	createFolderSynchronizer,
	type FolderSyncClient,
	type FolderSyncResult,
	type FolderSyncAccessIssue,
} from '@standard-design/sanity-kit/folders/server'
import type { PagesRouteConfig } from '@standard-design/sanity-kit/url'

const client: FolderSyncClient = createClient({
	projectId: 'testproject',
	dataset: 'test',
	apiVersion: '2026-10-01',
})
const routes: PagesRouteConfig = {
	pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
}
const service = createFolderSynchronizer(routes, client)
const result: Promise<FolderSyncResult> = service.synchronize(
	new AbortController().signal,
)
void result
function details(result: FolderSyncResult) {
	if (result.status === 'synced') {
		const evidence: 'write-confirmed' | 'already-present' = result.evidence
		return `${result.count}: ${evidence}`
	}
	if (result.status === 'blocked') {
		const issues: readonly FolderSyncAccessIssue[] | undefined =
			result.accessIssues
		return (
			issues?.map((issue) => `${issue.label}: ${issue.status}`).join(', ') ??
			result.reason
		)
	}
	return result.reason
}
void details
// @ts-expect-error The import service cannot create an arbitrary empty folder.
void service.create
// @ts-expect-error The import service cannot remove folders.
void service.remove
