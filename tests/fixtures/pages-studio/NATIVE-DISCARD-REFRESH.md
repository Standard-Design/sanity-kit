# Native Discard changes refresh investigation

Investigated November 19, 2026 after Standard Stack reported that discarding a
shared settings draft leaves the existing preview's metadata stale.

## Finding and recommendation

The missing notification is reproducible in Sanity's own
`PostMessageRefreshMutations` component without importing SanityKit. Both the
installed `sanity@6.17.0` and the npm `latest` release checked here, `6.24.0`,
exhibit it. An upgrade to that release alone does not address this notifier gap.

Treat this as an upstream Presentation bug first. Keep the native **Refresh
preview** button as the immediate recovery step. Do not add an automatic kit
workaround or replace native Discard changes without a separately reviewed need.
No consumer workaround or kit runtime patch has been added by this investigation.

## Report status

Maintainer decision, November 19, 2026: document this issue and reproduction for
later reference. Do not submit a Sanity issue or add a workaround at this time.
The immediate approach is native Refresh preview; reconsider a compatibility
option only if an actual project needs automatic recovery before Sanity fixes it.

## Browser reproduction for a future issue report

Suggested issue title: **Presentation does not refresh after discarding a draft
when the published revision is unchanged**.

Observed environment: Sanity 6.17.0, Visual Editing 6.1.2, React Router 8.4.0,
SanityKit 0.1.0-alpha.8, and Chrome for Testing 157.0.8103.79. The independent
notifier fixture below also exercises Sanity 6.24.0 source; no complete browser
upgrade to that version was performed.

Use a dedicated published settings fixture with a Site title field, no existing
draft, and a preview page that reads that shared title into `og:site_name`.
The document selected for editing should be the settings document while the
iframe remains on that page. Preview must read the Drafts perspective.

1. Open the page in Presentation and record its preview URL and original site
   title. Keep the page in the iframe throughout this sequence.
2. Open the shared settings document in the editor.
3. Change Site title to a temporary value and wait for autosave. Confirm that
   the existing iframe's `og:site_name` updates automatically.
4. Choose the native document action **Discard changes** and confirm.
5. Confirm that the editor shows the original published title, the settings draft
   no longer exists, and the published revision is unchanged.
6. Inspect the same iframe's `og:site_name`. It still contains the temporary
   title. In the reported live run it remained stale across repeated observations.
7. Fetch the same preview URL through the authenticated server path. It already
   returns the original published value with `Cache-Control: private, no-store`.
8. Click native **Refresh preview**. The existing iframe updates to the original
   title without reloading Studio or its iframe document.

**Expected:** discarding the draft automatically refreshes the preview to the
published fallback, retaining the selected settings document and preview page.

**Actual:** the editor and Content Lake are restored, but the iframe retains
its last draft value until manual refresh.

**Control:** edit Site title to a temporary value, then restore the original value
through the field instead of discarding the draft. Both changes refresh the
preview automatically. Anonymous HTML continues to show only published content.

These browser observations come from the integration report referenced below.
The isolated regression confirms the notification gap without touching that
project or relying on its query/cache configuration.

## What was reproduced

The fixture executes the original TSX source embedded in the installed npm
package's source map. It replaces only the native document-store/perspective
hooks with an in-memory store and captures the outgoing comlink messages.
Actual React hooks, effects, memoization, and the native notification code run.
SanityKit's plugin, URL field, and frontend wrapper are absent.

| Transition                                                                      | Native notification observed          |
| ------------------------------------------------------------------------------- | ------------------------------------- |
| First draft and later field edits                                               | Refresh for the new draft revision    |
| Restore the published value through the field                                   | Refresh for the new draft revision    |
| Discard an existing draft; keep the published revision unchanged                | **No refresh**                        |
| Publish; remove draft and change published revision                             | One published refresh                 |
| Select another edited document                                                  | No fabricated mutation refresh        |
| Remove an edited release version while draft/published revisions stay unchanged | No refresh from this notifier         |
| Remove the published record while an unchanged draft remains                    | No refresh from this notifier         |
| Delete the last published record or last draft-only record                      | Notifier unmounts; no refresh from it |

The test models the frontend read performed after a refresh. After discard, the
store already returns the original published value while the last refreshed
value stays temporary. This isolates the missing notification; it is not a
second live iframe test, a complete deletion/release workflow test, or a full
compatibility certification of Sanity 6.24.0.

## Cause

The native component compares old and current revisions for draft, published,
and release versions. On a draft removal, it records the absence but only posts
a mutation refresh if the new draft exists. The published branch compares its
revision too; that revision did not change during discard, so it sends nothing.

The same presence guard exists for published and release versions. A disappearance
with no changed surviving revision can therefore be silent. Deleting the final
available document has an additional outer-component issue: the inner notifier
unmounts before it can report the disappearance. Other native components or live
query integrations may refresh those workflows independently; this fixture does
not claim that every deletion or release flow is broken end to end.

Sources inspected:

- Installed Sanity 6.17.0 map: `PostMessageRefreshMutations-ClPJDKPe.js.map`.
- npm Sanity 6.24.0 map: `PostMessageRefreshMutations-C4WfsV_L.js.map`.
- [Upstream notifier source](https://github.com/sanity-io/sanity/blob/main/packages/sanity/src/presentation/editor/PostMessageRefreshMutations.tsx).
- Installed `@sanity/visual-editing@6.1.2` React Router adapter and `ui/Refresh.tsx`.
- Kit wrapper: `src/react-router/visual-editing/index.tsx`.

The native React Router adapter revalidates on mutation refresh messages when no
separate live loader owns refresh, and on manual refresh. The kit delegates to
that adapter. A consumer `refresh` callback cannot repair a notification that was
never sent. The reviewed public Studio Presentation exports expose navigation
and parameters, not a supported direct refresh sender.

## Running the regression

```sh
pnpm exec vitest run tests/studio/native-discard-refresh.test.tsx
```

The result on each checked version is **8 passing controls and 1 expected
failure**. The `it.fails` case asserts the desired refresh after discard; it is
explicitly an outstanding upstream regression, not completed kit functionality.
When Sanity fixes this, remove the expected-failure marker and update the
characterization checks after confirming the fix.

To compare an unpacked Sanity npm release without changing workspace dependencies:

```sh
SANITY_NATIVE_REFRESH_PACKAGE=/absolute/path/to/unpacked/package \
  pnpm exec vitest run tests/studio/native-discard-refresh.test.tsx
```

The package must retain its `lib/PostMessageRefreshMutations-*.js.map` source map.
The fixture intentionally fails with a clear review message if an upstream
upgrade changes that private test input. Production imports never use it. TSX
compilation runs in a Node child process to avoid jsdom's typed-array realm
mismatch with esbuild. No extra dependency, database, server, or credential is
needed.

## Upstream fix requirements

A native fix should notify when the effective preview content falls back from a
discarded draft to the unchanged published version. It should also review:

- Initial loading versus a confirmed removal; unavailable state is not deletion.
- Duplicate refreshes when publication already changes the published revision.
- Published fallback, no-fallback deletion, and release-version removal.
- Document changes and perspective changes without using the previous document's
  identity or forcing the edited document to become the previewed page.
- Keeping refresh decisions in native lifecycle handling rather than adding a
  subscription for every referenced document on a page.

No proposed patch has been deployed, submitted upstream, or validated against a
live release workflow. A narrow kit compatibility option can be considered if
manual refresh becomes unacceptable before an upstream fix is available. That
option needs an explicit supported refresh bridge and duplicate/cleanup tests;
private comlink imports, query-string toggling, and global referenced-document
listeners are not recommended defaults.

## Relationship to the Standard Stack report

The integration task's committed report (`450c094`, shared settings section)
records the live iframe behavior: normal edits refresh, discard leaves stale
`og:site_name`, a fresh signed read is correct, and native Refresh preview fixes
the existing iframe. It also records restored published settings and unchanged
page revisions. This investigation read that report and did not mutate its
project, content, permissions, installed dependencies, or running servers.
