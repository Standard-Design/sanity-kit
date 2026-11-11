# Publishing collection settings in Studio

This private integration connects the collection settings form to the guarded
writers. It chooses the right workflow when an editor clicks **Publish**: publish
ordinary settings directly, or review a change that moves existing item URLs.

Publishing is still disabled by default. The internal `_enablePublication` gate
must be enabled explicitly. The proof Studio enables it, and live checks on
November 10, 2026 verified same-prefix saves and repeated prefix changes, as
recorded below. Ordinary installation keeps it off. These helpers are not public
package exports, and broader Studio acceptance remains ahead. The gate is not
a release-ready consumer option.

## What an editor does

Editors continue to change settings in the normal form. Draft changes autosave.
In Pages, refreshing collection routes after an edit keeps the settings document
open. The preview may refresh or show no page at its old URL, but that refresh
does not select another document. Choosing another document or navigating the
preview to a different path restores normal page-to-editor navigation.
The collection identifier stays read-only, and settings locked by configuration
stay read-only. See [collection routing](collection-routing.md) for defaults,
locked values, and the relationship between a prefix and an item's stored slug.

When publishing is enabled, the action distinguishes three cases:

| Change                           | What happens after Publish                                                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| First settings publication       | The kit checks the saved draft and, for an editable prefix, the URLs that will become available. If the checks pass, it publishes without a routine confirmation dialog. |
| Same effective prefix            | The kit checks and publishes the complete settings draft. A display-name change is an example. No item URLs move.                                                        |
| Existing editable prefix changes | A review dialog shows the old and new prefix, affected live item URLs, and redirect updates. The editor chooses whether to create new redirects, then confirms Publish.  |

A code-locked prefix already comes from configuration. Publishing its first
settings document does not activate new URLs, so that path does not need the
first-activation inventory scan. A configured default is different: it seeds a
draft but never substitutes for missing published settings.

All three paths publish the **whole settings draft**, including any display-name
or consumer-added field changes. Collection items keep their slugs and content.
Their drafts are not published. Independently located index and listing pages
keep their own URLs.

If a check fails, the editor sees a notice instead of a write. Where another
check can help, the notice offers Retry. That starts a fresh check; it does not
bypass validation or repeat an uncertain write. The prefix-change dialog is
described in [reviewing a collection URL change](collection-prefix-dialog.md).

## Installing the private integration

The source-only workspace wrapper is
`withCollectionRoutingSettings` in `src/studio/collections/settings.tsx`.
The proof Studio passes its shared live collection registration to the wrapper
and enables the gate explicitly. The same registration drives its Pages tool,
URL fields, and preview website:

```ts
const studio = withCollectionRoutingSettings(workspace, {
	routes: proofLiveCollectionRouting,
	_enablePublication: true,
})
```

Omitting `_enablePublication` keeps the existing draft-only behavior: the settings
form explains that publishing is unavailable, and its action list retains only
native draft discard. Enabling the gate removes that draft-only notice and
installs the guarded Publish action. It does not make settings deletion,
unpublishing, duplication, or release publishing available.

Apply the wrapper to the completed workspace configuration, after its tools,
plugins, and application action customizations are defined. It preserves the
application's action reducer, then applies the final settings-specific filter.
Other document types retain their customized actions.

A plugin-only action reducer is not sufficient. A later tool or workspace reducer
could otherwise restore an unguarded Publish action. The wrapper keeps at most
one Publish action, wraps it with the guarded handler, and retains draft discard.
For non-draft settings contexts, it retains only draft discard.

The settings layout also checks the resolved action list. It recognizes actual
kit-wrapped components for the same routing configuration, rather than trusting
an action's label or a public boolean flag. If an unsupported action survives,
the layout raises a configuration error. Do not replace the final action reducer
after wrapping the workspace.

## How the native action is preserved

`createCollectionSettingsPublishAction` in
`src/studio/collections/settings-publication-action.tsx` wraps the existing native
Publish component. It uses the native component's result for availability and
action metadata, including its normal label and shortcut. It never calls the
native Publish handler, because that would bypass the kit's writers.

A new write requires native Publish to be available, a registered settings
document, and an ordinary draft editing context. Live-edit, release, and version
contexts cannot start this workflow. Local document changes must have finished
syncing, and validation must have finished for the exact current draft revision
with no errors. Missing or outdated validation does not count as success.

The action supplies current Studio state through a callback, rather than keeping
an old render snapshot. The session checks it again before sending, and the
writer separately rereads its evidence and repeats authorization. Changing the
redirect checkbox also rebuilds the prefix review before Publish is available.

Native action availability is only one check. The installed adapters also prove
the required [read access](collection-prefix-access.md), run the workspace's
schema validation, honor read-only rules, and check native document grants for
the exact proposed writes. They do not grant access based on role names. Sanity's
server remains the final authority. Details are in the
[write-access guide](collection-prefix-write-access.md).

## Which parts own the work

The action selects the workflow and connects it to Studio. It does not build
transactions itself.

- `settings-publication-session.ts` owns first-time and same-prefix saves. It
  prepares and rechecks behind one Publish click; failures and uncertain outcomes
  open notices.
- `prefix-publication-session.ts` owns existing-prefix reviews and the editor's
  redirect choice.
- `settings-publication-write.ts` and `prefix-write.ts` own permissions,
  revision guards, the actual write, and its confirmation record.

The action creates these owners for the current document and workspace services.
It disposes them when that ownership changes. React development Strict Mode's
effect replay does not prematurely dispose an owner that is still mounted.

The writers share the prepare-and-recheck lifecycle. First settings use an atomic
strict-create transaction; existing settings use guarded Actions requests. See
[collection settings publishing](collection-prefix-publication.md) for the
transaction details, supported limits, and remaining concurrency boundaries.

## Confirmation and uncertain results

While a review or notice dialog is open, the underlying Studio action stays
labeled **Publish** and disabled; the dialog shows the current progress and
available actions. Normal settings saves that need no dialog still show
**Checking…** and **Publishing…** on that button. An active write's saved recovery
record does not change its label to **Check publish status**. That label is for
an unresolved attempt after its dialog closes, or an attempt recovered when the
action mounts again.

After confirmed success, the action shows a native success toast saying
**Collection settings published** and calls the document action's `onComplete`.
A successful save is not inferred from a new prefix appearing in the form.
The writer needs a matching transaction response or its exact confirmation record.

If a response is lost, the action offers **Check publish status**. This checks the
previous attempt and never sends it again. Recovery remains available even if
the current draft has disappeared or native Publish is disabled. That exception
allows a read-only status check; it does not authorize a new write.

First-time settings, same-prefix saves, and prefix moves share one pending slot
per project and dataset in the current JavaScript process, backed by the tab's
recovery storage. An uncertain save blocks another kit-managed collection
settings write. The action routes a saved attempt to the matching recovery owner,
even when the open settings document is no longer publishable.

Waiting is bounded: review and status checks have a 15-second UI limit, and a
publish wait has a 30-second limit. Reaching a limit does not prove failure.
Closing a notice does not discard recovery evidence. A late result is matched
to its own operation, so it cannot settle a newer pending save. The default
storage survives a same-tab reload; this is not a cross-tab or dataset-wide lock.

## Current acceptance boundary

Automated component and session tests exercise workflow selection, native action
availability, current validation and revision checks, retries, pending recovery,
late results, and successful confirmation. They do not establish live server or
Studio behavior.

Live checks in the enabled proof Studio on November 10, 2026 verified:

- A display-name change to **Stories** published without a routine dialog while
  keeping the effective prefix unchanged.
- A reviewed move from `/articles` to `/stories` published and created the
  redirect `/articles/routing-proof` → `/stories/routing-proof`.
- A temporary draft of that redirect blocked the next prefix change. The notice
  identified the exact redirect in a clickable native row. Only that test draft
  was discarded, using Studio's native action.
- A repeated move from `/stories` to `/stories-test`, with new redirects turned
  off, updated the existing `/articles/routing-proof` redirect to
  `/stories-test/routing-proof`. It did not create a `/stories/routing-proof`
  redirect. The settings and updated redirect shared the transaction revision.
- The tested article's complete draft and published JSON remained identical to
  their values before these checks. Publishing settings did not publish or
  rewrite either item version.

The first-ever settings publish was **not** tested live. That remains necessary,
along with custom-role permissions, wider validation and conflict cases,
concurrent edits, cancellation, and recovery after a lost response. Automated
tests cover those boundaries locally; they do not replace live acceptance.

The fixture saves redirect records but does not serve them as HTTP redirects.
The consuming app must load the rules, resolve published and draft routing
settings correctly, and refresh any consumer-owned caches. Installing this
Studio action does not implement those frontend responsibilities or announce
a package release.
