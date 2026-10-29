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

## Test records created

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
