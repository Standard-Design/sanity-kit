# Pages release acceptance

This checklist separates behavior covered by automated tests from behavior
observed in the proof Studio and website. It records the audit on November 11, 2026. It does not declare Pages ready for release or authorize changes to project
roles, fixture documents, or running servers.

The [release plan](pages-release-plan.md) tracks the remaining implementation and
packaging work. The [fixture acceptance record](../tests/fixtures/pages-studio/ACCEPTANCE.md)
records completed live checks. Use its newest entry for each workflow; older
entries sometimes describe states and limitations that later checks supersede.

## What is already established

| Area                        | Automated evidence                                                                                                                                                                                    | Recorded live evidence                                                                                                                                                                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First settings publish      | The activation reviewer checks occupied URLs and access. The writer strictly creates settings and its receipt together, rejects a concurrent first publish, and preserves item documents.             | November 11: a temporary singleton published through native Studio, showed confirmation, and shared a transaction revision with its receipt. Test records were removed with revision checks.                                                              |
| Name-only settings changes  | The normal action publishes the full settings draft without inventing a prefix move. Native validation, synchronization, permission, and read-only checks still apply.                                | November 10: the display name changed with the existing prefix, without a routine review dialog.                                                                                                                                                          |
| Prefix moves                | Review captures complete bounded inventories. Both new redirects and updates to existing redirects are checked. Revisions, consent, and access are checked again before dispatch.                     | November 10: two moves succeeded. The second declined new redirects but still updated the existing alias directly. Item snapshots and revisions stayed unchanged.                                                                                         |
| Conflicting redirect drafts | A draft or release affecting the move blocks it. Unrelated redirect drafts pointing to unchanged pages do not.                                                                                        | November 10: a temporary redirect draft blocked the move; the notice opened the exact conflicting redirect.                                                                                                                                               |
| Permission decisions        | Scoped custom grants are checked without role names. Missing and unverified access remain distinct. Native grants and schema validation inspect the actual proposed documents and receipt identities. | Successful runs used the existing signed-in account. They do not establish behavior under a restricted custom role.                                                                                                                                       |
| Concurrency and recovery    | Tests change reviewed records, revoke permissions, cancel requests, lose responses, reload controllers, and overlap operation identities. Unknown writes are not automatically repeated.              | November 11: two API clients exercised the actual settings writer; Sanity rejected a stale revision with HTTP 409 and preserved the competing edit. Installed native response-loss recovery also passed. Two-session native conflict UI remains separate. |
| Website delivery            | Request tests cover GET/HEAD, exact matching, preview bypass, failures, query handling, and consumer-cache invalidation. Fixture HTTP tests use real local sockets with mocked Sanity reads.          | November 11: the published listener delivered the saved redirect and rendered the destination without overlays; preview bypass and published data isolation were checked.                                                                                 |

These checks do not need to be repeated merely because another slice is approved.
Repeat the affected checks after a relevant code or configuration change, or when
the existing evidence cannot answer a specific release question.

## Remaining combined checks

Each section records completed live evidence and any remaining integration gap. An unverified check is not a confirmed defect.
For checks still outstanding, use dedicated test documents and capture their full published/draft snapshots,
revision IDs, and related redirects before starting. Keep source edits paused
while exercising Studio so hot reload does not interrupt the test.

### 1. Verify a restricted account

**Current status:** the user confirmed on November 11, 2026 that no separate
restricted test account is available. This live check is unverified. Automated
grant tests remain useful evidence, but do not replace it. Carry this limitation
into the release review rather than claiming a successful administrator run proves it.

Use a separate signed-in browser profile for an account whose effective grants
can be changed without affecting the developer's working account. The project
must support configuring the required custom role. Someone authorized to manage
project access must prepare the account; this checklist does not grant that
authority. If that account is unavailable, record the gap explicitly rather than
treating an administrator's successful publish as custom-role acceptance.

Run one allowed prefix move with the required read and write scopes, then a
blocked attempt with a required scope withheld. Include exact settings identities
and operation receipt access: a grant limited to a document type may not prove
access to a missing document with the expected ID. The
[native authorization guide](collection-prefix-write-access.md) explains which
identities and operations are checked. A first settings publish creates its
receipt directly; later saves use the native draft/publish sequence.

Confirm that the allowed account succeeds and the blocked account sees the
specific missing or unverified requirement. Confirm no settings or redirect write
was sent for the blocked attempt. A read failure must not be presented as an
empty inventory or a missing published settings document.

Also check a permission change after review. Native write decisions reevaluate
documents, but Studio may reuse its loaded ACL. Sanity's server remains the final
authority. Record whether the UI detected the change before sending or the server
rejected the guarded request; either must avoid a false success or partial update.

### 2. Verify a real revision conflict

**Real server/writer check passed on November 11, 2026.** Two independent API
clients used the disposable singleton
`kitProofRecoveryAcceptance-concurrency20261111` in `ha9kep4l/development`.
The actual collection settings writer prepared and rechecked a name-only change
with an unchanged unique prefix. Immediately before its guarded Actions request
reached Sanity, the second client changed the same draft using a revision guard.

Sanity returned **HTTP 409**. The writer reported `rejected/conflict` for operation
`676e1836-6074-4f2c-a95b-d7c952571092`. The published settings remained
byte-equivalent to their initial snapshot, and the second client's draft fields
and revision survived unchanged. Neither the published nor draft confirmation
receipt existed afterwards. Exactly one writer POST was sent, and its pending
state settled. This name-only branch schedules no redirect actions; it does not
establish live redirect-update rollback. Both disposable settings records were
removed with exact revision guards, and their absence was verified. No existing
fixture records were changed.

This run used controlled granted read/write authorization callbacks and the
signed-in CLI credential. It proves real server revision protection through the
actual writer, **not** native permission checks, restricted-account behavior, or
two-native-session UI behavior. Local snapshots and results are recorded in
`/private/tmp/sanity-kit-concurrency-acceptance-20261111.json`; this temporary file
is not a shipped artifact.

**Remaining native UI check:** use two independent Studio sessions on dedicated
settings and redirects. In the first, prepare a prefix review. In the second,
change the settings draft or an existing redirect that the review would update.
Then try to confirm the original review. It must require a fresh review or report
a conflict, and must preserve the second session's changes. Check document
revisions and network requests, not only the dialog text. This combines the
native UI with the server guards; two components sharing one browser's in-memory
pending slot are a different case already covered by automated tests.

### 3. Uncertain-response recovery passed

On November 11, 2026, Google Chrome for Testing exercised the installed package
against the development dataset. A dedicated empty collection used settings ID
`kitProofRecoveryAcceptance-20261111b`; existing collection items and redirects
were not part of the write.

The native action first published the settings normally. The editor then changed
its prefix from `/recovery-acceptance-20261111-b` to
`/recovery-acceptance-20261111-b-next`. Cancelling the initial check sent no publish
request and did not reopen the dialog when that check finished.

A temporary transport wrapper then allowed the real Actions request to succeed,
withheld its successful response, and temporarily refused reads of that exact
operation's receipt. The wrapper observed one publish request and one held
receipt read. Studio displayed the uncertain-outcome notice. Closing and
reopening it, then reloading the same tab, retained the same operation without
another publish request.

After receipt reads were allowed, **Check publish status** found the receipt,
closed the dialog, showed the native success toast, and restored the normal
Publish button. The operation ID and published settings revision were both
`03d27986-2b0b-4dd3-836b-9e33d1c5659f`; its receipt was
`sanityKit.collectionPrefixPublication.03d27986-2b0b-4dd3-836b-9e33d1c5659f`.
The initial activation used operation
`26572d1e-5e57-4a54-bb80-e0b2bffab80e`.

After successful recovery, the test settings and its two receipts were removed
in one revision-guarded transaction. Fresh reads confirmed all three were absent
and all 23 preexisting snapshot records were unchanged. The temporary transport
was removed by restoring the normal source Studio server. Cleanup evidence is
`/private/tmp/sanity-kit-recovery-20261111b-cleanup.json`; this local evidence file
is not shipped.

This proves recovery from a deliberately withheld successful response through
the native installed integration. It does not simulate every network outage or
browser crash. The collection had no items, so this test did not mutate redirects.
Recovery uses session storage and survives a reload in the same tab; it is not a
cross-tab lock or recovery after closing the tab.

### 4. Verify the installed consumer boundary

The public APIs are now checked from installed tarballs. The native settings
edit/publish/recovery workflow above used the installed package, as did the
website HTTP checks below. These establish the settings integration and saved
redirect delivery separately. A newly edited page URL published and followed
end-to-end in the installed consumer remains a separate check; it is not implied
by these results.

Keep the consumer-owned Studio, standalone URL-field configuration, and optional
React Router integration explicit. The package does not provide the application's
Studio installation or hosting platform. Broader dependency and navigator
acceptance remain separate release-plan checkpoints.

#### Installed website HTTP acceptance — November 11, 2026

Built and checked commit `d5b9dbfcc663c08c654c6e245c072459eabf58ce` in an isolated
snapshot, without the untracked acceptance drafts. All six application profiles,
installed Studio configurations, and TypeGen passed; the tarball contains 299
files. The local artifact still bears the unreleased working version
`0.1.0-alpha.5`; it is not the published npm artifact. Its SHA-256 is
`5a33c7fdb17c28de42b04251519e1999f4f7d3108f152e658664f95b66596b55`.

A separate installed website consumer imports URL settings from `/url/settings`,
redirect handling from `/redirect`, and routing types from `/url`. Its browser
and server bundles resolve the kit from that tarball, with no repository source
imports. The Studio consumer uses the same tarball. No credentials were copied
into files or browser assets; a temporary CLI bootstrap passes the signed-in
credential to the server client in memory. This is local acceptance wiring,
not a production preview-authentication design. After acceptance, the source
Studio and website servers were restored; the published redirect still returned
301 to the expected destination.

The identified source website worker was stopped and replaced with the installed
consumer on the same loopback ports. Read-only HTTP checks established:

- On port 3335, GET and HEAD for `/articles/routing-proof` returned **301** with
  `Location: /stories-tester/routing-proof` and `Cache-Control: no-store`. HEAD
  returned no body.
- Preview flags and incoming query parameters did not enable draft mode or
  change that published redirect destination.
- The destination returned a published HTML shell with status **200**. Its data
  endpoint returned **Collection routing live proof** at
  `/stories-tester/routing-proof`, both when asked for published content and
  when sent a draft-perspective parameter.
- On port 3334, the old URL returned the preview HTML shell with status **200**
  and no redirect. Draft and published data requests for the destination both
  returned the current article successfully.

The current draft and published destination paths match. These reads therefore
confirm both request modes work, but do not establish a live differing-prefix
case; automated perspective tests cover that distinction. No dataset writes or
browser-rendering checks were performed for this installed website run. The
consumer intentionally uses fresh reads without a cache backend. Native Studio
workflow acceptance and controlled response-loss recovery are recorded separately.

## Cache acceptance depends on the consumer

The proof website intentionally reads fresh redirect rules without a cache.
Its live HTTP acceptance therefore needs no cache backend. A concrete production
cache is not a package release prerequisite.

Automated request and React Router tests already cover reuse, finite lifetime,
invalidation, failures, project/dataset isolation, and an older in-flight refresh
being prevented from refilling an invalidated entry. They also prove that one
cancelled request does not cancel another request's shared refresh.

If an installed consumer fixture supplies a cache, add one combined check: warm
an old rule, publish or retire it, trigger that consumer's refresh/invalidation
path, and verify subsequent requests use the new rule. Record the consumer's
refresh policy. A successful Studio write alone does not prove its cache was
refreshed; browser-cached redirects are a separate concern. No new cache test is
needed solely to reproduce behavior already covered in the helper suites.

## Boundaries that testing cannot turn into guarantees

The transactions protect settings, changed redirects, and their receipts. They
do not lock every page or newly created URL in the dataset. Another editor,
autosave, import, or API writer can introduce a conflicting URL after the final
inventory read. GROQ visibility can also lag a committed change. Same-tab pending
coordination and repeated fresh checks reduce risk but do not establish
database-wide uniqueness. See the
[transaction boundary](collection-prefix-publication.md#what-the-transaction-cannot-lock).

Release-aware URL changes, document-free collection indexes, populated-folder
removal, and multisite routing remain deferred. Their absence is not an untested
implementation path that must be completed for this release.

## Focused automated verification

The November 11 audit ran 505 tests across these 15 suites successfully:

- Collection prefix: native read access, native write access, review, plan,
  writer, and publication session.
- Collection settings: activation review, activation plan, publication writer,
  publication session, and native publication action.
- Folder rename writer and shared URL access checks.
- Redirect request handling and React Router redirects.

The corresponding files are in `tests/studio/`, `tests/redirect/request.test.ts`,
and `tests/react-router/redirects.test.ts`. The tests include exact-operation
recovery when operation A settles after operation B becomes pending, stale and
cancelled async results, guarded revision failures, unavailable recovery storage,
native read-only fields and custom validators, and cache refresh behavior.

No new tests were added during this audit: the inspected concerns already had
focused regressions. The remaining evidence requires the native Studio, actual
accounts, server transactions, or an installed consumer. This document records
those prerequisites rather than increasing test counts with duplicate cases.
