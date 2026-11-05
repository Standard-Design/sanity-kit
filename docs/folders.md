# Folders

Folders help editors organize site pages. A saved folder can remain visible even
when no page uses it yet. A page's URL still determines where it belongs: saving a
folder does not add a parent reference to the page or change its URL.

The implementation supplies **private validation and planning functions** in
`src/studio/folders/planner.ts` and a **private read layer** in
`src/studio/folders/load.ts`. The planner works on supplied records and returns a
proposed change. The read layer can fetch the evidence needed by those plans.
The **private writer** in `src/studio/folders/write.ts` connects reads and plans
to create, synchronize, and empty-folder removal actions. It changes folder
records only; it never changes page content or URLs.
None of these foundation modules registers a Studio schema. There is no public
package export for these functions yet. The navigator displays saved folders
alongside folders inferred from page URLs.
The private [URL field](url-field.md) calls the writer from explicit folder
creation and draft URL changes. Pages also offers folder creation directly from
the navigator, using the same creation modal and guarded writer.

The broader editor behavior is described in [Pages](./pages.md) and the
[Pages design decisions](./pages-design-proposals.md). The shared route
registration comes from the [URL subsystem](./url.md).

## One folder experience for editors

Editors should not need to know whether a folder was inferred from a page URL or
loaded from a saved record. Both appear and behave as ordinary folders. There are
no persistence labels or different row styles. A **Sync folders** action in the
Pages `…` menu is an out-of-the-way recovery option, not a routine editor task.

The intended workflow is for the developer to synchronize existing paths during
setup, then have kit-managed folder creation and URL changes save the necessary
records as part of those actions. Imports and external writers should synchronize
after their changes. Inference remains a fallback that keeps pages discoverable;
it is not an editor task to resolve. The private draft URL field now preserves
the old and destination folders before emitting a URL patch. This applies only to edits through that input; native
fields, imports, and API writers still need explicit synchronization.

The approved safety fallback is a background check after Pages initializes and
when newly loaded paths reveal missing folders. In the normal workflow it should
find nothing to save. When needed, it may add missing organizational records;
it must never change page content or URLs, publish documents, rename folders, or
remove anything. Checks must be throttled, nonblocking, and avoid overlapping
runs. Writes require sufficient access, complete inventory evidence, revision
guards, and reconciliation of uncertain outcomes before retrying.

This replaces the earlier policy that opening Pages must never write. The
background coordinator and menu action are now implemented in the local Pages
plugin. Nothing runs while Studio is closed, so import synchronization
remains the preferred way to persist imported paths.

## What a saved folder contains

The storage model is one managed registry document in the configured Sanity
project and dataset. That project/dataset serves one website:

```json
{
	"_id": "sanityKit.folders",
	"_type": "sanityKitFolderRegistry",
	"schemaVersion": 1,
	"folders": [
		{ "_key": "folder-about", "pathname": "/about" },
		{ "_key": "folder-company", "pathname": "/about/company" }
	]
}
```

Sanity supplies `_rev` on an existing document. The planner requires that revision
so the writer can detect changes made after the registry was read. A folder's
`_key` stays stable when other folders are added or removed. Keys must contain
1–128 letters, digits, underscores, or hyphens. The caller supplies keys for new
records; the writer uses `crypto.randomUUID()`. The planner rejects duplicate keys rather
than replacing another folder.

The registry ID is always `sanityKit.folders`. There is no site identifier or
multisite configuration. The supplied client selects the project and dataset;
ordinary page documents continue to use their own Sanity-generated IDs.

The root `/` is implicit and never saved as a folder. Every saved folder must have
its ordinary ancestors in the registry. Paths use the shared safe-path rules and
must already be canonical: no repeated slashes or trailing slash. Invalid saved
values are refused rather than silently repaired. The URL field's candidate
cleanup is a separate editing behavior.

The dotted document ID is intended for authenticated organizational metadata.
Hiding a schema from menus is not access control. This slice installs no schema,
or permission policy. The writer uses the supplied client's credentials; Sanity
enforces its write permissions. The private URL field checks effective dataset
access before calling the writer. Schema registration and broader permission
acceptance remain separate work. The registry receives immediate updates,
without drafts or publication. Frontend rendering does not need this registry.

## Collections and ordinary folders

Collection groups belong to route registration. They are not saved folder records,
and collection item documents do not create folders during synchronization.

Today a collection group appears at its configured **overview pathname**, which
can differ from its item prefix. For example, the Journal group might be at
`/content/journal` while posts use `/posts/:slug`. The registry can save `/content`
but cannot also save `/content/journal` as an ordinary folder.

Ordinary pages can still exist below that group or elsewhere. A page at
`/content/journal/about/team` implies the ordinary folder
`/content/journal/about`. An ordinary page at `/posts/resources/example` can imply
`/posts` and `/posts/resources`. The presence of a collection does not reserve all
of these paths against ordinary pages. The shared route registration determines
which page URLs belong to the navigator.

## The plans

`createFolderPlanner({routes})` copies the shared route configuration and
returns these private functions:

| Function                                        | What it does                                                                                                                                          |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validateRegistry(record)`                      | Checks the registry's identity, version, keys, paths, ancestors, and limits. Returns copied fields and the expected revision.                         |
| `planCreate(record, pathname, createKey)`       | Adds a folder and any missing ancestors. Existing keys and record order remain unchanged.                                                             |
| `planSynchronize(record, inventory, createKey)` | Adopts folders implied by registered ordinary page URLs and ancestors of configured collection groups. Never removes existing folders.                |
| `planRemove(record, pathname, inventory)`       | Removes one saved folder only when the supplied evidence says it has no index page, descendant page, saved subfolder, or collection group beneath it. |

Use `null` only when a read has established that the registry does not exist.
`undefined`, malformed records, a different registry ID, and unsupported schema versions are
errors. An unreadable registry must not be mistaken for an empty one.

The synchronization helper runs when called; the display reader does not call
it. The tool coordinator invokes it as a safety fallback under the policy above. A page at `/about/company/team` contributes
the parent folders `/about` and `/about/company`; it does not alone establish
`/about/company/team` as a folder. Once adopted, those parents remain saved even
if the page later moves away. Removing them requires a separate empty-folder
action. The private draft URL field preserves both the old and destination
folders before automatically saving a valid edited URL.

Results are either `{ok: false, reason}` or `{ok: true, value}`. A successful plan
contains:

- `operation`: `create`, `update`, or `unchanged`.
- `guard`: an expected registry revision, or `{kind: 'absent'}` for an initial
  create.
- `document`: the proposed registry fields owned by this subsystem.
- `added` and `removed`: folder records affected by the operation.

An unchanged plan needs no write. A failure returns no partial plan. These
functions never mutate their input records or perform network calls. Key creation
is delegated to the supplied callback and is called only for missing folders.

## Evidence needed to remove a folder

The visible navigator is not enough to establish that a folder is empty. Its
selected perspective can hide a published URL, another draft, or a release
version. Removal and synchronization therefore require a supplied inventory:

```ts
{
  perspective: 'raw',
  complete: true,
  readAccess: 'all-registered-versions',
  documents: rawDocuments,
}
```

The caller must supply every relevant registered document version within the
configured routing scope, including published documents, drafts, and release versions.
Each registered document needs its real `_id`, `_type`, `_rev`, and configured URL
field. Do not collapse versions into one effective document. A page at the folder
URL counts as its index page and blocks removal, just as a descendant page does.
Matching uses path boundaries: `/about/teamwork` is not inside `/about/team`.

Missing URL values do not occupy a URL. Malformed or noncanonical URLs in registered
documents cause refusal, so an unrecognized value cannot quietly become evidence
of emptiness. Even a valid stored URL that fails the collection ownership rules
can block removal. Unregistered document types do not participate in folder
inference or occupancy checks.

**The completeness and read-access fields are caller attestations, not proof.**
The planner cannot verify permissions, detect rows omitted by a restricted query,
or establish that no document changed after the inventory was read. An incomplete
or unknown inventory is refused. A falsely marked complete inventory remains
unsafe and must never be treated as a transaction guarantee.

## Reading evidence from Sanity

`createFolderLoader({routes}, client)` creates a private loader. Call the
returned function with `{readAccess: 'all-registered-versions'}` and an optional
abort signal. That assertion means the caller knows its credentials can read the
private registry and **all** relevant published, draft, and release documents.
`'unknown'` refuses the read; guessing from an empty response is not sufficient.

The loader makes one structured GROQ request for the registry and registered
document types. It uses the dated `2026-10-01` API, requests the raw perspective,
disables the CDN and Stega, asks for filtered results, and explicitly requests
`cache: 'no-store'`. It does not memoize snapshots or subscribe to changes. Tests
verify that the installed SDK forwards `no-store` to its underlying fetch call.

The client supplies the project and dataset for one website. Registered schema
types define the content scope within that dataset. Consumers must own that scope
and attest access to every registered document version. The loader does not filter
documents by a site field or provide multisite support.

Document projections include `_id`, `_type`, `_rev`, original-identity evidence,
and each type's configured URL value. Bodies and unrelated content are omitted.
The loader rebuilds nested field paths, such as `pathname.current`, so the existing
planner can read them. It preserves each stored URL value, including malformed or
misplaced URLs, and retains documents without URLs. It neither cleans these values
nor filters them out. Missing values are represented as `null`; surrounding field
metadata is not fetched. URL mappings cannot target document metadata fields.

An extra result row detects an inventory larger than the supported limit. An
overflow returns failure, never a truncated inventory marked complete. The loader
also checks envelope shape, registered types, raw identities, revisions, and
duplicates. A matching `_originalId` is preserved; a differing one is refused
because it can indicate an effective-perspective merge. The singleton is checked
with the planner's existing registry validation.

A successful result has `status: 'loaded'` and a `snapshot` containing `registry`
and `inventory`. A missing registry is explicitly `null`. A malformed response,
failed request, unsupported registry, unknown access, oversized result, or canceled
read returns `status: 'unavailable'` with a reason. Cancellation is checked both
before and after the request, including when an adapter ignores its signal.

This is validated **read evidence**, not approval of a folder operation. Pass the
snapshot through `planCreate`, `planSynchronize`, or `planRemove` as appropriate;
their existing guards still apply. In particular, the read can succeed with a
malformed stored URL that causes synchronization or removal to refuse. Reading
never adopts inferred folders. Cancellation and request failures never become an
empty registry or a successful emptiness check.

The returned registry contains only the planner's owned fields and `_rev`.
Additional source metadata is left untouched but is not returned. The writer
appends missing records or unsets a selected key instead of replacing the registry
with this snapshot. A single request reduces separate-read drift;
it does not lock documents against later changes. Successful reads cannot prove
ACL visibility or make removal race-free.

## Displaying saved folders in Pages

The navigator has a smaller read than the operation loader above. It reads only
the fixed registry document, validates it, and merges the saved paths with folders
inferred from the visible pages. It does not fetch every raw page version, adopt
folders, or call the writer. The separate tool coordinator can schedule the
background synchronization described below.

Saved folders remain visible with no pages inside. A real page at a saved folder's
path appears first inside it, using the page's title. Matching inferred and saved
paths appear once. Collection groups stay separate. The navigator's expansion
keys remain path-based so saving an inferred folder does not reset its open state.

Organizational metadata has no draft or release lifecycle. Its exact-ID read uses
the raw perspective, independently of the selected content perspective. A missing
or invisible registry contributes no saved folders; this is not evidence that the
registry is absent or permission to create it. Malformed, oversized, or failed
reads produce a warning and retry action. Ordinary page navigation remains usable.
The last successful folder list can remain visible with that warning until retry
succeeds; it is never used as write evidence.

The sidebar and page picker share the same folder resource and existing change
listener. Registry changes refresh the list, and reconnect/periodic reads repair
missed notifications. Search still searches pages and overviews, not folder names.
See [the Pages data architecture](pages.md#shared-live-data-loading).

## Proposed bounds for this implementation

These are conservative implementation-review defaults, not Sanity platform
limits or a performance promise:

| Limit                                               | Value   |
| --------------------------------------------------- | ------- |
| Saved folders in the configured project/dataset     | 1,000   |
| Characters in a pathname                            | 2,048   |
| UTF-8 bytes in the planner's owned registry fields  | 512,000 |
| UTF-8 bytes in the writer's serialized request body | 512,000 |
| Raw document versions supplied to one inventory     | 10,000  |

Existing records and proposed additions must fit these bounds. Over-limit
inventories must fail rather than truncate. Larger sites need a deliberate storage
and inventory design before these limits can be raised. The byte check covers the
fields returned by the planner. The writer separately checks its request body,
including revision and patch overhead. Neither bound measures unrelated metadata
already stored on the registry; Sanity still enforces its own document limits.

## Saving new folders and adopting existing paths

The private `createFolderWriter({routes}, client)` returns three explicit actions:

- `create({pathname, readAccess, signal?})` saves the requested folder and any
  missing ancestors. Its input must already be canonical.
- `synchronize({readAccess, signal?})` saves folders implied by registered page
  URLs and collection-group ancestors. It only adds records; it never prunes
  folders that no longer have pages.
- `remove({pathname, readAccess, signal?})` removes one saved folder after checking
  that no registered page version, subfolder, or collection location uses it.

All three use the same `readAccess` assertion as the reader. Unknown access refuses
the operation. The client must configure a concrete dataset name; dataset aliases
are not supported by this private writer. Constructing it does not read or write anything. Each
action loads new evidence and runs the planner itself; callers cannot submit
arbitrary plans for execution. The supplied routes are copied at construction.
Settings changes require a new writer with newly resolved routes.

If the registry is absent, the writer uses strict `create`. It never uses
`createIfNotExists`, which could silently succeed without adding the desired
folders when another editor creates the singleton first. For an existing registry,
the writer checks its exact `_rev`. Creation and synchronization append new
records. Removal unsets only the selected array item by its stable `_key`. Other
items, keys, and unrelated document or item metadata remain untouched. An action
with nothing to add returns `unchanged` without sending a mutation. This describes
the read snapshot, not a guarantee that the dataset cannot change afterward.

The mutation uses the dated API and `visibility: 'sync'`, so a confirmed result
waits for Sanity's ordinary query visibility. It requests identifiers rather than
document bodies, disables SDK mutation retries per request, and overrides inherited
framework cache hints with `no-store`. These choices are verified against the
installed SDK transport. Custom request handlers and proxies can still override
transport behavior; applications must not add hidden write retries.

Sanity's revision check rejects a stale registry update atomically. The writer
does not retry or merge after that rejection; the caller must obtain a new result.
The single strict create or guarded patch is the entire transaction. No document
URL, collection setting, redirect, or published page changes with it. See
[Sanity transactions](https://www.sanity.io/docs/content-lake/transactions) and
[the mutation API](https://www.sanity.io/docs/http-reference/mutation).

## Results and uncertain outcomes

The writer returns explicit states:

| Status            | Meaning                                                                                                                    |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `written`         | Sanity acknowledged the expected registry mutation. Includes its transaction ID and added or removed keys/paths.           |
| `unchanged`       | The fresh read showed no missing folders. No mutation was sent.                                                            |
| `unavailable`     | Reading failed, access was not confirmed, or cancellation happened before mutation dispatch. Includes the reader's reason. |
| `invalid`         | Planning or request-size validation refused the action. No mutation was sent.                                              |
| `rejected`        | A recognized API rejection reports a conflict, permission failure, or rejected request. No automatic retry follows.        |
| `outcome-unknown` | A mutation was attempted but its result could not be confirmed. Includes the attempted added or removed keys/paths.        |

A timeout, lost response, cancellation after dispatch, server error, or malformed
acknowledgment can leave the outcome unknown. The write may have succeeded. The
writer also treats timeout/client-closed HTTP statuses as uncertain rather than
assuming they prove rejection. Conversely, a valid acknowledgment remains
`written` even if cancellation arrives just afterward. The result never claims
that cancellation undid a committed mutation. See
[Sanity's cancellation guidance](https://www.sanity.io/docs/apis-and-sdks/js-client-advanced#cancel-with-an-abort-signal).

Do not blindly retry an uncertain result. Read the registry again and reconcile
the returned keys and paths with the current data; a delayed or stale query alone
cannot prove the first operation failed. The lower-level writer returns evidence for the caller to reconcile. The Pages
service provides the recovery described below. Its reported transaction ID is
only available after a valid acknowledgment.

Tests in `tests/studio/folders-write.test.ts` cover result handling, size bounds,
and SDK retry behavior. `tests/studio/folder-persistence.integration.test.ts` runs
actual GROQ and the native client against local fixtures to exercise additive
adoption, metadata preservation, and concurrent registry changes. These are
offline tests, not live dataset acceptance.

## How the draft URL field uses folders

Opening the [URL field](url-field.md) reads folder metadata and document versions;
it does not save anything. Choosing a folder changes the local proposal and
starts checked URL autosave. **New subfolder** is an explicit save: it adds the requested path and any missing
ancestors through the guarded writer. The new folder remains even if the editor
cancels the proposed URL change.

Before URL autosave emits a native form patch, the field ensures that the old
and destination folders are saved. These are separate operations, not a combined
transaction with the document patch. A failed or canceled URL change can therefore
leave harmless empty folders. Unknown folder-write outcomes block blind retries.
The input checks effective all-document read access before supplying the loader's
visibility assertion; Sanity still enforces mutation permissions. While those
checks are pending, the field shows that the URL edit is not yet saved. A failed
check keeps it local; network failures offer **Retry saving URL**, without silent
retry loops.

The field supports fixed routes and draft URL changes, including drafts of
published pages when paired with the URL-aware Publish action. Release and
live-edit URL changes remain blocked. Pages owns the separate synchronization
fallback described below.

## Creating folders from the navigator

Editors can prepare a folder structure without first creating a page. Choose
**Pages → … → New subfolder** to start at the site root, or **… → New subfolder**
on an ordinary folder to start inside it. Collection groups do not offer this
ordinary-folder action; their paths belong to collection routing.

Both actions open the same modal used by the URL field. Enter a folder name or
several relative segments, such as `company/team`. From the Pages menu, **Nest
inside** lets you choose the parent. From a folder’s menu, it shows that folder’s
full path as fixed text: the new folders are created inside it. The preview shows
the complete folder path before saving.
Root `/` remains implicit; it is not a saved folder record.

The navigator saves the folder and any missing ancestors, then refreshes the
saved-folder list. It does not create a page, change a document's URL, or move
the website preview. The dialog belongs to the tool rather than the disposable
page picker, so opening it from the picker can close that picker safely.

Navigator creation, removal, and synchronization share one tool-scoped service
and coordinator. They do not make overlapping writes. Creation checks current read
access and a fresh inventory before using the additive writer. Sanity enforces
write permissions. A failed or uncertain save stays visible for recovery; an
uncertain result must be reconciled before another write can be attempted.
The intended folder keys and paths survive closing and reopening the dialog
for the tool's lifetime, but do not form a durable receipt across a Studio reload.

The URL field uses the shared modal for a different next step: after a confirmed
folder save, it selects that folder for the document's proposed URL. Navigator
creation only saves organizational metadata. Both keep empty folders available
for later pages.

## Automatic synchronization and manual recovery

Pages schedules a background check one second after the tool mounts. It also
schedules a check when a newly loaded page list contains different document IDs
or URLs. These visible results are only a signal to check; they are never used
as evidence for a write. The service reads current access grants and a fresh,
bounded inventory of raw draft, published, and release versions before saving.
It uses the same additive writer as setup/import synchronization.

One coordinator serves the tool's navigator, picker, and preview perspectives.
Checks do not overlap. Automatic checks start at most once per minute, and
requests received during a check are coalesced into one later check. There is no
continuous sync timer: when paths stop changing, nothing more is scheduled.
Ordinary page reads retain their separate periodic refresh. A successful write
refreshes saved-folder display without resetting the navigator's scroll or selection.

If folders are already saved, the check writes nothing. Automatic success is
silent. A failed check pauses automatic synchronization for that tool instance;
page browsing remains available. Editors can use **Pages → … → Sync folders**
to run a fresh check and see the result. The feedback identifies missing or
unverified access, connection trouble, changed records, or unsupported data.
Closing the dialog does not cancel the shared operation. The action only adds
missing folder records; it never changes page content or URLs, publishes,
renames, or removes anything.

Read access is proven using the same scoped grants as URL editing. Redirect
access is not required. Sanity enforces write permissions on the mutation itself;
a reader can still get an up-to-date result when there is nothing to save.
Older navigation configurations that cannot safely author folders remain
browsable, with an explanation when manual sync is attempted.

A lost write response pauses synchronization. The service remembers the attempted
folder keys and paths for the tool's lifetime. **Check again** first reads fresh
evidence and requires all those exact records before allowing another write.
An absent record could be a stale query, so absence does not authorize a retry.
This state survives closing the picker, changing perspective, and reopening
feedback; it is not a durable operation receipt across a full Studio reload.
Every new tool instance still reads fresh evidence and uses strict creation or a
registry revision guard. Imports should continue to run explicit synchronization
rather than relying on an editor eventually opening Pages.

Implementation: `synchronize.ts` owns access checks and uncertain-write recovery
for tool-managed folder creation, removal, and synchronization; `sync-controller.ts` owns
their coordination and background scheduling. The Pages tool provider owns their
shared lifetime. `folder-sync-dialog.tsx` provides manual sync feedback. These
helpers remain private implementation details, not new package exports.

## Removing an empty folder

Choose **Remove folder** from an ordinary folder's `…` menu. A confirmation
shows the full folder path. The action is disabled when the loaded tree already
shows contents. That is only a convenience: confirming always checks fresh data,
including versions that are not visible in the current preview perspective.

An empty folder has no page at its exact URL, no page below it, no saved
subfolder, and no configured collection group at or below it. Drafts, published
documents, and release versions all count. The check covers every registered URL
type, not just the currently loaded navigator rows. Unknown read access,
incomplete or malformed evidence, and exceeded inventory bounds stop removal.
Root `/` and collection groups are not ordinary saved folders and cannot be
removed this way.

After the checks, one revision-guarded patch removes only the selected folder
record. It does not delete documents, change URLs, publish anything, or create
redirects. Successful removal refreshes the navigator and shows **Folder removed**.
If contents were found, the dialog explains why removal was blocked. Permission,
connection, and changed-registry notices explain how to try again safely.

Removal shares the tool's coordinator with creation and background sync, so those
operations cannot overlap in that tool instance. If a write response is lost,
**Check again** reads the registry rather than resending the mutation. The service
retains the removed key and path: it proceeds only when neither is present. A new
record at the same path, or the same key at another path, is not evidence that it
is safe to repeat the removal. The operation remains unconfirmed and further
folder writes pause. This protects replacement folders from an accidental retry.
The pending evidence survives dialog closure for the tool's lifetime, but is not
a durable receipt across a full Studio reload. If checking stays inconclusive, a
developer can inspect the registry and request history before starting a new
operation.

A registry revision protects against concurrent folder edits, not against a new
page written after the occupancy query. External writers and other Studio
sessions can still introduce a page in that interval. Removal never touches that
page; URL inference keeps it discoverable, and synchronization can restore its
folder record. This is a fresh, guarded empty-folder check, not a database-wide
lock on page creation. Imports and external writers should still synchronize
folders after their changes.

`folder-remove-dialog.tsx` owns confirmation and feedback; the writer and planner
own the removal rule. Dedicated offline tests in `folders-remove.test.ts` and
`folder-remove-dialog.test.tsx` cover version occupancy, access, revision conflicts,
uncertain outcomes, replacement identities, and editor feedback. These checks do
not replace live Studio acceptance.

## What remains before the finished folder workflow

Folder rename, moving descendants, redirects for bulk moves, private-schema
registration, and broader live acceptance remain separate work. Empty-folder
removal does not move or remove populated folders. The planners use supplied
route registration; coordinating mutable collection settings with folder
operations remains future work.
