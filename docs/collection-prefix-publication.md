# Reviewing collection-prefix changes

## What this checkpoint does

Changing a collection prefix changes the URLs of its items without changing
what those items store. If Journal moves from `/journal` to `/blog`, a post whose
slug is `first-post` moves from `/journal/first-post` to `/blog/first-post`.
The slug stays `first-post`.

This checkpoint adds a **private, read-only planning foundation**. It can list the
live URLs that would change, check the surrounding routing data, and prepare the
redirect changes for review. It cannot publish settings or change redirects.
There is no new Studio dialog, and the settings document's native Publish action
remains disabled.

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
An external writer can still create a conflict afterward; the eventual writer
must recheck immediately before dispatch and protect affected revisions in its
atomic operation.

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

These are implementation bounds for this private checkpoint, not Sanity service
limits. A future transaction must separately measure its exact mutations and
receipt. Fitting the review does not mean a publish request will fit.

## What remains before editors can publish prefixes

The next implementation must provide the native schema and write-authorization
adapter, a clear review dialog, and a bounded atomic operation that publishes the
reviewed settings together with redirect changes and a confirmation receipt.
It must preserve unrelated item drafts, guard affected revisions, and recover
uncertain network outcomes without blindly sending the write again.

Initial settings publication, same-prefix settings publication, and the policy
for any other fields in the settings draft need explicit handling in that
workflow. Native settings Publish must stay disabled until the complete guarded
path is installed. Live acceptance will then need to verify the Studio review,
published and preview routing, redirect behavior, and consumer cache refresh.
