# Pages release work

This plan divides the remaining Pages work into independently reviewable slices.
It records the parallel work approved on November 5, 2026. It is a work plan,
not a list of features already available in the published package.

## Remaining release checklist

Update this checklist after each slice approval and include the current list in
the approval handoff. Remove finished work from the remaining list; retain its
commit in the progress record below. A completed implementation remains separate
from a reviewed, committed slice and from live acceptance.

Last approved slice: documentation reconciliation (`2d10e96`, November 11, 2026), committed and pushed. Folder-import public API (`dfcaf4a`) is also committed and pushed. Navigator browser acceptance (`b11a35f`) is also committed and pushed. Public Studio integrations (`c3df9d5`) include automatic checked settings Publish and singular/plural settings navigation helpers. Routing (`dc6902d`) and redirect (`b8fd7ee`) API commits are also pushed with passing CI.
The preceding collection-prefix review dialog/session is committed as `9be3dfb`.
First and unchanged-prefix settings publishing (`96d50c7`) is also committed.
The data reviewer (`ded9f47`), URL planner (`5ffe637`), classification (`adcd4db`),
and native write/schema authorization (`dd1b9ee`) are also approved, committed,
and pushed. First and later publishing retain the shared prepare-and-recheck
pattern.

| Slice                                    | What remains                                                                                                                         | Status                                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| 1. Navigator rendering improvement       | Review the bounded row-rendering change and measured benefit for retained rows.                                                      | Staged; 69 tests and controlled browser comparison pass                                               |
| 2. Combined live and consumer acceptance | Finish restricted-account, real revision-conflict, uncertain-response recovery, packed end-to-end, and large-list transition checks. | Automated coverage and prior live evidence recorded; controlled recovery harness preparation underway |
| 3. Release preparation                   | Final verification, version/release notes, artifact review, CI, and explicit release approval.                                       | Pending preceding checks                                                                              |

Public APIs and the documentation reconciliation are committed. Navigator
measurements now show less repeated rendering for retained rows. Initial mount
and tree-to-search transitions still render large lists; their practical impact
remains in combined consumer acceptance, not a claim resolved by memoization.
The controlled recovery harness will supplement real-server/native-session
checks; it cannot replace an actual restricted-account check.

These are the remaining review checkpoints, not a promise that each must be one
commit. Split a checkpoint only when implementation or review establishes a
useful boundary, and record that change here. Publishing the release follows its
own approval after these checks are complete.

## Progress record

First settings publication and unchanged-prefix edits now have an approved guarded
writer (`96d50c7`), following the activation planner (`5ffe637`) and reader/recheck
(`ded9f47`). Both settings writers share exact-operation recovery and bounded
completed history. The reviewed dialog/session is now committed and pushed
(`9be3dfb`), including clear conflict rows and confirmed-save completion. Its
temporary Studio simulation has been removed. Native settings Publish integration
is committed and pushed as `98d5c08`, with passing CI. The proof Studio explicitly enables the
checked workflow with its shared live collection registration.

Live checks on November 10, 2026 verified a display-name-only save without a
routine dialog, `/articles` → `/stories` with a new redirect, and a repeat move to
`/stories-test` with new redirects turned off. The repeat move updated the
existing alias directly; it did not add an alias for the intermediate URL.
A temporary redirect draft blocked the move with a clickable exact-rule notice;
only that test draft was discarded through Studio. The tested article's complete
draft and published JSON remained unchanged. Settings and redirect changes
shared their transaction revision.

The checks also corrected a false block from unrelated draft redirect
destinations, allowed Sanity's root `_system` metadata while retaining nested
schema protections, and verified the new redirect details in the notice.
An isolated first-ever settings publish passed on November 11, including native
template creation, direct Publish, the success toast, and an exact write receipt.
Existing settings, item versions, and redirects remained unchanged. The temporary
settings and receipt were removed after verification. Custom roles, concurrency,
and recovery remain in broader acceptance. The approved fixture slice (`99f3f1a`) also
verifies saved redirects as real HTTP responses on a separate published listener
(port 3335), while Studio preview (port 3334) bypasses redirects. It adds no cache
backend or production preview authentication. Full evidence is in the
[settings publishing guide](collection-settings-publication.md#current-acceptance-boundary).

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
too. These foundations are now connected by the approved native settings Publish
integration. The committed public installer includes checked publishing automatically.

Public collection resolution/settings loading (`dc6902d`), generic HTTP/React
Router redirect APIs (`b8fd7ee`), and Studio integrations (`c3df9d5`) are committed.
The Studio installer automatically includes checked collection settings Publish,
subject to native permissions and validation. Singular/plural settings helpers
allow each settings document to be placed independently in Structure. Installed
native configurations pass both with Pages and standalone Structure.

Navigator acceptance (`b11a35f`) records browser checks in Google Chrome for
Testing and adds its isolated read-only harness. Narrow/extreme labels and a paginated
5,000-item collection passed. A 1,000-ordinary-page tree showed expensive renders
in both development and production-profiling builds. This baseline does not
claim that limitation is resolved. A separate targeted row-rendering improvement
is underway and will require its own behavioral checks and browser measurements.

The sync-only folder-import facade is committed as `dfcaf4a`, with its public export and guide.
Its 13 focused tests and full installed-package checks pass, including Sanity
client 7/8 types, uncertain-result handling, and execution without Studio or React.
A live import with the intended consumer credentials remains part of acceptance. The broader documentation reconciliation is
committed as `2d10e96`. The combined acceptance audit found substantial existing
automated coverage, with live restricted-account, two-session conflict, and
lost-response checks still outstanding. No production cache backend is required
by the kit.

## Parallel tracks

| Track                           | Current work                                                                                      | Review boundary                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Collection-prefix publishing    | Verify permissions, concurrency, recovery, and the connected native Publish flow                  | Proof Studio publishing is enabled; consumer release awaits acceptance           |
| Frontend redirects and caching  | Verify actual request handling, authenticated preview bypass, cache refresh, and failure behavior | The consumer owns storage and infrastructure; the kit supplies reusable behavior |
| Navigator acceptance and polish | Check keyboard use, narrow layouts, loading/error states, and larger collections                  | Fix observed problems without changing the approved visual design                |

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
native integration is staged with the live save and redirect checks recorded
above. First-ever settings publication and broader live acceptance remain
separate.

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
