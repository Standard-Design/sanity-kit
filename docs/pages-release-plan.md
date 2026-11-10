# Pages release work

This plan divides the remaining Pages work into independently reviewable slices.
It records the parallel work approved on November 5, 2026. It is a work plan,
not a list of features already available in the published package.

## Remaining release checklist

Update this checklist after each slice approval and include the current list in
the approval handoff. Remove finished work from the remaining list; retain its
commit in the progress record below. A completed implementation remains separate
from a reviewed, committed slice and from live acceptance.

Last approved slice: first-publication URL planner, `5ffe637`. The classification
(`adcd4db`) and native write/schema authorization (`dd1b9ee`) slices are also
approved, committed, and pushed.

| Slice                                    | What remains                                                                                                                                            | Status                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 1. First-publication data review         | Read complete data with verified access and recheck new, changed, or removed documents before publishing.                                               | Implemented; staged for review                              |
| 2. Collection-prefix dialog and session  | Show the reviewed changes, keep editor choices current, and handle pending, failed, or uncertain saves.                                                 | Implemented; final review underway; unstaged                |
| 3. First and unchanged-prefix publishing | Safely publish initial settings and ordinary settings edits that do not move URLs.                                                                      | Implementation underway                                     |
| 4. Native settings Publish integration   | Connect all three publishing paths to the Studio action, validation state, permissions, and recovery UI.                                                | Pending dependencies                                        |
| 5. Live collection-publishing acceptance | Exercise first publish, name-only edits, repeated prefix moves, redirects, conflicts, cancellation, and recovery in the real Studio and website.        | Pending integration                                         |
| 6. Final navigator acceptance            | Finish extreme-label/narrow-layout checks and browser performance measurements with larger lists; fix observed problems.                                | Pending                                                     |
| 7. Public API completion                 | Export the supported field, settings, folder-import, redirect, and routing integrations with clear consumer contracts.                                  | Audit complete; exports pending final contracts             |
| 8. Installed-consumer integration        | Test the packed package in consumer-owned Studio/app fixtures, including standalone fields, Pages, settings, and redirect middleware.                   | Existing package checks pass; new integrations still needed |
| 9. Combined release acceptance           | Verify the workflows together: permissions, concurrent edits, uncertain writes, preview/live routing, cache refresh, and supported dependency versions. | Pending integrated acceptance                               |
| 10. Release preparation                  | Reconcile guides and examples, prepare version/release notes, verify the final package and CI, and present the release for approval.                    | Pending preceding checks                                    |

These are the remaining review checkpoints, not a promise that each must be one
commit. Split a checkpoint only when implementation or review establishes a
useful boundary, and record that change here. Publishing the release follows its
own approval after these checks are complete.

## Progress record

The first parallel round is committed and pushed: empty-folder removal
(`d8a1ccf`), collection settings draft editing (`e13643f`), and redirect request
handling with optional consumer caching (`437540d`). The separate CI timing fix
also passed verification, coverage, and package checks on GitHub.

The collection navigation and explicit settings-ownership slice (`74ad993`) is
also committed and pushed. The pure folder-rename planner (`7d388c5`) is now
committed and pushed. Native redirect draft management (`18570b5`) is also
committed and pushed. Guarded redirect publishing (`0648541`) and the simpler
Publish/Delete workflow (`b6d7516`) are now committed and pushed too. The folder
rename writing and recovery slice (`148827e`) is also committed and pushed.
Shared collection routing sessions (`48e6adb`) and the plain-text URL input
option (`4bc5f53`) are also committed and pushed. Folder rename UI (`2627b13`)
and dual-perspective URL ownership checks (`1ac90dd`) are committed and pushed.
Live collection routing (`f51b428`) is also committed and pushed, with passing CI.
It connects settings to Pages, native locations, URL fields, and the proof website.
React Router redirect middleware (`783dfe9`) and navigator focus/label fixes
(`3cb9acb`) are now committed and pushed. The collection-prefix planning
checkpoint (`a922c54`), native read-access checks (`b3e2831`), and writer/recovery
core (`77b0fa2`) are committed. The guide-packaging fix (`afccbcc`) is committed
too. These foundations do not yet enable collection settings Publish: native
write/schema checks and the editor workflow still need integration.

## Parallel tracks

| Track                           | Current work                                                                                            | Review boundary                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Collection-prefix publishing    | Connect native write/schema checks, handle first and unchanged-prefix saves, and add the publish review | Keep native settings publishing blocked until the full workflow is safe          |
| Frontend redirects and caching  | Verify actual request handling, authenticated preview bypass, cache refresh, and failure behavior       | The consumer owns storage and infrastructure; the kit supplies reusable behavior |
| Navigator acceptance and polish | Check keyboard use, narrow layouts, loading/error states, and larger collections                        | Fix observed problems without changing the approved visual design                |

Implementation tracks use isolated checkouts or explicitly assigned files.
Completed work receives integration checks and a plain-language review in the
main checkout. A completed agent task is not permission to commit or publish it. Each slice still needs the
user's commit approval.

The November 9 round runs these three tracks together, with separate file
ownership. Each track can produce more than one reviewable slice; a planning
checkpoint does not enable publishing by itself. The coordinator integrates and
checks each completed result, then stages one slice at a time for approval.
Other completed work stays unstaged until its turn. No track commits or pushes
without approval.

The private [collection-prefix core](collection-prefix-publication.md) now
reviews changes, checks read access, and can publish reviewed settings and
redirects together through its required authorization callback. It saves
recovery information before sending the request and checks an exact receipt if
the outcome is uncertain. The native write/schema adapter is implemented; the
editor workflow still needs to connect it to publishing.

The November 10 round works on three separate areas:

- Complete native write and schema checks for the writer's exact action targets
  (now approved in `dd1b9ee`).
- Settle the settings Publish integration, including first publication, edits
  that keep the prefix unchanged, and review/recovery UI.
- Audit public exports and installed-consumer coverage. The source-only report
  is `docs/pages-public-api-readiness.md`; it separates usable package entries
  from private integrations and records the installation tests still needed.

The Studio dialog follows those foundations. Navigator browser performance and
extreme narrow-layout checks remain in the
[acceptance guide](navigator-acceptance.md).

The standalone proof website will not gain a perspective selector in this round.
Use Studio's existing Drafts/Published selector for acceptance. Public API and
documentation work accompanies the tracks, but final exports wait for the
publishing contracts to settle. Final release acceptance follows integration of
all three tracks.

## Completed parallel foundation round

The earlier three-agent round established the foundations below. Shared access
requirements, fixture configuration, integration checks, and staging remain with
the coordinating agent.

- **Redirects:** publish or retire a reviewed redirect draft, with fresh graph,
  access, version, and size checks. Save a receipt with the write so a lost
  response can be checked without resending it. The proof Studio now enables
  the private publishing option. Live first-publish, destination-update, and
  retirement checks passed; draft-only remains a separate consumer option.
  Normal Publish now runs these checks without a routine confirmation dialog.
  Native Delete remains available, with a clearer warning for active redirects.
- **Folders:** turn the approved rename plan into a bounded atomic write that
  changes only folder paths, page URL fields, and affected redirect destinations.
  Preserve unrelated draft content. The writer and recovery are implemented and
  tested. The navigator now exposes Rename, with
  explicit live-impact review, native write permissions, and recovery notices.
  A live test preserved distinct draft/published bodies while moving both URLs
  and updating redirects.
- **Collections:** share one settings-reading context between future Pages,
  URL-field, and preview integrations. Published and draft settings must stay
  separate. Loading or invalid settings must not silently use a made-up prefix.
  The private reading/session boundary is implemented and tested. A committed
  slice checks both published and draft URL spaces, including active redirects,
  using fresh settings and access evidence. Live Pages, input, native locations,
  and proof preview integration are also committed, including fresh guards for
  URL-changing actions. Reviewed collection-prefix publishing remains separate.

The folder and redirect writers share the policy below, but their operations
remain distinct: publishing a redirect intentionally publishes that draft;
renaming a folder must leave unrelated page draft edits unpublished. Neither
workflow promises to prevent new conflicting documents written after its checks.
Native form autosave and external writers are not covered by a global lock.

## Approved collection navigation decisions

These decisions are implemented in `74ad993`. Prefix loading and publication
remain separate.

- Add a collection `…` action menu with **Create item** and **Settings**.
  Use the configured item name in the creation label, such as **Create post**.
- **Settings** opens the collection's settings document in the current native
  editor pane while keeping the website preview in place. Only collections with
  a collection-level `settingsDocumentId` show this action. That document can
  expose a read-only prefix alongside an independently editable display name.
  Collection page registration uses `index`, replacing `overview`.
- Display names and URL prefixes independently support explicit **default** and
  **locked** values. Defaults seed new settings documents; locked values always
  come from code and appear read-only. A default prefix is never a fallback for
  missing published routing settings. Saved editable names update the native
  document heading and matching Pages labels without activating draft prefixes.
- The consumer explicitly registers eligible item types and templates. One
  eligible choice opens directly; several use the existing native submenu
  pattern. Reuse native permission checks and actionable failure feedback.
  Creation opens an ordinary draft and never auto-publishes it.
- The collection browse view's header `+` uses those same creation choices.
- Use a distinct native collection or stacked-document icon instead of the
  folder icon. Allow an optional consumer-supplied collection icon. Keep the
  existing expansion chevron, indentation, typography, spacing, and interaction
  states. Do not introduce a collection badge or special row background.

The implementation uses Sanity's `DocumentsIcon` and a Studio-only `collectionUi`
option keyed by collection name. Collection actions remain separate from ordinary folder actions;
they do not expose folder removal or folder renaming for collection groups.
Settings access and item creation can be reviewed before prefix publishing is
available. Merely editing a settings draft must not change live routes.

## Review checkpoints for the second round

The tracks can produce more than one commit-sized slice. Their first checkpoints
are deliberately explicit about what an editor can do:

- **Collections (committed):** the menu, native creation choices, settings navigation,
  and icon were reviewed in the proof Studio. Display configuration stays in the
  Studio layer; settings bindings come from the collection registration. Opening
  settings initializes a new settings draft through its native template.
  Loading draft/published prefixes throughout Pages and preview follows this UI
  checkpoint; displaying a Settings action alone does not provide that behavior.
- **Folders:** review a pure rename plan covering folder keys, every affected page
  version, and one combined redirect graph. The plan has no write side effects.
  A Rename control must wait for the guarded writer and recovery workflow; a
  successful plan alone does not prove permissions or safe concurrent writes.
- **Redirects:** review native rule browsing, validation, and draft editing as an
  explicit opt-in. Existing read-only integrations keep their behavior. Guarded
  publishing and retirement follow the editor checkpoint; normal Publish must
  not be restored before those checks exist.

The completed first-round commits all passed GitHub CI. Review each new
checkpoint with focused checks, integration checks, and live UI acceptance when
it introduces editor controls. Consumer cache storage remains consumer-owned;
building a concrete backend is not a package release requirement.

## Shared rules for URL changes

Folder renames and collection-prefix publication depend on the same redirect
rules. Before implementing their writes, agree on a shared bulk plan and its
review data. Reuse the existing single-page checks where their assumptions fit;
do not implement a bulk move as repeated single-page writes.

The existing decisions remain the baseline:

- Review the complete old/new URL pairs and live impact before applying changes.
- Keep collection item slugs unchanged when their collection prefix changes.
  Independently located index page and listing pages keep their own URLs.
- A folder rename updates only URL fields in affected page versions. It never
  publishes unrelated draft content or overwrites a conflicting planned URL.
- Refuse affected release versions until release-aware handling is implemented.
- Check route reservations, page ownership, redirect conflicts, read access,
  revisions, and tested size limits against fresh, complete evidence.
- Existing redirects that need to follow a move point directly to the new URL.
  Preserve their other fields and block conflicting unpublished redirect edits.
- Commit supported dataset changes together. Do not silently split a large move
  into partially applied batches.
- Reconcile an uncertain write before retrying. Do not turn a timeout into an
  assumption that the operation failed.

The first bulk implementation must also settle coordination between concurrent
kit writers and test stale query results and newly created document versions.
Revision checks protect reviewed records; they do not provide a database-wide
uniqueness constraint against external writers.

The planning review identified an important integration gap: URL-field autosave
currently uses native form patches, and native templates can initialize URLs.
Neither happens in the same transaction as a kit coordination record. Adding
such a record only to bulk writers would therefore not coordinate all kit URL
changes. The writer checkpoint must settle and document its actual guarantee
before enabling folder renames; it must preserve the approved native editing
experience.

These are shared behavioral requirements, not a new exported TypeScript API.
See [Pages decisions](pages-design-proposals.md),
[URL editing](url-field.md), and [redirect design](redirects-design.md) for details.

## Dataset changes and website caches

A successful dataset write and a refreshed website cache are separate outcomes.
The Studio cannot directly clear arbitrary consumer infrastructure. Consumers
connect an authenticated publication signal to their own refresh mechanism.

Redirect handling must distinguish no matching rule from a failed load or invalid
snapshot. Preview traffic bypasses published redirect handling. Cache adapters
must preserve project/dataset isolation and validate stored data. An adapter owns
expiry and the barrier that prevents an old in-flight load from undoing a newer
invalidation. No Cloudflare dependency is required.

If a dataset change succeeds but cache refresh fails, report the change as saved
and refresh as pending. Retry the refresh, not the content mutation. A simple
cache adapter alone does not promise an instantaneous website-wide URL cutover.

## Integration and release gates

Public exports follow implementation review. Keep Studio code in the Studio
entry point and frontend code independent of the Studio runtime. Consumers keep
their own Studio installation and application route structure.

Before release:

- Test the combined folder, settings, URL, redirect, and cache workflows.
- Review error messages and recovery in the live proof Studio.
- Verify permissions, concurrent changes, uncertain responses, and size limits.
- Check navigation, keyboard behavior, narrow layouts, and larger collections.
  Add virtualization only if measured behavior calls for it.
- Verify public APIs from an installed package in a consumer-owned Studio and
  application, including preview, links, route lookup, and sitemaps.
- Reconcile subsystem docs, examples, release notes, and package checks with
  what actually ships.

Release-aware URL changes, removal of populated folders, document-free collection
index pages, multisite configuration, and arbitrary creation-template parameters
remain deferred. They are not prerequisites for this release.
