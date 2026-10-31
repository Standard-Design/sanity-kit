# Folders

Folders help editors organize site pages. A saved folder can remain visible even
when no page uses it yet. A page's URL still determines where it belongs: saving a
folder does not add a parent reference to the page or change its URL.

The implementation supplies **private validation and planning functions** in
`src/studio/folders/planner.ts` and a **private read layer** in
`src/studio/folders/load.ts`. The planner works on supplied records and returns a
proposed change. The read layer can fetch the evidence needed by those plans.
The approved **private additive writer** in `src/studio/folders/write.ts`
connects reads and plans to explicit create and synchronize actions.
It can save new folder records but cannot remove folders or change page URLs.
None of these modules registers a Studio schema or adds editing controls. There
is no public package export for these functions yet. A separate, read-only
navigator integration is now under review; it displays saved folders alongside
folders inferred from page URLs.

The broader editor behavior is described in [Pages](./pages.md) and the
[Pages design decisions](./pages-design-proposals.md). The shared route
registration comes from the [URL subsystem](./url.md).

## One folder experience for editors

Editors should not need to know whether a folder was inferred from a page URL or
loaded from a saved record. Both appear and behave as ordinary folders. There are
no persistence labels or different row styles. A **Sync folders** action in the
Pages `…` menu will be an out-of-the-way recovery option, not a routine editor task.

The intended workflow is for the developer to synchronize existing paths during
setup, then have kit-managed folder creation and URL changes save the necessary
records as part of those actions. Imports and external writers should synchronize
after their changes. Inference remains a fallback that keeps pages discoverable;
it is not an editor task to resolve. The URL-field write integration is still
pending, so that automatic persistence is a requirement for the finished workflow,
not a claim about today's native fixture fields.

The approved safety fallback is a background check after Pages initializes and
when newly loaded paths reveal missing folders. In the normal workflow it should
find nothing to save. When needed, it may add missing organizational records;
it must never change page content or URLs, publish documents, rename folders, or
remove anything. Checks must be throttled, nonblocking, and avoid overlapping
runs. Writes require sufficient access, complete inventory evidence, revision
guards, and reconciliation of uncertain outcomes before retrying.

This replaces the earlier policy that opening Pages must never write. The
background coordinator and menu action are not implemented in the current
display slice. Nothing runs while Studio is closed, so import synchronization
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
values are refused rather than silently repaired. The future URL field's cleanup
is a separate editing behavior.

The dotted document ID is intended for authenticated organizational metadata.
Hiding a schema from menus is not access control. This slice installs no schema,
or permission policy. The writer uses the supplied client's credentials; Sanity
enforces its write permissions. Studio access and schema integration still need
implementation and verification. Its lifecycle is immediate organizational updates,
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

The current synchronization helper runs only when called; the display reader
does not call it. The planned background coordinator will invoke it as a safety
fallback under the policy above. A page at `/about/company/team` contributes
the parent folders `/about` and `/about/company`; it does not alone establish
`/about/company/team` as a folder. Once adopted, those parents remain saved even
if the page later moves away. Removing them requires a separate empty-folder
action. A future kit-managed URL writer must preserve both the old and destination
folders as part of its workflow.

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
Additional source metadata is left untouched but is not returned. The additive
writer appends missing records instead of replacing existing records with this
snapshot. A single request reduces separate-read drift;
it does not lock documents against later changes. Successful reads cannot prove
ACL visibility or make a future removal race-free.

## Displaying saved folders in Pages

The navigator has a smaller read than the operation loader above. It reads only
the fixed registry document, validates it, and merges the saved paths with folders
inferred from the visible pages. It does not fetch every raw page version, adopt
folders, or call the writer. Opening the tool is read-only.

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

The private `createFolderWriter({routes}, client)` returns two explicit actions:

- `create({pathname, readAccess, signal?})` saves the requested folder and any
  missing ancestors. Its input must already be canonical.
- `synchronize({readAccess, signal?})` saves folders implied by registered page
  URLs and collection-group ancestors. It only adds records; it never prunes
  folders that no longer have pages.

Both use the same `readAccess` assertion as the reader. Unknown access refuses
the operation. The client must configure a concrete dataset name; dataset aliases
are not supported by this private writer. Constructing it does not read or write anything. Each
action loads new evidence and runs the planner itself; callers cannot submit
arbitrary plans for execution. The supplied routes are copied at construction.
Settings changes require a new writer with newly resolved routes.

If the registry is absent, the writer uses strict `create`. It never uses
`createIfNotExists`, which could silently succeed without adding the desired
folders when another editor creates the singleton first. For an existing registry,
the writer checks its exact `_rev` and appends only new records. Existing array
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
| `written`         | Sanity acknowledged the expected registry mutation. Includes its transaction ID and added keys/paths.                      |
| `unchanged`       | The fresh read showed no missing folders. No mutation was sent.                                                            |
| `unavailable`     | Reading failed, access was not confirmed, or cancellation happened before mutation dispatch. Includes the reader's reason. |
| `invalid`         | Planning or request-size validation refused the action. No mutation was sent.                                              |
| `rejected`        | A recognized API rejection reports a conflict, permission failure, or rejected request. No automatic retry follows.        |
| `outcome-unknown` | A mutation was attempted but its result could not be confirmed. Includes the attempted added keys/paths.                   |

A timeout, lost response, cancellation after dispatch, server error, or malformed
acknowledgment can leave the outcome unknown. The write may have succeeded. The
writer also treats timeout/client-closed HTTP statuses as uncertain rather than
assuming they prove rejection. Conversely, a valid acknowledgment remains
`written` even if cancellation arrives just afterward. The result never claims
that cancellation undid a committed mutation. See
[Sanity's cancellation guidance](https://www.sanity.io/docs/apis-and-sdks/js-client-advanced#cancel-with-an-abort-signal).

Do not blindly retry an uncertain result. Read the registry again and reconcile
the returned keys and paths with the current data; a delayed or stale query alone
cannot prove the first operation failed. The private writer does not yet provide
an automated reconciliation workflow or UI. Its reported transaction ID is only
available after a valid acknowledgment.

Tests in `tests/studio/folders-write.test.ts` cover result handling, size bounds,
and SDK retry behavior. `tests/studio/folder-persistence.integration.test.ts` runs
actual GROQ and the native client against local fixtures to exercise additive
adoption, metadata preservation, and concurrent registry changes. These are
offline tests, not live dataset acceptance.

## What remains before editor integration

A registry revision check only protects the registry. It does not stop another
writer from creating a page in a folder after the occupancy check. The persistence
design still needs coordinated URL changes, appropriate permissions, freshness
checks, and a policy for external writers. This slice does not claim database-wide
uniqueness or race-free empty-folder removal. For this reason the writer has no
remove action, even though the pure planner can describe one.

Folder rename, moving descendants, redirect creation, UI actions, private-schema
registration, and live acceptance tests remain separate work. These planners use
the supplied route registration. A separate private collection-settings loader
is now approved. Coordinating settings changes with folder operations remains
future work.
