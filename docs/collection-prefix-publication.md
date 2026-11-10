# Reviewing and publishing collection-prefix changes

## What this checkpoint does

Changing a collection prefix changes the URLs of its items without changing
what those items store. If Journal moves from `/journal` to `/blog`, a post whose
slug is `first-post` moves from `/journal/first-post` to `/blog/first-post`.
The slug stays `first-post`.

This checkpoint adds a **private publishing core** on top of the read-only
planner. It can review the live URLs that would change, then publish the reviewed
settings and redirect changes together. It also records enough information to
check the outcome if the connection is lost.

There is no new Studio dialog, and the settings document's native Publish action
remains disabled. The core requires an explicit schema and write-permission
adapter before it can send a request. The [native adapter](collection-prefix-write-access.md)
is implemented separately; connecting it to the editor workflow remains ahead.
These are private building blocks, not a consumer-ready
publishing integration.

The work builds on [collection routing](collection-routing.md), the shared
[redirect rules](redirects.md), and the reviewed bulk redirect planner used by
[folder renames](folders.md). Its source modules are private; consumers cannot
import them from the published package yet.

## What moves and what stays put

The proposal applies one saved settings draft to one registered collection.
It uses the current published prefix as the starting point and that settings
draft's prefix as the destination. Configuration defaults are never substituted
for missing settings.

- Published collection items produce live URL changes. Their stored slugs and
  other content are untouched.
- Draft item URLs are checked too. A draft may have a different slug from its
  published version. The proposal does not publish that draft or copy its fields
  into the published item.
- The collection's index is an ordinary page with its own full pathname. It stays
  where it is, even if its pathname matches the old collection prefix. Other
  pages that list collection items also keep their URLs.
- Other collections retain their own settings. Publishing one prefix must not
  depend on another collection's pending prefix change having happened first.
- An incomplete draft with no slug remains incomplete. The review does not
  invent a URL or create a redirect for it.

The first publication of a collection settings document is **not supported by
this checkpoint**. If there is no published settings document, the planner
returns `first-publication-unsupported`. A later initial-publication workflow
must establish the live prefix explicitly; it must not guess one from a default.
Code-locked prefixes and same-prefix edits are also outside this planner.

## What the review checks

The planner resolves three views of the same raw evidence:

1. The current published settings.
2. The current draft settings, including other collections' pending changes.
3. Proposed published settings, where only the selected collection uses its
   reviewed draft prefix.

Every registered page's published, draft, and release versions reserve their
resolved URLs across these views. Two versions of the same document share one
identity; separate documents cannot claim the same URL. App-owned exact paths
and reserved path prefixes remain protected.

This deliberately conservative check can block a move that would be possible
only after another change is published. It does not guess publication order.
Malformed paths, incomplete evidence, duplicate identities, and invalid settings
are errors rather than reasons to ignore a document.

A release version of an affected collection item blocks the proposal. A release
version of any editable collection settings document also blocks it, because
release-specific routing is not supported yet. Other documents' release versions
still reserve their URLs. The block does not instruct editors to discard planned
work; release-aware coordination is separate work.

## How redirects are planned

New redirects are optional. When selected, each moved **published** item gets an
exact redirect from its old pathname to its new pathname. Draft-only URLs do not
get redirects. Wildcard/prefix redirects remain deferred.

Existing active aliases that point to a moved live URL are updated to point
directly to its new URL, even when new redirects are turned off. For example:

```text
Before: /old-story → /journal/first-post
After:  /old-story → /blog/first-post
```

Repeated prefix changes therefore do not build a chain of redirects. The shared
bulk planner checks the complete redirect graph, app reservations, occupied
paths, and limits. A conflicting redirect draft or release version blocks the
plan; this workflow cannot overwrite or publish another editor's redirect work.

An active redirect at a proposed live or draft URL also blocks the move. The
review identifies its record when the redirect planner can do so. It does not
assume every redirect destination is a registered CMS page: an application may
own valid destination routes too.

## Private source contracts

`src/studio/collections/prefix-plan.ts` exposes
`createCollectionPrefixPlanner(configuration)`. Its `plan(choice, inventory)`
method is pure: it receives data and returns a plan or a specific failure.

`choice` names the collection, its reviewed published and draft settings
revisions, and whether new redirects should be created. The inventory contains
raw settings, page versions, and redirect versions, together with explicit
completeness and read-access assertions. Assertions supplied directly to this
pure function are the caller's responsibility.

The result includes the settings change, live item URL changes, checked draft
URLs, redirect creates/updates, every observed document revision, and the size
of the review. It contains no item patches, executable mutation batch, allocated
redirect IDs, or write authorization. Returned plan data is frozen.

`src/studio/collections/prefix-review.ts` exposes
`createCollectionPrefixReviewer(configuration, client, options)`. It reads compact
projections through the supplied project's client using the raw perspective,
without the CDN or inherited HTTP caching. The query keeps version identities
and revisions and does not fetch page bodies.

Its `review(choice, signal)` method checks access, reads evidence, builds the
plan, and checks access again. `recheck(review, signal)` performs another fresh
read and compares the evidence. A new document, changed revision, changed
setting, new conflict, lost access, failed read, or canceled request prevents a
previous review from being accepted as current. The reviewer recognizes only
reviews created by that instance; a reconstructed object is not a valid review.

Neither method writes. A successful recheck also does not lock the dataset.
Another write can still create a conflict afterward. The guarded writer rechecks
immediately before dispatch and protects the settings and redirect revisions
inside its atomic operation. The concurrency boundary is explained below.

## Read access is an integration requirement

**Read and write permissions are separate requirements.** The reviewer requires
a `confirmReadAccess` callback. The native read adapter is described in
[collection-prefix access](collection-prefix-access.md). It must check fresh permissions
for the specified project and dataset before and after the inventory read.
Returning a list of visible documents is not proof of access.

`src/studio/collections/prefix-access.ts` describes the required scopes:

- Every published, draft, and release version of each registered page type.
- Every published, draft, and release version of redirect records.
- The exact configured published settings identities and their draft identities,
  even when absent, regardless of document type.
- Every release identity belonging to those settings documents, also regardless
  of type. A malformed record must not disappear behind a type filter.

The callback must return an explicit granted, missing, or unverified answer for
each scope. An empty, incomplete, duplicate, or malformed answer cannot grant
access. This lower-level contract is an integration requirement, not a default
role check or permission to publish. It does not prove
permission to update settings, edit redirects, publish documents, create
receipts, or bypass schema `readOnly` rules.

## Bounds

The planner currently supports up to 10,000 page versions, 1,000 settings
versions, 100 affected item versions, 2,000,000 bytes of projected inventory, and
512,000 bytes of review data. Redirect counts, graph size, and change counts also
use the existing bulk redirect limits. Reads fetch one extra row to detect
truncation; exceeding a bound is an error, never permission to review a subset.

The writer separately limits the two full settings documents to 1,048,576 bytes
and the exact serialized Actions request, including its receipt, to 1,048,576
bytes. A receipt may contain escaped review data, so the writer measures the
actual request rather than estimating from the plan's size. The persisted
recovery envelope also has its own defensive parsing bound.

These are implementation bounds for this private checkpoint, not Sanity service
limits. Fitting the review does not mean a publish request will fit.

## The guarded writer

`src/studio/collections/prefix-write.ts` exposes the private
`createCollectionPrefixController(options, client)` factory. Its methods are:

- `review(choice, signal)`: builds the existing routing review, loads the complete
  published and draft settings documents, checks their revisions, and asks the
  supplied adapter to authorize the exact proposed work.
- `publish(review, {isCurrent, signal})`: accepts only a review produced by this
  controller, repeats the read checks and inventory review, repeats write
  authorization, and checks that the editor still accepts this review. It saves
  recovery information before sending one request.
- `getPending()`: reports a previously sent operation whose outcome is unresolved.
- `reconcile()`: checks the exact receipt for that operation without sending the
  settings or redirects again.

A ready review includes the complete published and draft settings documents.
**Publishing applies the whole reviewed settings draft**, just like ordinary
Publish. If the draft also changes the collection display name or another
settings field, that change is included. Item drafts and independently located
index pages remain untouched. The future review UI must make this scope clear.

The writer sends one [Sanity Actions API transaction](https://www.sanity.io/docs/http-reference/actions):

1. Existing aliases get a fresh draft copied from their exact published revision.
   Only the destination is changed, and that draft is published. The server copy
   preserves fields that were not in the routing query. If another redirect draft
   has appeared, creating this fresh draft fails instead of publishing that
   editor's work.
2. Optional new redirects are created under fresh random IDs and published.
3. The settings draft is published only if its revision and the published
   settings revision still match the review.
4. A confirmation receipt is created and published in the same transaction.

The batch succeeds together or changes nothing. The writer never includes item
patches, item publications, or index-page updates. Request retries are disabled.
Generated redirect and receipt IDs belong to this one reviewed operation; they
are not deterministic IDs derived from URL text.

## Write and schema authorization

The required `authorize` callback receives the project and dataset, an exact
receipt ID, and a list of action targets. Targets distinguish publishing the
complete settings draft, creating/editing/publishing a fresh draft of an existing
redirect, and creating/publishing a new redirect or receipt.

The adapter must check the whole sequence for each target, including draft
creation and removal during Publish. For existing redirects it must load the
complete document at the specified revision to evaluate conditional rules.
It must validate the settings draft and applicable redirect schema rules, honor
document and changed-field `readOnly` rules, and verify the actual native write
permissions. A currently enabled Publish button is not a substitute for these
checks.

Every target needs one explicit `granted`, `missing`, `unverified`, or `protected`
answer. Exact published and draft receipt reads must also be granted, even before
those identities exist. The native helper
`checkCollectionPrefixReceiptReadAccess(client, receiptId, signal)` can supply
that read check. Empty, duplicate, partial, malformed, and denied answers block
the request. The private
`createNativeCollectionPrefixWriteAccess` adapter supplies these checks using
the active workspace's native validation and document grants. See the
[write-access guide](collection-prefix-write-access.md) for its schema, permission,
and timeout behavior. The editor workflow must install the adapter; accepting
this callback alone does not establish that it has done so.

## Lost connections and recovery

`src/studio/collections/prefix-pending.ts` keeps the exact receipt before dispatch.
The default store is this tab's session storage. A supplied storage adapter must
also survive reloads. If the store is unavailable, full, or cannot read back the
saved value, the writer does not send the request.

The receipt uses `sanityKit.collectionPrefixPublication.<random operation ID>`
and type `sanityKitCollectionPrefixPublication`. It records the exact reviewed
plan and generated redirect IDs. Recovery compares all expected receipt fields;
finding an unrelated receipt, or only seeing the new prefix in a query, does not
count as confirmation.

A matching transaction response confirms success. A known request rejection
confirms failure. If the response is lost or cannot be recognized, the controller
reads the receipt directly through Sanity's uncached Document API. A matching
receipt confirms the whole atomic batch. A missing, unreadable, or mismatched
receipt leaves the result **unknown**; it does not prove that the request failed.

While an operation is unresolved, another write through this controller or a
mounted controller sharing its scope is blocked. Reloading the tab restores the
receipt check. There is no automatic resubmission or timeout that clears the
record. Resolving a genuinely inconclusive operation will need a deliberate
support/recovery policy in the upcoming UI integration.

The pending slot coordinates this JavaScript process and survives the current
tab's reloads. It is not a dataset-wide lock or a cross-tab transaction coordinator.

## What the transaction cannot lock

Atomicity covers the target settings, changed redirects, and receipt. Current
read checks are not database-wide uniqueness or release locks. Collection items,
other settings documents, and untouched redirect records are rechecked, but are
not written merely to lock their revisions. Fresh GROQ reads also use Sanity's
query store, which can briefly lag committed document changes; disabling caching
does not remove that delay.

A concurrent uncoordinated write can therefore race the final read. This includes
native autosave, another Studio tab, another kit action, an import, or an API
script—not only external systems. A changed target settings revision or changed
redirect revision is caught by the transaction's revision guards; a newly added
item, release, or conflicting URL elsewhere may appear after the last inventory
check. Stronger cross-document coordination would require a separate design.

## Choosing the settings-publishing workflow

The private `createCollectionSettingsPublicationClassifier(routes)` helper in
`src/studio/collections/settings-publication-plan.ts` distinguishes three cases:

- **First publication:** a settings draft exists and the published settings
  document does not. An editable prefix activates collection URLs for the first
  time. A locked prefix already comes from code, so publishing its first settings
  document does not activate or move those URLs.
- **Unchanged prefix:** both settings versions exist and their effective prefixes
  match. Changing the display name is a typical example. The later integration
  can preserve ordinary Publish behavior instead of showing a URL-move review.
- **Prefix change:** publishing the draft would move item URLs. This needs the
  reviewed prefix-change workflow described above.

Its `classify({collection, published, draft})` method requires both document slots.
Explicit `null` means the caller established absence; omitted or `undefined`
values mean incomplete evidence. A draft must exist. The helper checks document
identities, collection binding, revisions, and editable prefix storage. It rejects
a release document supplied instead of the ordinary draft or published version.
A configured default never replaces a missing stored prefix or becomes an
invented live prefix.

The result identifies the workflow and captures the document revisions. It is
**not permission to publish**: it does not inspect page/redirect inventories,
check other collections for collisions, validate the whole settings schema,
prove read/write access, or discover release versions elsewhere in the dataset.
An empty query alone does not establish readable absence.

Classification resolves only the selected collection. Other collections can also
be waiting for their first settings documents, so requiring a complete frontend
routing context at this step would prevent setup from progressing. This does not
change the frontend resolver or invent fallback routes. First publication still
needs a separate check of the newly available URLs against the rest of the site
before it can be enabled.

## Checking a collection's first live URLs

The private `createCollectionSettingsActivationPlanner(routes)` helper in
`src/studio/collections/settings-activation-plan.ts` reviews the first publication
of an editable collection prefix. Existing published items would become reachable
at that prefix; draft items still remain drafts. There is no previous live prefix,
so the plan neither creates redirects nor changes existing redirect destinations.
It does not move an independently located index page or change stored item slugs.

The helper exposes the read coverage it requires. Its `plan(choice, inventory)`
method checks the selected settings draft revision and a complete raw inventory
of registered pages, items, settings, and redirects. It checks URL ownership
across current published routes, current preview routes, and the proposed live
routes. Reserved paths, conflicting redirect sources, malformed data, unsupported
release versions, and the shared review limits can prevent a plan from being
accepted. Another collection's loaded draft reserves its preview URLs too.

A collection with settings confirmed absent can remain inactive during this
review. That lets editors set up collections one at a time. This is only a review
rule: the frontend resolver still requires its complete routing context and does
not substitute configured defaults for missing live settings.

An accepted plan lists newly available live URLs, draft URLs, the revisions
reviewed, and settings identities that were absent. A later recheck must notice
new documents as well as edits to existing ones. The inventory's completeness
and read-access declarations are supplied by the caller; the pure planner cannot
prove them. A fresh reader, permission checks, and a guarded publish action still
need to connect this plan to Studio. Calling it writes nothing and does not
enable Publish.

## What remains before editors can publish prefixes

The implemented native schema/write authorization adapter, a clear review dialog,
and its pending/confirmation/recovery states must still be integrated. Initial settings
publication and same-prefix settings publication remain explicitly unsupported.
Native settings Publish must stay disabled until the complete guarded path is
installed.

The core has focused automated tests, including simulated atomic failures and
cold-start receipt recovery. Live acceptance must still verify actual server
Actions semantics, native permissions and schema validation, the Studio review,
published and preview routing, redirect behavior, and consumer cache refresh.
