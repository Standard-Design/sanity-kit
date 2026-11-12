# Save folders after an import

Pages normally keeps folders in step with URL editing. An import script writes
directly to Sanity, so it should explicitly save any folders implied by the URLs
it imported. This makes those folders persistent before an editor opens Pages.

The server helper adds missing folder records. It never changes a page URL,
renames or removes a folder, publishes content, or removes empty folders.
Existing folders and their extra metadata remain intact. A consumer does not
need to install or run Sanity Studio to use it.

## Run synchronization explicitly

Import from `@standard-design/sanity-kit/folders/server`, introduced in alpha.6.
It requires the supported Sanity client and `groq` peers, but no Studio or React
installation.

```ts
import { createClient } from '@sanity/client'
import { createFolderSynchronizer } from '@standard-design/sanity-kit/folders/server'

const client = createClient({
	projectId: 'yourprojectid',
	dataset: 'development',
	apiVersion: '2026-10-01',
	useCdn: false,
	token: process.env.SANITY_IMPORT_TOKEN,
})

const folders = createFolderSynchronizer(
	{
		pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
	},
	client,
)

// Run after your import has finished its document writes.
const result = await folders.synchronize()
if (result.status === 'synced') {
	console.log(
		`Folder synchronization finished; ${result.count} additions confirmed.`,
	)
} else {
	// Record the result and stop this job step. Do not hide a failed check.
	console.error(result)
	process.exitCode = 1
}
```

Use your application's complete `PagesRouteConfig`, including registered page
types, collections, and reserved paths. The short example above represents a
site with only one page type. An incomplete registration cannot establish the
folders needed by omitted types. The helper captures its configuration when it
is created; changing the original object does not alter an existing instance.

For settings-backed collection prefixes, load the desired routing context first
and pass its resolved `routes` to this helper. It does not independently load
collection settings or decide which perspective the import intends to use. A
collection's index group is not duplicated as an ordinary saved folder.

The helper reads the dataset itself; it does not accept an imported list marked
“complete” by the caller. The raw inventory includes drafts, published documents,
and release versions. A page at `/about/company/team` implies the folders
`/about` and `/about/company`; its final segment remains the page's own URL.
The site root is not saved as a folder record.

## Access checks and writes

Each call reads the current account's effective read grants. It must be possible
to establish access to the folder registry and all registered document versions.
A query that happens to return no rows does not prove this access. Unsupported
grant expressions remain unverified, and missing or unverified access blocks the
run before its content inventory is read. The token must be able to read its
effective dataset ACL as well as the required documents.

Writes use the caller's client and credentials. Sanity enforces creation or
update permission for the registry document `sanityKit.folders`. The helper does
not implement Studio's native grant hooks or grant permission based on a role
name. An account without write access can still report that all required folders
are already present, because that case sends no mutation.

When folders are missing, the existing planner and writer issue at most one
mutation: a strict registry create, or an append guarded by its observed revision.
No whole-document replacement is used for an existing registry. Shared limits
currently allow 1,000 saved folders, 10,000 registered document versions, and a
512,000-byte registry/request budget. Exceeding a limit blocks the run; the helper
does not silently truncate or partially adopt an inventory.

## Understand the result

| Result                                  | Meaning                                                                                                                                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `synced`, `evidence: 'write-confirmed'` | Sanity acknowledged this call's folder additions. `count` is the number it added.                                                                                                                |
| `synced`, `evidence: 'already-present'` | The fresh snapshot already contained the needed folders. This call wrote nothing and `count` is zero. It does not identify which earlier operation created them.                                 |
| `outcome-unknown`                       | A mutation was attempted, but its response could not be confirmed. It may have succeeded. Nothing is automatically repeated.                                                                     |
| `blocked`                               | The call could not complete, for example because of missing access, unavailable data, an invalid registry, cancellation, a limit, or a revision conflict. Check `reason` and any `accessIssues`. |

An `AbortSignal` may be passed to `synchronize(signal)`. Cancellation before a
write blocks it. Cancellation after dispatch may leave an unknown result; it
cannot undo a committed mutation. Overlapping calls on the same instance return
`blocked` with reason `busy` for the later call. Different jobs are protected by
the server's registry guards, not by a shared in-memory lock.

## Running again after interruption

A later **explicit** call is allowed, including after the import process restarts.
It checks access and rereads the dataset, then plans the missing folders again.
It does not resend the previous mutation or claim to recover its exact outcome.
No saved checkpoint or operation receipt is required for this additive workflow.

If the earlier write succeeded, a current snapshot will show the folders already
present. If two attempts both saw the registry missing, only one strict create
can succeed. If both saw the same existing revision, only one guarded append can
succeed. The other attempt reports a conflict. A stale query result can likewise
produce a conflict; a later explicit run can read again. Avoid an unbounded retry
loop, and investigate persistent conflicts or access failures.

Page URLs may change while a request is delayed. If a later run needs no mutation,
the older append can still succeed and preserve a folder whose page has since
moved. That leaves an empty folder, which is an allowed outcome of persistent
folder organization. It does not move the page back or delete anything. This
helper promises synchronization against its observed inventory, not a permanent
match while other writers keep changing the dataset.

This retry policy is specific to adding inferred folders. It must not be reused
for explicit folder creation/removal, folder renames, or publishing URL changes.
Those workflows may need exact operation identities and different recovery rules.
Pages' existing create/remove service retains its own stricter uncertainty policy.

## Verification and scope

`tests/folders/server-sync.test.ts` exercises the real permission interpretation,
GROQ query, planner, and writer against a controlled transport. It covers delayed
create/append requests racing a restarted job, stale reads after lost responses,
newly imported paths after an interrupted attempt, metadata preservation, missing
and unverified access, and server permission rejection. It also checks the normal
Sanity application-client type and a runtime bundle without Studio or React.

These tests do not establish access for a particular production import token.
Installed-tarball checks verify client 7/8 types, explicit convergence after a
lost acknowledgment, metadata preservation, access failures, cancellation, and
an executable server bundle without Studio or React. Live import acceptance
still needs the intended consumer credentials and configuration. This helper introduces no filesystem storage, cache
backend, scheduler, or background retry process.
