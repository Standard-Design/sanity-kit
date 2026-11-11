# Reviewing a collection URL change

This private dialog and session owner prepare the editor review for changing an
existing collection prefix, such as `/journal` to `/blog`. The
[settings Publish integration](collection-settings-publication.md) connects them
to the native action automatically when the public settings wrapper is installed.
Native permissions and action availability remain required. Live checks on November 10, 2026 verified reviewed prefix moves
and an actionable redirect-draft block. The dialog and session themselves remain private; broader Studio acceptance
remains separate.

The dialog explains which item URLs change, whether new redirects will be created,
and which existing redirects will point to a new destination. Publishing includes
the whole settings draft, including any display name changes. Item documents keep
their slugs and draft content. Independently located listing pages do not move.

## How the pieces fit together

- `prefix-publication-dialog.tsx` renders the supplied state and calls callbacks.
  It does not run the publishing checks or write anything. Native conflict rows
  and release labels use Studio stores for display information.
- `prefix-publication-session.ts` owns one review session. It handles changing the
  redirect choice, waiting, cancellation, stale results, and recovery.
- `prefix-write.ts` builds the verified review, rechecks permissions and revisions,
  sends the write, and records its outcome. The session does not replace these
  checks. See [collection prefix publishing](collection-prefix-publication.md).

Create one session for a stable controller, workspace, and document action. A
React owner can use its `subscribe` and `getView` methods with
`useSyncExternalStore`. Creating the session performs no reads or writes.
Dispose it when the action or workspace changes.

The native action first classifies the settings change. This session
only handles an ordinary draft changing an already published prefix. First-time
settings publication, unchanged prefixes, locked prefixes, and release editing
have separate handling. The action must respect the native action's availability
and supported editing context before opening this flow.

## Current document state

Supply `getCurrent` as a callback that returns current state, rather than a captured
render snapshot. It returns the collection identifier, published and draft IDs and
revisions, whether local changes have synced, and validation state.

The validation revision must equal the draft revision. Validation must have
finished and contain no error markers. These inputs correspond to Studio's sync
and validation status, as used by the existing single-page URL action. Missing or
outdated validation is not treated as a successful check.

Call `refresh` when native document or validation state changes. The session also
calls `getCurrent` again when Publish is clicked and through the controller's
final `isCurrent` check. A delayed React render cannot authorize a stale review.
The controller separately reloads the reviewed documents and performs its native
write and schema checks.

## Dialog state and callbacks

| State           | What the editor sees                                               | What the owner does                                             |
| --------------- | ------------------------------------------------------------------ | --------------------------------------------------------------- |
| Closed          | No dialog                                                          | `open` starts a fresh review or restores a pending save.        |
| Checking        | Spinner and a checking message                                     | Loads the review; Cancel remains available.                     |
| Ready           | Prefix changes, item URLs, redirect choice, and existing redirects | `publish` accepts only the exact review currently displayed.    |
| Publishing      | The review with a busy Publish button                              | Blocks duplicate submission and dismissal while waiting.        |
| Blocked         | An explanation and applicable next action                          | `review` can load current information again.                    |
| Unconfirmed     | A warning that the save result is not known                        | `checkStatus` checks the receipt; it does not resend the write. |
| Checking status | The warning with a busy status check                               | Close remains available.                                        |
| Published       | The dialog closes and the Studio owner shows a success toast       | Calls `onPublished` once for that confirmed operation.          |
| Rejected        | A notice that the save was rejected                                | A new review is required before trying again.                   |

Confirmed success closes the dialog before calling `onPublished`. The native
Studio action uses Sanity UI's `useToast()` to show “Collection settings published.”
The same behavior applies when a status check confirms an uncertain save. A
notification failure cannot turn a confirmed save into a failed one.

Wire the redirect checkbox to `setCreateRedirects`. Changing it rebuilds the
review before another Publish is possible. Existing redirect destinations are
still updated when the checkbox is off; the checkbox only controls new redirects.

Pass `close` to the dialog's close callback. Closing a read-only check cancels the
local wait and prevents its late response from reopening the dialog. `dispose`
also stops notifications. Neither operation deletes a pending save record.

For a URL collision, the planner supplies the exact pathname and both documents'
registered titles and types from the checked inventory. The dialog shows that
path prominently and links the document rows to their native editors. These rows
sit on neutral cards inside the error notice and reuse the navigator's native
version/status indicators; they do not infer status from the conflict's version.
For a
release blocker, it identifies the release and affected document. Collection-item
rows show the published item's URL under the current published prefix, not the
release's slug or proposed prefix. If no published item exists, no live URL is
invented. Settings documents have no page URL subtitle. Studio's native
release store supplies the display name when available; otherwise the known
release identifier stays visible with an explanation. Optional enriched names
change only the display, never the publishing checks.

Redirect blockers show the affected rule's source → destination in the same
native row style. The explanation distinguishes unpublished redirect changes
from a proposed URL already used by an active redirect. The row opens the exact
affected version and reads native status indicators. If the checked inventory
cannot identify a record, the notice does not invent a link.

These details travel with the blocked result. The session does not rerun a
separate query to guess which conflict caused the block.

## Waiting and uncertain outcomes

Review and status checks have a 15-second UI wait limit. Publishing has a
30-second limit. These are limits on waiting, not proof that a server write failed.
The controller saves recovery information before sending a write. After a timeout
or thrown request, the session retains the attempted operation ID and checks that
specific save. An empty pending slot alone does not prove failure: another mounted
view might already have confirmed the save and cleared that slot. When a save
might have been sent, the editor gets receipt recovery instead of another Publish
button. If the original controller later reports that it stopped before sending,
that explicit result lets the session return to a retryable blocked state.
If the editor already closed the dialog, the session remembers that no write was
sent without reopening it or showing a notification. The next open can start a
fresh review. Recovery diagnostics alone never count as proof that nothing was
sent.

The controller's current `reconcile` method does not accept a cancellation signal.
Closing its dialog stops waiting for its answer; the read may still finish and
record confirmed success. Reopening can check that result. A missing receipt,
network error, or missing local record after a previously unknown result does not
prove rejection.

Pending saves are scoped to the project and dataset, not to the open collection.
The dialog can therefore recover a prefix change started from another collection
action. First-time or unchanged-prefix settings saves share this coordination
slot, but this prefix-change session does not describe them as URL moves. Their
owning workflow must check their result before another change starts.

The session checks the operation identity before announcing success and does not
attach another attempt's receipt to the original uncertain save. The controller
retains captured outcomes and supports checking a specific operation ID. If
another mounted view settles an older attempt and starts a newer one, this session
can check the older attempt without treating the newer result as its own.

## What remains before editors use this

The private native settings action selects this flow, supplies current Studio
state, connects callbacks and success toasts, and coordinates first-time and
unchanged-prefix publishing. The
[November 10 live checks](collection-settings-publication.md#current-acceptance-boundary)
verified same-prefix saves without a routine dialog, reviewed prefix moves with
and without new redirects, existing redirect updates, and the clickable notice
for an affected redirect draft.

The first-ever settings publish has not been tested live. Broader review still
includes custom-role permissions, additional conflicts, concurrent edits,
cancellation, timeouts, and reopening after a lost response. Component and session
tests cover these boundaries locally; they do not replace that acceptance work.
The fixture does not yet deliver HTTP redirects.
