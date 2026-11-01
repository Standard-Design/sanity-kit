# Pages proof: acceptance record

This record separates observed behavior from implementation and automated tests.
It is not a claim that the finished Pages plugin is available.

## Environment

- Test project: Standard Stack, `ha9kep4l`, dataset `development`, authorized by
  Austin for tool development. No existing app documents were edited.
- Fixture Studio: `http://localhost:3000`, using the project's existing CORS
  entry. Port 3333 was occupied and left untouched. The initial attempt on 3335
  was rejected by Sanity; no CORS changes were made.
- Local preview: `http://localhost:3334`. The existing app read token was used
  only in the server process; it was not printed, copied into source, or bundled.
- Sanity 6.16.0, Sanity UI 4.4.10, React 19.3.0, Node 24.21.0.
- Live checks: October 25–26 and October 29, 2026. The October 29 follow-up
  rechecked picker and narrow-layout interactions. Iframe click/keyboard
  automation remains blocked; Austin performed the iframe clicks, and the
  resulting preview, picker, and selected-document state was inspected separately.

## Automated evidence

- `pnpm verify`: passed; 420 tests, including 23 new proof tests.
- Studio build: passed with the test project's public configuration.
- `pnpm test:package`: passed all five existing consumer profiles, declarations,
  runtime checks, TypeGen workspace, and the 52-file inventory. This checks the
  existing package, not a released Studio-plugin candidate.
- The new tests cover invalid paths, preview-page identity, search surviving
  navigator unmounts, picker selection/dismissal, Escape/focus return, native
  create-intent arguments, pathless selection, and subscription cleanup.
- These React tests mock the Presentation hooks. They do not prove the real
  iframe, native creation/publishing, or permission enforcement.

## Live checklist

| Check                                                         | Observed result                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authenticated Studio and native Presentation shell            | Passed. Native navigator, iframe, editor, document fields/actions, and header controls rendered.                                                                                                                                                                                                                                                                             |
| Sidebar selection                                             | Passed. About and nested Team opened in the native editor.                                                                                                                                                                                                                                                                                                                   |
| Picker and sidebar use the same browser state                 | Passed October 29. Search survived switching layouts. Picker scroll at 287px survived a roundtrip through a taller sidebar whose list needed no scrolling.                                                                                                                                                                                                                   |
| Picker selection                                              | Passed. Team selected, picker dismissed, sidebar stayed closed, focus returned to the trigger.                                                                                                                                                                                                                                                                               |
| Preview navigation initiated by the browser                   | Passed after adding the frontend history adapter: Team appeared in the iframe at `/about/team`.                                                                                                                                                                                                                                                                              |
| Header placement                                              | Initial layout crowded controls; corrected layout visibly retained navigator toggle, Edit, refresh, address, open-preview, viewport, sharing, and picker controls.                                                                                                                                                                                                           |
| Live query updates                                            | Seeded documents appeared without manually reloading the list. Listener visibility was changed to `query` to avoid fetching before a change became query-visible.                                                                                                                                                                                                            |
| Reverse navigation from an iframe link                        | Passed October 29 with a user-performed iframe link click. From About, Austin clicked Team in the preview; the iframe URL/heading, Choose page label, and native editor all changed to Team.                                                                                                                                                                                 |
| Shared-content overlay click preserves preview page           | Passed October 29 with a user-performed footer overlay click. The native editor opened the shared footer's body field; the preview URL/heading and Choose page label remained Team.                                                                                                                                                                                          |
| Shared-content reference preserves preview page               | Passed on October 26 through the native reference link. The shared footer opened in the editor while the iframe and picker still identified Team. This does not substitute for an overlay-click check.                                                                                                                                                                       |
| Native creation with no pathname                              | Passed on October 26. A native-generated draft ID saved a title without a pathname. The prior Team preview remained visible, the header explained the unavailable preview, and the draft appeared in the picker.                                                                                                                                                             |
| Escape, outside click, reopening sidebar, keyboard navigation | October 29: selection, Escape/focus return, and Studio-shell dismissal passed. Tab initially escaped an empty-results picker; after adding focus containment, forward/reverse Tab wrapping passed with matching and empty results. Iframe dismissal passed again after the fix with a user-performed blank-preview click; Team remained the previewed and selected document. |
| Narrow layout and resizing                                    | Passed for the proof on October 29. Native narrow-layout tabs were exercised. Dragging the navigator from about 291px to 420px and down to its 240px minimum preserved the Team preview/editor and native controls. This is not a full responsive/accessibility audit.                                                                                                       |
| Perspectives, publication, permissions, history               | Pending live. No permission-denied or release-perspective claims yet.                                                                                                                                                                                                                                                                                                        |
| Alternate `route` field                                       | Passed through the native URL field on October 26. `/alternate` rendered and, after the asynchronous lookup completed, Sanity selected the `kitProofLanding` document. An immediate snapshot before resolution still showed the previous editor; this was not the final state.                                                                                               |

The A1 exit gate is **complete as of October 29**. Selection, native creation,
reverse navigation, shared-content overlays, cross-layout scroll, resizing,
keyboard wrapping, and post-fix outside-click dismissal have passed. This clears
the integration proof for the next implementation slice, not for release. The
eventual A5 compatibility, permission, and accessibility checklist will be broader.

## Routing-foundation follow-up

On October 26 the fixture switched from hand-written route mappings to the
internal shared registry described in [ROUTING.md](ROUTING.md). No additional
dataset writes were made for this slice. The existing live observations above
remain evidence for the original proof, not automatic re-verification of every
interaction after this change.

- The real Studio loaded the registry and compiled-schema checks without an
  error, and its browser identified the current collection item.
- Read-only Content Lake queries using the final generated resolvers returned
  the alternate-path and Post 2 fixtures' IDs and types under the drafts
  perspective. The Studio eventually showed the alternate page in both its
  preview and native editor after navigation through the native URL field.
- Local tests execute the generated GROQ against synthetic documents, including
  alternate fields, incomplete records, excluded paths, collection boundaries,
  duplicate URLs, and keyword-like field names. This is not a replacement for
  live iframe-link, overlay, perspective, or permission acceptance.
- `pnpm verify`: passed with 500 tests in 20 files (80 new tests in this slice).
- `pnpm studio:build`: passed with the test project's public configuration.
- `pnpm test:package`: passed all existing consumer profiles and the TypeGen
  workspace. The 52-file package inventory excludes the unreleased Studio
  source and has no `/studio` export. This is not a Studio-plugin release test.

## Documentation follow-up — October 28

Added the [Pages subsystem guide](../../../docs/pages.md), linked it from the
READMEs and routing guide, and expanded routing source comments. The guide
explains the current architecture and records the approved navigator, folder
picker, and rename-modal designs as future work. No routing behavior changed in
this documentation follow-up, and no additional live checks or dataset writes
were performed.

- Focused registry, resolver, and proof-model tests: 98 passed in three files.
- Formatting and local documentation-link checks: passed.
- Package verification: passed all five consumer profiles and the TypeGen
  workspace. The inventory is now 53 files because it includes `docs/pages.md`;
  it still excludes Studio source and has no `/studio` export.

## Live follow-up — October 29

The Studio and loopback preview were restarted against the same authorized test
dataset, using the existing server-side read token. No document fields were
edited, created, or published during this pass.

- Search for About survived closing the navigator and opening Choose page.
- Typing a specific page title, pressing Tab, then Enter selected About. The
  preview URL and heading became About, the picker closed and returned focus,
  and the native Structure tab showed About's title, pathname, and body.
- Escape closed the picker and returned focus. A list scrolled to 287px restored
  that position after reopening. This tests picker reopening, not cross-layout
  scroll transfer.
- Clicking outside in Studio dismissed the picker. The modal picker consumed
  the first click on the navigator toggle as dismissal; the next click opened
  the navigator. This detail must inform the final header/picker interaction.
- Native accessibility clicks, screenshot-coordinate clicks, and a frame-scoped
  locator could all identify the iframe's About link but could not activate it.
  Frame-scoped keyboard activation also failed before delivering input. These
  tool failures are not evidence that website navigation or overlays fail.
- Austin then clicked Team in the preview's link list while About was selected.
  The iframe moved to `/about/team`, the picker identified Team, and the native
  Structure tab showed Team's document and fields. This passes reverse
  navigation through a real user-performed iframe link click.
- Austin clicked the shared footer's edit overlay on Team. The Studio route
  opened `kitProofShared/XCVfQiHlQYx1rGNar3CpZy/body`; the native editor showed
  the shared footer's fields while the iframe remained `/about/team` and Choose
  page still identified Team. No values were changed.
- The picker was reopened with Team in both the preview and editor. Austin
  clicked a blank area of the website preview; Choose page collapsed, its dialog
  disappeared, and both the preview URL and native edited document stayed Team.
  This passes iframe outside-click dismissal for the current modal picker.
- Dragged the native navigator from about 291px to 420px and down to its 240px
  minimum. Team remained the previewed and edited page; native controls remained
  available, although the address control became compact at the wider setting.
- Picker scroll at 287px survived closing it, opening the taller sidebar (where
  the list fit without scrolling), then reopening the picker. A clamped sidebar
  scroll position did not overwrite the saved picker position.
- Keyboard checks found a real defect: Tab could leave the modal picker when
  search had no results. Sanity UI's modal layer blocks pointer interaction,
  not keyboard focus. The adapter now uses the public `react-focus-lock` library,
  also used by native Studio search; it is a direct development dependency only.
- After the fix, Tab from an empty search result wrapped to Create page, and
  Shift+Tab wrapped back to Search. With one matching page, Tab from that last
  row wrapped to Create page and Shift+Tab returned to the row. Enter selected
  Team and returned focus to Choose page. Escape also closed and returned focus.
- Three regression cases exercise focus containment with loaded, empty, and
  loading results. They use the real focus library and popover. JSDOM supplies
  visible anchor/viewport geometry because its default zero-sized layout would
  make Floating UI hide the popover; live checks separately verify real Tab keys.
- After the focus fix, the picker was reopened and its expanded state confirmed.
  Austin clicked blank preview space. The dialog disappeared, Choose page's
  expanded state became false, and both the Team preview and selected Team
  document ID remained unchanged in the Studio URL. This completes the A1 gate.

Verification after the focus fix:

- All 503 tests in 20 files passed, including the three new focus-containment
  cases. Formatting, lint, typecheck, package build, and Studio build passed.
  The checks were run directly with Node 24 after the sandboxed `pnpm` script
  launcher stalled; no passing `pnpm verify` invocation is claimed for this pass.
- Package checks passed all five consumer profiles and the TypeGen workspace.
  The 53-file inventory still excludes Studio implementation and has no
  `/studio` export. No package was published or deployed.
- Frozen dependency installation completed with normal supply-chain checks.
  An initial offline attempt lacked registry metadata; retrying with registry
  access succeeded without bypassing the checks.

## Reusable plugin foundation follow-up — October 29

The fixture now registers `pagesTool()` from `src/studio/index.ts`. The browser,
header, state provider, and query model moved out of the fixture; the fixture
keeps its own schemas, route definitions, and preview app. Local distributions
now expose `/studio`; nothing has been published and consumers still own their
Studio application and installation.

The baseline changed to Sanity 6.17.0 and React/React DOM 19.3.1. Sanity UI 4.4.10,
styled-components 6.5.3, and react-focus-lock 2.13.7 remain the development pins.
The CLI and Portable Text peer mismatches are resolved. One development warning
remains for workflow-blueprint's TypeScript 6/7 peer against repository TypeScript
5.9.3. The candidate's Sanity peer is exact; shared UI peers use caret ranges.
An initial exact styled-components peer caused the strict frontend consumer to
fail when Visual Editing resolved a newer compatible minor; the caret range
fixes that without changing the frontend's dependency choices.

New live observations (not a replay of every A1 check):

- Studio loaded the extracted plugin without a configuration error and retained
  the native header controls and narrow Presentation/Structure tabs.
- With no search matches, Tab wrapped to Create page and Shift+Tab returned to
  Search. The new plugin retains the A1 focus fix.
- Selecting About with Enter closed Choose page, returned focus to its trigger,
  and changed the preview URL and native Structure document to About. The native
  editor showed About's title, pathname, and body fields.
- Opening the shared footer through About's native reference link displayed the
  shared document and its fields while the iframe heading, preview URL, and
  Choose page label remained About. No field values were changed. This is a
  native-reference smoke check, not a new iframe overlay-click test.

The complete A1 record above applies to its original dependency baseline. This
follow-up is a focused extraction smoke test; permissions, release perspectives,
the final navigator UI, and the full compatibility matrix still need later work.
No document fields were edited or new documents created in this follow-up.

Verification for this foundation:

- All 515 tests in 21 files passed, including 12 plugin configuration/composition
  cases added to the existing routing and adapter tests. Coverage also passed.
- Formatting, lint, typecheck, package build, and the real fixture Studio build
  passed on Node 24. The dependency lockfile passed a frozen install.
- All five existing packed frontend profiles passed, including the strict
  Standard Stack installation. Minimal consumers installed none of the new
  Studio peers; full profiles did not install Sanity. Ordinary browser bundles
  contained no Studio implementation or Studio UI dependency code.
- The new separate Studio consumer installed the tarball with strict peers,
  compiled its `pagesTool()` usage with `skipLibCheck`, and bundled the plugin
  with native Studio JavaScript and CSS. This is build/type evidence, not a full
  installed-package live UI acceptance run.
- TypeGen workspace checks passed. The packed inventory is now 71 files and
  includes the opt-in Studio implementation; test fixtures are still excluded.
  These local test artifacts reuse the current version label and were not
  published, tagged, or uploaded as releases.

## Navigator data foundation — October 29, 2026

This slice adds private data helpers without changing the live browser. The
sidebar and picker still use the bounded proof list. None of the observations
above establish acceptance for the future tree, collection browser, or statuses.

- `pnpm verify` passed: formatting, build, lint, typecheck, and all 555 tests in
  23 files. The 40 new tests cover inferred ancestors, named index children,
  collection grouping, missing/duplicate overviews, invalid paths, stable IDs,
  query field mappings, five-item previews, cursor boundaries, literal search,
  complete ordinary-page batch reads, errors, and aborts.
- `pnpm test:package` passed the five frontend profiles, isolated Studio
  consumer, declaration checks, and TypeGen workspace. The inventory is 77 files;
  no new public export or dependency was added. The local tarball was not published.
- Query tests execute GROQ against synthetic records, including a collection
  larger than two batches and ordinary pages requiring three requests. They
  verify query results, not Content Lake's authentication or perspective engine.
- Effective-perspective records are assumed at the helper boundary. Raw version
  IDs are rejected; original version metadata is retained without treating it as
  publication status. Actual draft/release precedence and native status display
  still require live integration checks.
- No live Studio interactions, document writes, or new fixture records were
  needed for this slice. Shared subscriptions, stale-request coordination across
  browser instances, status filters, sorting controls, and the approved tree UI
  remain later work.

## Shared live-data layer — October 29, 2026

The header, sidebar, and picker now share requests and one listener per active
tool/client/perspective session. The visible UI is still the bounded proof list,
not the approved tree design. Tree, recent-item, and paginated collection
resources are implemented behind that UI and tested independently.

- `pnpm verify` passed: formatting, declaration build, lint, typecheck, and all
  584 tests in 25 files. The 29 new tests cover shared subscriptions, perspective
  isolation, cancellation and late responses, reconnect/retry, periodic repair,
  complete tree reads, loaded-depth collection refreshes, and cleanup. They also
  check that background refreshes retain the mounted list and its scroll position.
- `pnpm studio:build` passed with the existing Sanity 6.17.0 baseline.
- Coverage passed. `pnpm test:package` passed all five frontend profiles, the
  separate strict-peer Studio consumer, declaration checks, and TypeGen workspace
  checks. The 85-file tarball remains a local test artifact, not a release. The
  Studio consumer now explicitly installs the existing `groq` peer required by
  the query builders; frontend dependency isolation remains unchanged.
- In the live Studio, the existing unpublished “Incomplete draft” appeared in
  Drafts, disappeared in Published with the same search, and returned in Drafts.
  This checks native draft/published isolation, not release-stack precedence.
- A Team search survived closing the picker and opening the navigator. About
  remained the previewed page while the shared footer remained the edited
  document. No fields were edited, records created, or documents published.
- Connection failures, retries, stale responses, and collection refresh depth
  were tested with controlled adapters, not a live network outage or a large
  Content Lake fixture. Live collection, release-perspective, permission, and
  final navigator acceptance remain later work. No new overlay-click claim is
  made by these checks.

## Navigator browsing UI — October 29, 2026

This slice replaces the visible flat proof list with the first approved folder
tree and collection browser. It does not add folder writes, advanced filters,
or claim that the full Pages feature is ready to release.

- `pnpm verify` passed: formatting, build/declarations, lint, typecheck, and
  589 tests in 25 files. Coverage and `pnpm studio:build` also passed.
- The five additional UI tests cover named index rows without badges, expansion
  surviving picker/sidebar changes, finding collapsed descendants through search,
  the nested options menu staying inside the picker, collection search beyond
  the five recent items, incremental loading, and retained collection mode.
  Synthetic collection tests use 70 documents and execute the generated GROQ.
- Packed-consumer checks passed all five frontend profiles, strict Studio
  installation, declarations, and TypeGen. The local 95-file tarball includes the
  new private UI modules and explicit optional Studio icons peer; it was not
  published. No Studio code was introduced into ordinary frontend bundles.
- Live Studio showed left-hand folder chevrons, the original indentation, named
  About/Journal index pages without Index badges, page-only path subtitles, and
  native published/draft indicators. Existing Company and incomplete-page drafts
  showed draft availability. This does not establish release/variant acceptance.
- Collapse all left About's preview and editor unchanged. The options menu first
  exposed a nested-portal focus problem; keeping it inside the picker fixed it.
  Enter, arrow navigation, and Enter again successfully expanded all folders,
  with focus returning to Pages options.
- Journal showed five recent items and eight total. Browse all showed all eight;
  searching `post-2` found an item outside the recent five. Escape returned focus
  to Choose page. Reopening the navigator retained Journal mode and that search.
- Selecting Post 2 with Enter updated its native document URL and preview URL.
  The native Structure pane showed Post 2's title and `/journal/post-2` pathname.
  About was restored afterward. No fields were edited or content created,
  published, renamed, or deleted. Development rebuilds reset in-memory UI state;
  reload persistence is not promised.

Remaining: targeted header identity reads (the header alone still uses its
bounded helper), sort/status filters, long-list virtualization and scale checks,
schema preview overrides, contextual creation, folder actions, URL field,
permissions/release perspectives, and broader keyboard/screen-reader acceptance.
Large-list auto-loading is automated-test evidence, not a live 70-document run.
No iframe overlay-click or outside-click regression check was repeated here.

### Typography follow-up

Compared live Fixture content category rows and document previews with Pages.
Both native title styles use Inter, 13px/19px, weight 500; native subtitles use
13px/19px, weight 400. Pages had weight-400 titles and 10px subtitles. The update
matches native text sizes and weights and inherits the surrounding card palette.
Live computed styles for unselected About and the about folder matched native
Structure: title `rgb(228, 229, 233)` and subtitle `rgb(151, 156, 176)` in the
current dark theme. Those values are observations, not hard-coded colors.
The subsequent spacing/state follow-up replaces bleed buttons with selectable
Sanity UI Cards, so text now inherits the card's current interaction state
directly; the temporary parent-color adapter is no longer needed.

### Row spacing and interaction states

Native Structure document previews measure 49px high with 8px padding. Compact
category rows measure 33px high with 4px top/bottom/left and 8px right padding.
The final folder reference is the first-pane “Proof page” / “Proof post” row,
not a document preview without a subtitle. Folders therefore use the compact
33px height and padding above; a temporary 49px folder version was superseded.
Longer path subtitles
can still wrap; nesting, icons, navigation, and content are unchanged.
Both use the public Sanity UI Card selectable palette rather than the action
button palette. The underlying native styles supply hover, selected, pressed,
and disabled colors; no observed RGB values are copied into package code.
Live measurements confirmed both heights, padding, and the native 3px corner
radius. Selected About matched Structure's selected document background
(`rgb(120, 152, 255)`) and foreground (`rgb(13, 14, 18)`) in the current dark
theme. Hover behavior was checked against the shared Card implementation, not
by synthesizing pointer hover in the live browser.

### Folder and section labels

Folder labels now uppercase only their first letter for display; stored paths
and expansion keys are unchanged. Collection labels, “Other pages”, and browser
helper text use size-1 muted text, matching page subtitles. The collection count
is a separate, right-aligned number beside the collection item label, with no “total”
suffix. Its accessible label identifies the collection and item count, and it
remains hidden while loading or when the data is unavailable.
Journal sets `itemsTitle: 'Posts'` rather than the former generic “Recent items”.
The label has a size-3 (12px) top margin to separate it from the overview above.

### Navigator header and search

Compared against the second Structure pane after opening “Proof post”. Both
headers use a 13px/19px semibold title and the same theme-derived foreground
(`rgb(189, 191, 203)` in the tested dark theme). The `+` and horizontal `…`
controls measure 25px square; search measures 25px high with 13px text and
`3px 8px 3px 29px` input padding. The combined title/search area measures 86px.
These were checked in the live navigator. The shared header also serves
collection mode, with a compact Back button beside the title. Search clearing
uses the existing state setters, preserving page/collection search scope and
resetting scroll. No native create action was invoked during visual checks.

### Collection browse row

“Browse all Journal posts” replaces the centered action button with a left-aligned
selectable Card and a right chevron. Its horizontal padding matches page rows,
and the same native Card supplies hover, pressed, and keyboard-focus colors.
The collection view no longer displays the loaded-count / Last edited summary.
Query ordering and pagination are unchanged; entering the collection still
leaves the preview and edited document alone.

### Content-fit picker and initial focus

The fixed 480px/70vh picker height is removed. Its flex layout fits the current
content and passes native Popover available-space constraints down to the list,
with an additional `100dvh - 32px` cap. The sidebar remains full-height.
At a 983px-high viewport, the live picker measured about 752px with About
collapsed, 907px with About expanded, and 147px for an empty search result.
It opened with focus on the dialog, not Search. First Tab entered Search;
Tab from the empty result's Clear button wrapped to Create page within the
dialog. Automated loaded/empty/loading cases cover initial focus, first Tab,
and containment when a background control tries to take focus.
Escape returned focus to Choose page in the live Studio; reopening focused the
dialog again without changing the preview or edited document.

### Page-title picker trigger

The closed-sidebar header places the navigator toggle first, then the page
picker, then the remaining native Presentation controls. The picker uses the
native outlined (`ghost`) button with Documents and ChevronDown icons, at the
same 33px height as the preview toolbar controls. It follows the previewed page
rather than the edited shared document. Long labels use a responsive ellipsis;
the full name remains available in the accessible label and hover tooltip.

Live selection of Alternate mapping updated the trigger and preview. Its title
needed 197px but displayed in 138px with an ellipsis, on a dark neutral background.
Opening the picker and Escape dismissal still worked. Automated coverage checks
control order, a single navigator toggle, changing preview identity while shared
content remains selected, and full accessible fallback paths. All 21 focused UI
tests and the type/lint checks passed.

### URL section labels and native-style tooltips

The incomplete draft now appears under “Pages without URLs”. Valid paths that
cannot form normal folder segments have a separate “Ungrouped pages” section;
the UI does not describe those URLs as missing or change their stored paths.
Controls and version indicators use the public Sanity UI tooltip with native
Studio typography, padding, arrowless appearance, and 400ms delay. Browser title
attributes are removed. A live keyboard-focus check showed “Pages options” in
the styled tooltip while focus stayed within the picker. Automated checks cover
focus-triggered tooltips, both URL sections, and navigation to an unusual URL.

## Final navigator-slice verification — October 30, 2026

After the typography, row spacing, collection wording, picker sizing/focus, and
tooltip refinements:

- `pnpm verify` passed: formatting, package/declaration build, lint, typecheck,
  and 600 tests across 25 files. The focused browser suite now has 25 tests.
- `pnpm test:coverage` passed all 600 tests. The reported line coverage was
  98.1%; this is automated coverage, not a claim of live release/variant testing.
- `pnpm studio:build` passed against the pinned integration-proof Studio.
- `pnpm test:package` passed all five frontend consumer profiles, the isolated
  Studio consumer, declaration checks, and the TypeGen workspace. The local
  tarball contained 99 files. No package was published; optional Studio peers
  remained isolated from ordinary frontend installs and bundles.
- The URL field, separator cleanup, folder writes, targeted header identity,
  advanced filtering, and broader release acceptance remain outside this slice.
  No dataset documents were changed during final verification.

## Targeted header identity — October 30, 2026

This supersedes the targeted-header-identity limitation in the earlier navigator
notes. The header now reads the preview URL and edited registered document
separately; neither read depends on the newest 50 documents or loaded rows.

- `pnpm verify` passed formatting, package/declaration build, lint, typecheck,
  and 617 tests across 26 files. The browser suite has 28 tests.
- `pnpm test:coverage` passed all 617 tests, with 98.13% reported line coverage.
- `pnpm studio:build` passed. The packed-consumer matrix was not repeated for
  this private implementation change; the previous slice's result is recorded
  above, not claimed as a fresh run.
- Query tests use more than 50 documents and cover configured title/path fields,
  duplicate URLs, collection ownership, excluded paths, and edited draft/release
  IDs. Session and browser tests cover cancellation, late responses, navigation,
  clearing unused results, and switching perspectives without stale labels.
- Live Studio: selecting the existing incomplete draft left Home in the preview.
  With the navigator closed, the picker still read “Pages proof: Home” and the
  missing-preview notice appeared. Selecting Home cleared the notice. Opening
  Home's shared-footer reference left the Home preview and picker title intact,
  without a false missing-preview notice for the shared document.
- No document fields were changed. No documents were created, published, renamed,
  or deleted. The greater-than-50 check and release-ID normalization are automated
  evidence, not a live large-dataset or release-perspective acceptance run.

The custom URL field, folder actions, advanced filtering, scale checks, and broader
permissions/release-perspective acceptance remain later work.

## Collection slug storage — October 30, 2026

Collection items can opt into `slugField`, while ordinary pages, overviews, and
existing full-path item registrations keep their current storage. This is the
read-side contract for the forthcoming locked-prefix input, not the input itself.

- `pnpm verify` passed formatting, package/declaration build, lint, typecheck,
  and 660 tests across 27 files. The browser suite has 29 tests.
- Query tests cover full-URL projection, search, direct stored-slug reverse
  lookup, header identity, location links, and collisions between slug-only,
  full-path collection, and ordinary page documents. Invalid/missing slugs do
  not produce usable navigation URLs, but their documents stay discoverable.
- The browser test exercises real query evaluation, recent items, full-path
  search, picker title, and native navigation using a slug-only collection.
- `pnpm studio:build` passed for the existing full-path fixture. Its schemas,
  registration, and dataset documents were not changed. No live slug-only
  dataset or input-component acceptance is claimed here.
- `pnpm test:package` passed all five frontend profiles, the isolated Studio
  consumer, declarations, publint, and TypeGen. The installed Studio consumer
  uses `slugField`; type checks reject both field modes together and slug-only
  ordinary pages. The local package contained 99 files. Nothing was published.
- The schema and modeling guidance keeps one stored value per type and an
  explicit choice of representation. There is no automatic migration, derived
  full-URL write, new schema installation, or change to frontend route ownership.

Remaining: the approved input/folder-picker UI, separator cleanup and authoring
validation, collision checks before applying field edits, folder actions, and
broader permissions/release-perspective acceptance. Existing test content was
not migrated or cleaned up in this slice.

## Saved-folder display — October 31, 2026

The navigator now reads saved folders independently of page content. This slice
adds display behavior; it does not install folder creation or synchronization
controls.

- Automated browser tests cover empty folders, named index pages, metadata
  failures and retries, page selection during failed or pending folder reads,
  shared picker updates, and perspective-session isolation.
- Query and session tests cover the exact registry ID, raw metadata perspective,
  overflow detection, invalid registry refusal, cancellation, and independent
  page loading. The full suite passed 1,288 tests across 42 files.
- In the running proof Studio, the Journal preview's picker opened and loaded
  the existing page/collection tree without a saved-folder warning. Escape closed
  it and returned focus to the trigger. No document fields or dataset records
  were changed.
- In a subsequent explicit fixture setup, `seed-empty-folder.ts --apply` added
  `/empty-folder-test` to `sanityKit.folders` in `ha9kep4l/development` through
  the guarded writer. The write was acknowledged. The real Studio picker then
  displayed **Empty-folder-test** and “No pages in this folder.” The Journal
  selection and preview stayed unchanged. No page fields or permissions changed.
- A temporary local request failure also showed the folder warning and retry
  button in the real picker while page rows remained available. The user reviewed
  both the empty-folder display and the warning. The simulation was removed;
  normal loading restored the empty folder and cleared the warning.
- Creation through editor controls and cross-editor persistence acceptance
  remain with the editing slice.

## Draft URL field — October 31, 2026

The first custom URL field is installed on Proof page and Proof post in the
fixture, using the private factory. The alternate-path schema keeps its native
string field. Existing storage was not migrated.

- In the real Studio, the published Journal page displayed its complete URL,
  disabled editing controls, and explained that live URL changes need the later
  reviewed workflow.
- Created an unpublished **URL field proof** document through the native Create
  page action, with ID `drafts.62aa3263-74af-4208-bb72-4e6cc6f4cdc5`.
- Generate proposed `url-field-proof` from its title without saving the URL.
- The indented picker opened the New subfolder modal. The Nest inside control
  opened a separate popover and defaulted to site root. Creating
  `url-field-test/team` saved `/url-field-test` and `/url-field-test/team`, then
  selected the latter while the document still had no saved URL.
- Apply URL saved `/url-field-test/team/url-field-proof` through native draft
  autosave. The draft remained unpublished and the saved URL survived the Studio
  reload. The preview's fixture link list included the new URL.
- Automated tests cover native validation, both storage modes, read-only/liveEdit
  restrictions, duplicate checks, stale async work, folder creation and failure,
  unknown-write reconciliation, and the complete input/picker interaction.
  `pnpm verify` passed 1,351 tests across 47 files, plus formatting, build, lint,
  and typecheck. The proof Studio production build also passed.

No published URL was changed, and no redirect or publication action was invoked.
Real concurrent-editor mutation races, custom filtered ACLs, dynamic prefixes,
and release editing remain outside this initial field acceptance.

## URL autosave — November 1, 2026

This supersedes the explicit Apply URL interaction recorded above.

- Removed Apply URL. Valid edits wait for a 500 ms typing pause, then check access,
  URL conflicts, and folder persistence before emitting the native draft patch.
- In the live Studio, changed the proof draft's final segment to
  `url-field-autosave-proof`. The field showed “Saving URL…” and saved
  `/url-field-test/team/url-field-autosave-proof` without another click. The new
  URL survived a Studio reload and appeared in the preview's fixture links.
- Entering `bad/segment` kept the text visible with a “Not saved” explanation;
  the last saved URL remained unchanged. Restored the valid saved slug afterward.
- Tests cover debounce timing, failed checks and explicit retry, cancellation,
  newer typing surviving an earlier native patch, and folder creation waiting
  for an earlier autosave check to finish. Opening existing content does not
  automatically clean its stored URL. A new empty field requires an explicit
  homepage choice before saving `/`.
- `pnpm verify` passed 1,369 tests across 48 files, with formatting, build, lint,
  and typecheck passing. The draft remains unpublished.

## URL field polish — November 1, 2026

- Generate now sits at the trailing end of the input row and replaces the slug
  directly, without a confirmation dialog. Tests cover both changed and identical
  generated slugs; an identical stored slug produces no new patch.
- The resolved path and Copy URL share the next row. Copy feedback crossfades to
  “Copied!” for 2.5 seconds and back, retaining the same button width. Verified
  the temporary feedback in the live Studio.
- In New subfolder, the nesting picker fills the modal's content width, and the
  nested-path description appears above the name input. Inspected this layout
  in the live Studio, then canceled without creating any folder.

- New subfolder uses Sanity’s native plus icon in the picker’s upper-right
  corner, with a native-style tooltip. It opens the existing creation modal.
- Verified the responsive field in a narrow document pane: the folder selector
  fills the first row, with the slug input and Generate button together on the
  second row. The URL preview and Copy URL sit below. No content or folder
  records changed.

## Earlier fixture records created

The explicit seed run created the following published fixture documents with
Sanity-generated IDs. It did not replace existing records or create drafts.
Keep them for continuing acceptance; no cleanup or deletion has been performed.

On October 26, native creation also saved the unpublished draft
`drafts.10c7adf6-c489-4887-8200-3d64992e2a25`, titled
“Pages proof: Incomplete draft”, with no pathname. It was not published.

| Fixture          | Document ID              |
| ---------------- | ------------------------ |
| Shared footer    | `XCVfQiHlQYx1rGNar3CpZy` |
| Home             | `3l1HxcLUM0txp4sT1SNGGy` |
| About            | `XCVfQiHlQYx1rGNar3CqCM` |
| Team             | `sa2SWBG3Hcc4ezU00NJIaa` |
| Journal overview | `3l1HxcLUM0txp4sT1SNGR8` |
| Post 1           | `XCVfQiHlQYx1rGNar3CrFc` |
| Post 2           | `XCVfQiHlQYx1rGNar3Cs3W` |
| Post 3           | `bFqdKmRLz7RAj1uG4gVE1J` |
| Post 4           | `sa2SWBG3Hcc4ezU00NJJMK` |
| Post 5           | `3eL1TgPV2dOrTeGog7ZAQU` |
| Post 6           | `XCVfQiHlQYx1rGNar3CtTo` |
| Post 7           | `3eL1TgPV2dOrTeGog7ZAlW` |
| Post 8           | `3l1HxcLUM0txp4sT1SNGi4` |
| Alternate path   | `XCVfQiHlQYx1rGNar3Cuau` |
