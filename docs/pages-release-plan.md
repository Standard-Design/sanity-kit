# Pages release work

This plan divides the remaining Pages work into independently reviewable slices.
It records the parallel work approved on November 5, 2026. It is a work plan,
not a list of features already available in the published package.

The first parallel round is committed and pushed: empty-folder removal
(`d8a1ccf`), collection settings draft editing (`e13643f`), and redirect request
handling with optional consumer caching (`437540d`). The separate CI timing fix
also passed verification, coverage, and package checks on GitHub.

The collection navigation and explicit settings-ownership slice (`74ad993`) is
also committed and pushed. The pure folder-rename planner (`7d388c5`) is now
committed and pushed. Native redirect draft management is the current review;
settings-aware collection routing and the bulk writer remain separate work.

## Parallel tracks

| Track       | Next work                                                        | Follow-up work                                                                  |
| ----------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Folders     | Reviewed folder renames, including affected pages and redirects  | Bulk-move recovery and integration acceptance                                   |
| Collections | Connect settings to Pages, URL fields, and preview               | Review and publish prefix changes                                               |
| Redirects   | Native redirect management: find, create, edit, and retire rules | Consumer request integration and cache refresh acceptance                       |
| Integration | Coordinate shared bulk-change contracts and review each slice    | Navigator polish, public exports, consumer installation, and release acceptance |

Implementation tracks use isolated checkouts or explicitly assigned files.
Completed work receives integration checks and a plain-language review in the
main checkout. A completed
agent task is not permission to commit or publish it. Each slice still needs the
user's commit approval.

Collection navigation and settings resolution can proceed alongside folder-move
planning and redirect management. Folder renames and collection-prefix publishing
must agree on the shared bulk-change rules below before implementing writes.

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
