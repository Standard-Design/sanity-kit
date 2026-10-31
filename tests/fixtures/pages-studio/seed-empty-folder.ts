/**
 * Explicit UI fixture setup, never run by Studio startup or automated tests.
 * Defaults to a read-only check. --apply adds one empty organizational folder
 * through the same guarded writer intended for the forthcoming editor controls.
 */
import { getCliClient } from 'sanity/cli'
import { createFolderLoader } from '../../../src/studio/folders/load.js'
import { createFolderWriter } from '../../../src/studio/folders/write.js'
import { createSanityUrlResolver } from '../../../src/url/resolve.js'
import { proofRoutes } from './routes.js'

const pathname = '/empty-folder-test'

async function main() {
	const client = getCliClient({ apiVersion: '2026-10-01' }).withConfig({
		useCdn: false,
	})
	const { projectId, dataset } = client.config()
	if (projectId !== 'ha9kep4l' || dataset !== 'development')
		throw new Error(
			'This fixture is restricted to the Standard Stack test dataset.',
		)
	// Read the same effective dataset grants that Studio uses. A project may
	// grant access through an organization rather than direct membership.
	const grants = await client.request<
		Array<{ filter: string; permissions: string[] }>
	>({
		url: `/projects/${projectId}/datasets/${dataset}/acl`,
	})
	if (
		!grants.some(
			(grant) =>
				(grant.filter === 'true' || grant.filter === '_id in path("**")') &&
				grant.permissions.includes('read'),
		)
	)
		throw new Error('Fixture setup requires unrestricted document read access.')
	const readAccess = 'all-registered-versions' as const
	const loaded = await createFolderLoader(
		{ routes: proofRoutes },
		client,
	)({ readAccess })
	if (loaded.status !== 'loaded')
		throw new Error(`Folder read refused: ${loaded.reason}`)
	const resolve = createSanityUrlResolver(proofRoutes)
	for (const document of loaded.snapshot.inventory.documents) {
		const result = resolve(document)
		if (
			result.ok &&
			(result.value.pathname === pathname ||
				result.value.pathname.startsWith(`${pathname}/`))
		)
			throw new Error(
				'The test folder path already contains a page. No changes made.',
			)
	}
	console.log(
		`Verified test target ${projectId}/${dataset}; empty path ${pathname}.`,
	)
	if (!process.argv.includes('--apply')) {
		console.log(
			'Read-only check complete. Pass --apply to add the empty folder.',
		)
		return
	}
	const result = await createFolderWriter(
		{ routes: proofRoutes },
		client,
	).create({ pathname, readAccess })
	console.log(JSON.stringify(result))
	if (result.status !== 'written' && result.status !== 'unchanged')
		process.exitCode = 1
}

void main().catch((error: unknown) => {
	// Avoid logging SDK error objects, which may contain authenticated requests.
	const known =
		error instanceof Error &&
		/^(This fixture|Fixture setup|Folder read refused|The test folder)/u.test(
			error.message,
		)
	console.error(
		known
			? error.message
			: 'Fixture setup failed; no credentials or request details logged.',
	)
	process.exitCode = 1
})
