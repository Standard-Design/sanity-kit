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
- Live checks: October 25–26, 2026. Browser automation stalled while
  attempting an alternative for iframe interactions; the remaining checks are
  explicitly pending below.

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

| Check                                                         | Observed result                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Authenticated Studio and native Presentation shell            | Passed. Native navigator, iframe, editor, document fields/actions, and header controls rendered.                                                                                                                                                                               |
| Sidebar selection                                             | Passed. About and nested Team opened in the native editor.                                                                                                                                                                                                                     |
| Picker and sidebar use the same browser state                 | Passed for search. A sidebar search for About remained in the picker after closing the sidebar. Scroll still needs a live check.                                                                                                                                               |
| Picker selection                                              | Passed. Team selected, picker dismissed, sidebar stayed closed, focus returned to the trigger.                                                                                                                                                                                 |
| Preview navigation initiated by the browser                   | Passed after adding the frontend history adapter: Team appeared in the iframe at `/about/team`.                                                                                                                                                                                |
| Header placement                                              | Initial layout crowded controls; corrected layout visibly retained navigator toggle, Edit, refresh, address, open-preview, viewport, sharing, and picker controls.                                                                                                             |
| Live query updates                                            | Seeded documents appeared without manually reloading the list. Listener visibility was changed to `query` to avoid fetching before a change became query-visible.                                                                                                              |
| Reverse navigation from an iframe link                        | Pending. The browser tool found the iframe link but could not activate it; do not count routing configuration alone as a pass.                                                                                                                                                 |
| Shared-content overlay click preserves preview page           | Pending. Shared-content metadata and reference are present, but an actual overlay click has not been verified.                                                                                                                                                                 |
| Shared-content reference preserves preview page               | Passed on October 26 through the native reference link. The shared footer opened in the editor while the iframe and picker still identified Team. This does not substitute for an overlay-click check.                                                                         |
| Native creation with no pathname                              | Passed on October 26. A native-generated draft ID saved a title without a pathname. The prior Team preview remained visible, the header explained the unavailable preview, and the draft appeared in the picker.                                                               |
| Escape, outside click, reopening sidebar, keyboard navigation | Escape closed the picker and returned focus to its trigger in the live Studio. Reopening the native sidebar dismissed the picker and hid its trigger. Outside click over the iframe and complete keyboard navigation remain pending.                                           |
| Narrow layout and resizing                                    | Native narrow tabs and wide panels rendered. Full interactive acceptance remains pending.                                                                                                                                                                                      |
| Perspectives, publication, permissions, history               | Pending live. No permission-denied or release-perspective claims yet.                                                                                                                                                                                                          |
| Alternate `route` field                                       | Passed through the native URL field on October 26. `/alternate` rendered and, after the asynchronous lookup completed, Sanity selected the `kitProofLanding` document. An immediate snapshot before resolution still showed the previous editor; this was not the final state. |

The A1 exit gate is **not yet complete**. Finish the pending iframe-link,
overlay, and transition checks before proceeding to the
finished browser interface. The eventual A5 checklist will be broader.

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
