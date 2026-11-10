# Checking access before publishing collection settings

This is a private integration guide. The adapter described here is not wired into
Studio's Publish button and is not exported for consumers yet. It completes the
authorization part of the [collection-prefix writer](collection-prefix-publication.md).
The review dialog and publishing workflow still need integration and live testing.

## What it checks

A review answers “which URLs and redirects would change?” This adapter answers a
different question: “can this editor publish these exact documents, and do the
documents satisfy the Studio's rules?” Both answers are required.

`createNativeCollectionPrefixWriteAccess` returns the writer's `authorize`
callback. It takes the active workspace, its current user and native grants store,
and a Sanity client for the same project and dataset. It uses Sanity's own document
permission checks and `validateDocument`; it does not maintain a list of allowed
role names. An editor with a custom role can pass when their actual grants permit
the work.

The caller must supply all of these from the same active Studio workspace. The
adapter checks client and request scope, and verifies the client used by custom
validators belongs to that scope too. A grants store is an opaque native service;
it must come from that workspace's `useGrantsStore`.

The callback returns a result for every target:

- **Granted:** the necessary permission and schema checks passed.
- **Missing:** a native permission check denied the operation.
- **Protected:** a read-only rule or schema validation error prevents the change.
- **Unverified:** the checks could not be completed. Examples include lost access
  to a document, a changed revision, a throwing validator, or an unsupported
  conditional rule.

The writer sends nothing unless every target is granted. Warning-only validation
does not block, matching ordinary Studio publishing. Validation exceptions and
unrecognized results never count as success. Sanity schema validation is
[client-side](https://www.sanity.io/docs/studio/validation), so it must run before
the Actions request; the server does not enforce Studio validation rules for us.

## Check the whole action sequence

Publishing a settings draft uses the same three permission checks as native
Publish: update the current published document, update the draft that publishing
will remove, and create the proposed published document from that draft. Checks
receive full document values, including metadata used by conditional grants.

The first settings draft has no published version to update. Its atomic
strict-create transaction needs permission to create the proposed published
document and remove the draft. The adapter checks the same transformed document
the writer will send, including native reference strengthening. Unchanged-prefix
settings still use the ordinary Actions Publish checks above.

For an existing redirect, the adapter first loads its complete published document
through the uncached Document API. Its revision must match the review, and there
must not already be a redirect draft. This keeps conditional rules and extra
fields outside the routing projection in view. The adapter then checks creating
the temporary draft, editing it, and publishing the result. Only its destination
changes. A new redirect needs permission to create its draft, remove that draft
when publishing, and create the published version.

These are native `create` and `update` permissions. Sanity's Studio uses `update`
for the draft-removal part of Publish; there is no separate `delete` check here.
The server remains the final authority when the Actions request runs. Repeating
native grant checks reevaluates the exact document values, but Studio's grants
store can reuse its loaded ACL response; this is not a promise to refetch that
response on every check.

## Read-only settings and validation

Publishing includes the whole settings draft, not only the prefix. The adapter
therefore validates that complete draft against the active workspace schema,
including custom validators and reference checks. It does the same for proposed
redirects.

It compares the old and proposed values before checking field `readOnly` rules.
An unchanged collection identifier or locked display name does not block
publishing another field. Changed or removed values do need to be editable.
Conditional rules run with both old and proposed document contexts, including the
current user, parent, value, and field path. A draft cannot turn off its own lock
and then use that changed context to authorize itself.

The comparison supports named object fields, primitive arrays, keyed object
arrays, and native reference controls. Moving a read-only array member is also
protected. Unknown changed field schemas, ambiguous array members, duplicate
array keys, and object type changes return unverified rather than being guessed
at. As with Studio's conditional properties, `readOnly` callbacks must be
synchronous. A promise or unexpected return value is not accepted.

For first-time settings, publishing retains fields already present in the saved
draft, including initialized read-only identifiers and custom fields. It does not
treat those initialized values as edits to a previous published document.
Document-level `readOnly` and complete schema validation still apply. The adapter
also verifies the registered collection, singleton ID, draft revision, and stored
locked values against configuration. A locked value may be absent from storage
when configuration supplies it; a conflicting stored value is blocked.

The kit may initialize the immutable `origin: "url-change"` value when it creates
a generated redirect. That exception does not permit changing the origin of an
existing redirect. Document-level protection still applies.

## Confirmation records

The writer creates a small internal receipt in the same transaction as the
settings and redirects. The adapter checks exact published and draft receipt
read access using the existing [read-access helper](collection-prefix-access.md).
It also checks native creation and publishing permissions for both identities.
First-time settings use a directly created published receipt instead. That path
checks only the receipt identity actually created and its creation permission;
it does not require access to a temporary receipt draft that will never exist.

Receipts have no editor form schema. The only schema exception is the exact
internal receipt type, generated identity, and allowed fields expected by this
writer. An arbitrary document cannot use that exception. Receipt reads and writes
are required even if the editor declines new redirects, because recovery still
needs to determine whether settings were published.

## Failure and timing boundaries

All checks are read-only. A changed or missing redirect, failed request, denied
permission, or unresolved validator prevents dispatch. Retrying the review runs
the checks again; it does not grant a previous result permission to write.

One authorization call has a ten-second deadline, covering all targets together.
Cancellation and that deadline return unverified, cancel native requests and
validation, and unsubscribe from grant streams. A custom validator that ignores
cancellation cannot leave the dialog waiting indefinitely or later authorize the
request. Larger inventories or slow custom validators may need a later review of
this bound; the adapter never skips remaining targets to fit the deadline.

Documents loaded for redirect checks are capped at 1 MiB each. The writer also
has its own inventory, settings, and transaction limits. These are implementation
bounds, not Sanity service limits.

The adapter does not lock the dataset. The writer's revision guards protect its
settings and changed redirects, while unrelated concurrent URL writes can still
race the final inventory read. See the writer guide for that distinction.

## Verification still needed

Automated checks cover native validation, scoped permission results, read-only
fields and nested values, exact receipt access, stale redirects, cancellation,
and time limits. The installed Sanity implementation is the reference for the
native Publish permission sequence. This still needs live acceptance with
custom roles and the complete Studio publishing workflow before release.
