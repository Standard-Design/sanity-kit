# Pages navigator acceptance

This guide records what the navigator checks prove and what still needs testing
in a real Studio. The [Pages guide](pages.md) explains the architecture and
configuration. The [fixture acceptance record](../tests/fixtures/pages-studio/ACCEPTANCE.md)
contains the earlier live observations.

## Keyboard navigation

Pages uses ordinary buttons and Sanity's native menus. Tab moves between
controls; Enter or Space activates a row. Folder expansion changes the list,
without changing the website preview or the document being edited.

**Browse all** replaces the page tree with the collection list. **Back to pages**
restores the tree. In the sidebar, if the focused button disappears during that change, focus
moves to the new list heading. The heading is not an extra Tab stop: pressing Tab
continues through the header controls and search. This avoids dropping keyboard
users back into the rest of Studio. A view change does not take focus away from
a control outside the navigator.

The header picker keeps its existing behavior: it opens with focus on the
popover, and the first Tab enters search. Tab and Shift+Tab stay inside the
picker; Escape closes it and returns focus to its trigger. When Browse all or
Back replaces the list, the picker's focus containment already moves focus to
the first header control (Back to pages or Create page). Pages preserves that
native behavior instead of overriding it.

Automated tests exercise focus transfer in both the sidebar and picker, and
check that an outside control keeps focus. Existing tests cover the picker's
initial focus, containment with loaded/empty/loading results, and return focus.
The tests use the real Sanity UI popover and focus-lock library, but mock the
Presentation hooks. They cannot replace a real keyboard check in Studio.

## Narrow layouts

Folder and collection names stay on one line and shorten with an ellipsis when
needed. Their full names remain in their accessible button labels. Icons keep
their size. The collection's Browse all label can shorten too, leaving room for
its total and chevron. Page titles already shorten, while URL subtitles wrap.

The sidebar and picker share these rows. The picker remains 320px wide, limited
to 90% of the viewport on smaller screens. Its list scrolls when it reaches the
available height; its header stays visible. These changes do not change the
approved row padding, typography, colors, or nesting.

## Loading and failures

The existing browser tests cover initial loading, failed requests/listeners,
retry, background refresh, and scroll preservation. Old page results stay
visible but cannot be selected when the page data is stale. A folder-metadata
failure shows its own warning and leaves ordinary page navigation available.
Collection search hides the previous results while the new search waits, rather
than letting an editor select a result from the wrong search.

These checks cover browser behavior. Permission enforcement, retries of writes,
and mutation recovery have their own subsystem tests and acceptance records.

## Larger collections

A synthetic dataset of **5,000 collection items** is checked with the real query
builders, a local GROQ evaluator, and the React browser:

| Action                | Item rows in the DOM |
| --------------------- | -------------------: |
| Open the page tree    |       5 recent items |
| Open Browse all       |             50 items |
| Choose Load more once |            100 items |
| Search for item 4,999 |      1 matching item |

The Browse all count still reports 5,000. Search finds an item that was never
loaded into the list. This confirms that collection size does not force the
navigator to render every item at once. The test uses a viewport with no layout;
a real tall viewport can automatically load additional batches until it fills.

This is a count and behavior check, **not a browser performance benchmark or a
supported maximum collection size**. Local GROQ timings do not measure Content
Lake or a browser's layout cost. No virtualization is added by this slice.

Ordinary pages are different: Pages reads the whole ordinary-page list in
100-document requests to build its folder tree. Expanded ordinary pages and
collection batches already loaded remain rendered. A site with thousands of
ordinary pages, or a very long collection browsing session, still needs a live
performance measurement before deciding whether virtualization is necessary.

## Live checks for this slice

Run these in the proof Studio without editing or publishing documents:

1. In the sidebar, focus Browse all posts with the keyboard and activate it.
   Focus should move to the collection heading. Activate Back to pages and
   check that focus moves to the Pages heading. The preview and edited document
   should stay unchanged.
2. Repeat those steps in the header picker. Focus should move to Back to pages
   on entering the collection and Create page on returning to the tree. Check
   Tab and Shift+Tab remain inside, Escape returns focus, and reopening still
   focuses the popover rather than search.
3. At a narrow sidebar width and in the 320px picker, inspect long folder and
   collection names. Row actions, icons, totals, and chevrons should remain
   visible, with no horizontal scrolling caused by the label.
4. Search for a page, clear search, collapse and expand folders, and resize the
   pane. Confirm the picker still grows to fit short results and scrolls with
   long results; its header should stay visible.
5. Open a larger collection, scroll through multiple batches, and navigate
   between the sidebar and picker. Check scroll restoration and responsive
   interaction. Record actual browser timings before proposing virtualization.

Record observed live results separately. A passing DOM test does not mean these
live checks have been completed.

## Live observations — November 9, 2026

The coordinating task checked the real proof Studio after these changes:

- Sidebar: activating Browse all with Enter focused the Journal heading; the
  next Tab reached Create post. Activating Back focused the Pages proof heading.
- Picker: activating Browse all focused Back to pages. Back focused Create page,
  keeping focus inside the picker. Escape returned focus to Choose page.
- Neither flow changed the preview URL or the edited document.

The 320px picker was also inspected with the existing fixture content. The
Navigator-folder-proof row retained its folder actions without horizontal
overflow (234px row content and a separate 25px action button). Its nested rows
and the collection count/chevron remained legible. This checks the current
fixture labels, not arbitrarily deep nesting or extreme label lengths.

The isolated browser checks below extend this evidence to narrower rows,
extreme labels, and larger synthetic lists. They do not replace consumer Studio
performance checks.

## Isolated browser checks — November 11, 2026

The isolated harness in `tests/fixtures/navigator-acceptance` was exercised in
**Google Chrome for Testing 153.0.8010.12** using native browser controls. Run it
with `node tests/fixtures/navigator-acceptance/server.mjs`, then open
`http://localhost:3346`. It serves only on the loopback interface.

This uses the actual Pages browser, rows, header picker, data store, query
builders, and Sanity UI stylesheet. The Studio hooks, navigation, document
status, listeners, and Content Lake connection are replaced with synthetic
read-only fixtures. It does not connect to a Sanity dataset or change the proof
Studio. It supplements the real Studio observations above; it does not repeat
permission, editor-selection, live-listener, or iframe acceptance.

### Narrow rows and long labels

The extreme-label scene has six nested folders with long, unbroken names and
long page titles and paths. At sidebar widths of **240px, 280px, and 320px**, the
list's measured `scrollWidth` equaled its `clientWidth`: these labels caused no
horizontal overflow. Folder labels and page titles shortened with an ellipsis;
folder action buttons stayed visible. Complete names remained in the accessible
labels.

The 320px picker also contained this tree and stayed within the viewport. It
opened with focus on the popover; Tab entered search. Searching for an absent
page shrank it to its short empty state, and Escape returned focus to the picker
trigger. The long URL subtitles wrapped as designed. In the six-level example,
a single complete URL occupied much of the visible list. This is a usability
tradeoff of displaying the whole path, not horizontal overflow; arbitrarily
deep paths are not claimed to be comfortable to browse.

### Collection rendering

The collection scene contained 5,000 items. The tree displayed five recent
items and a total of 5,000. Browse all rendered 50 rows. Reaching and activating
Load more produced 150 rows: reaching the bottom triggered the next batch,
and activation requested another. Search for `4999` returned the one matching
item, which had not been loaded earlier. Search reset the list to the top.

The following are single-run **development React Profiler render measurements**
from the browser, rounded to milliseconds. They measure React rendering, not
end-to-end response time, browser paint, or a production performance budget.
The harness's local GROQ evaluator is also not a measure of Content Lake latency.

| Operation                           | Total React render time | Largest render commit |
| ----------------------------------- | ----------------------: | --------------------: |
| Initial tree with five recent items |                    27ms |                   9ms |
| Open first 50 collection items      |                    42ms |                  25ms |
| Load through 150 collection items   |                   155ms |                  42ms |
| Search for item 4,999               |                    16ms |                   3ms |

### Ordinary-page scale limitation

The separate ordinary-page scene contained 1,000 pages in one expanded folder,
plus Home and the collection index. All 1,000 ordinary rows were rendered. The
initial render accumulated 545ms of React rendering, with a largest commit of
359ms. Typing `Page 999` reached the correct result without another data query,
but accumulated 1,392ms across nine render commits, the largest taking 373ms.

This identifies a real performance concern for large ordinary-page trees. It
does not establish a supported maximum or show that a production build has the
same timing. Collection pagination keeps its initial rendered list small;
ordinary-page trees currently have no comparable rendering bound. Before
recommending Pages for thousands of ordinary pages, repeat the measurement in a
production consumer Studio and improve expensive repeated row rendering or add
windowing as needed. This acceptance pass does not add virtualization or claim
that this scale limitation is resolved.

A second run used a minified production bundle with React's production profiling
entry point (`HARNESS_MODE=production node tests/fixtures/navigator-acceptance/server.mjs`).
The same 1,000-page case took 446ms of initial React rendering, with a largest
commit of 289ms. Typing the same search took 975ms across nine render commits,
the largest taking 241ms. Production reduced the measured work, but did not
remove the concern. The profiling build still adds instrumentation, and these
numbers remain React render time rather than interaction-to-paint latency.

## Reducing repeated row rendering — November 11, 2026

The page row now separates its browser-state subscription from its visual
content. Search and scroll updates still reach a small wrapper, but React can
reuse the visual row when its document, selection, disabled state, routing
runtime, and picker callback have not changed. Native Presentation and document
status subscriptions remain inside the visual row, so they can update normally.
This changes rendering work, not the row's appearance or navigation behavior.

Focused tests check unchanged rows, changed titles/paths, selection and disabled
state, replacement routing/callbacks, and native Presentation/status updates.
Together with the existing browser suite, 69 tests pass.

A controlled comparison used Google Chrome for Testing 153.0.8010.12, the
production profiling harness, a 280px navigator, and 1,000 ordinary pages already
shown in the flat search list. Both versions retained 1,002 buttons and issued
zero data queries during each sample. The original row from the committed
baseline was supplied through a temporary esbuild source override; the harness
and repository source were not changed for that comparison.

| Search update | Original total React render time | Updated total React render time |
| ------------- | -------------------------------: | ------------------------------: |
| `P` to `Pa`   |                          193.2ms |                           6.1ms |
| `Pa` to `Pag` |                          211.8ms |                           6.2ms |

These are individual render-time samples, not end-to-end input latency, a
statistical benchmark, or a supported page limit. The original version recorded
one commit per sample; the updated version recorded two, with largest commits
of 5.8ms and 5.7ms. Each reset, field update, and measurement sequence completed
within two seconds. The settled report and input value were checked afterward.

Earlier attempts were excluded from this comparison: delayed browser automation
allowed the data session's 60-second background refresh to enter the sample.
The Measure control also updates harness state after reading its snapshot.
Reset immediately before each action and reject interaction samples containing
background data queries when repeating this check.

This improvement applies when rows remain mounted. The first nonempty search
switches from the folder tree to a flat list, which mounts matching rows again.
Initial loading and large tree/search transitions retain the scale limitation
recorded above. They still need evaluation in the combined consumer acceptance;
this change adds no virtualization and does not claim to solve those costs.

## Repeating bounded measurements

The isolated harness now offers ordinary-page scenes with **100 or 1,000 pages**.
Start the production profiling server with
`HARNESS_MODE=production node tests/fixtures/navigator-acceptance/server.mjs`, then
open `http://localhost:3346/?scene=ordinary&count=100` or
`http://localhost:3346/?scene=ordinary&count=1000`. Only these counts are accepted;
a missing or different count uses 1,000. The heading and report show the active
count. These are comparison cases, not supported-size limits.

Each reload starts an **Initial load** sample. Wait for the ordinary-page tree
to appear, then select **Measure within 20 seconds of the reload**. Measure
stops the sample and displays its report. The report flags an incomplete
ordinary-page tree or pending requests; it allows the data requests needed for
initial loading. Reload to repeat initial loading; Reset is disabled while
Initial load is selected, because resetting a loaded view is not an initial mount.

For an interaction, first prepare its starting state, choose the matching
**Measurement action**, and select **Reset measurements**. Perform one action,
then select **Measure** within 20 seconds. For example:

- **Tree to search:** start with empty search, then enter `P`.
- **Search update:** start with `P` already loaded, then change it to `Pa`.
- **Clear search:** start with search results, then clear the search.
- **Scroll:** start with the desired list loaded, then scroll once.

Report state is separate from navigator state, so reading or resetting a sample
does not render the navigator. Each report includes its label, elapsed time,
individual React commits, total and largest render times, rendered row counts,
query starts/completions, and pending requests at both boundaries. Query counters
remain cumulative internally; reports show the difference within the sample.
A failed request still counts as a query start.

A sample is marked invalid if it lasts over 20 seconds, exceeds 200 recorded
commits, records no render, or starts/ends with pending requests. Interaction
samples are also invalid if any request starts during the action. This catches
the real data session's 60-second background reconciliation without disabling
it. Invalid samples are diagnostic evidence, not usable timing comparisons.

Repeat each action separately at each count and retain the reports, including
invalid attempts. Compare several valid samples rather than a single run. Keep
sidebar width and browser conditions the same. These controls improve
repeatability; they do not measure input-to-paint latency or replace acceptance
in a consumer Studio. The new controls have automated checks; the 100-versus-
1,000-page mount comparison still needs to be run in the browser.

## Bounded browser follow-up — November 11, 2026

The committed measurement harness was exercised with the production profiling
build in Google Chrome for Testing. The following **individual samples** used
the 100-page scene, the 280px sidebar setting, and closed DevTools:

| Action                      | Total React render time | Largest commit | Commits | Sample duration |
| --------------------------- | ----------------------: | -------------: | ------: | --------------: |
| Empty search to `P`         |                  50.7ms |         35.0ms |       2 |           680ms |
| Existing `P` search to `Pa` |                   2.5ms |          2.2ms |       2 |           658ms |

Both reports were valid, with zero query starts/completions and zero pending
requests at the start and end. Search showed the expected ordinary-page results.
The sample duration includes the automation's time between Reset and Measure;
it is not input latency. The render times measure React work only. These two
samples illustrate the difference between mounting the flat results and updating
rows that remain mounted; they are not a statistical benchmark.

The remaining attempts did not produce a comparable mount result:

- Two 100-page initial-load captures exceeded the 20-second window, at about
  20.7 and 23.5 seconds, and were marked invalid.
- Two further 100-page initial reports were valid by the recorder's checks,
  with render totals of 86.6 and 81.0ms. However, docked DevTools reduced the
  available page width and compressed the flexible sidebar. They are excluded
  from the planned comparison at a consistent sidebar width.
- The 1,000-page initial capture exceeded the window at about 33.9 seconds and
  was marked invalid. Delayed or stale browser-control observations prevented a
  timely reading. Subsequent action-selector interactions did not settle
  reliably enough to capture a labeled transition sample.

No new clear-search or scroll timing samples were completed in this follow-up.
The earlier retained-row comparison remains separate evidence. Initial loading,
the first search transition, clearing search, and scrolling at both sizes still
need a repeatable comparison under consistent browser conditions. This pass does
not establish a supported ordinary-page count, resolve the large-tree limitation,
or justify adding virtualization without its own interaction acceptance.

## Fresh-tab comparison — November 11, 2026

A fresh tab in Google Chrome for Testing 153.0.8010.12 produced consistent
controls without opening DevTools. The same production profiling harness and
280px sidebar setting were used for both scenes; a screenshot confirmed the
uncompressed sidebar layout. This pass obtained the following valid samples:

| Action              | Ordinary pages | Total React render time | Largest commit | Commits | Samples |
| ------------------- | -------------: | ----------------------: | -------------: | ------: | ------: |
| Initial load        |            100 |          77.5ms; 65.3ms | 36.0ms; 30.0ms |  8 each |       2 |
| Initial load        |          1,000 |                 379.7ms |        237.3ms |       8 |       1 |
| Empty search to `P` |            100 |                  37.0ms |         37.0ms |       1 |       1 |
| Empty search to `P` |          1,000 |                 262.2ms |        262.2ms |       1 |       1 |

Initial loading completed five synthetic requests at 100 pages and fourteen at
1,000 pages. Every initial sample started and ended with zero pending requests
and was read within 4.5–5.4 seconds. The initial-sample check also confirmed that
all expected ordinary rows had rendered. Both search transitions had zero query
starts/completions and zero pending requests. Their capture windows were about
580ms and 1,080ms. These windows include automation time and are not input
latency. An attempted second 1,000-page reload did not produce a fresh report;
the unchanged report was not counted as another sample.

Clearing `P` back to the tree was also exercised at both sizes. Both reports were
rejected by the recorder because one data request started and completed:

| Rejected clear-search sample | Total React render time | Largest commit | Commits |
| ---------------------------- | ----------------------: | -------------: | ------: |
| 100 ordinary pages           |                  43.0ms |         41.4ms |       3 |
| 1,000 ordinary pages         |                 238.9ms |        236.3ms |       3 |

This rejection does not mean clearing search failed. Returning to the tree
remounts the recent collection-items component. Its resource becomes dirty when
search removes the last subscriber, so a refresh on return is expected. The
current recorder conservatively rejects every interaction with a request and
does not identify query plans; these reports remain excluded from the valid
comparison. A future clear-search measurement should distinguish this expected
request from periodic background reconciliation rather than disable either.

The fresh-tab samples substantiate the remaining mounting cost: the 1,000-row
initial load and first search each included a React commit above 200ms, despite
the much cheaper retained-row updates recorded earlier. The sample counts are
small, the data and status hooks are synthetic, and production profiling adds
instrumentation. These are not paint/interaction measurements or supported-size
claims. Keep the large ordinary-tree limitation explicit. Improving those
transitions requires a separate change that limits mounted rows, with keyboard,
folder-expansion, and scroll-continuity acceptance. No rendering change was made
in this measurement pass, and no new scroll timing was captured.

## Measured rendering implementation — automated evidence

The next implementation keeps the complete loaded inventory but mounts only a
window of a long list. Small lists retain ordinary rendering. The window uses
measured row heights, rather than assuming folders, page rows, and wrapped paths
are equally tall. Expanded collection subscriptions stay alive when their rows
scroll out of view. Existing collection pagination is unchanged.

Automated checks cover a 1,000-row list with a bounded mounted window, scrolling
to distant rows, changed row heights, notices above the list, two-control folder
rows, disabled controls, focus recovery after collapse, and retained menu
triggers. Separate tests use the real focus-lock library to exercise its boundary
guards. JSDOM does not perform the browser's default Tab navigation: those tests
drive guard arrival explicitly and are not a substitute for live keyboard checks.

Build, lint, type checking, all 2,808 tests, and coverage passed. The installed
package check passed with 304 files, including all application profiles, Studio
bundling, and TypeGen. It also confirmed that the new virtualizer remains an
optional Studio dependency and does not enter frontend or server-only installs.

The measurement harness now checks the actual shared data session to establish
that the inventory finished loading. It separately reports the logical row count
and mounted window count. It no longer requires every page to have a mounted row
before measuring a virtualized list. Render-only interaction samples still
require zero reads. A clear-search sample may include the expected recent-items
refresh, but is labeled query-inclusive and must finish without pending, failed,
or unrelated reads.

At this checkpoint, browser acceptance still needed initial load, first search,
clear-search, scrolling, real Tab/Shift+Tab traversal, menu and dialog return
focus, narrow wrapped paths, the content-sized picker, expanded folders, and
saved scroll positions. The Mac was locked during this work, so this checkpoint
made no new browser timing or visual acceptance claim. The follow-ups below
record the later checks and their remaining measurement limits.

## Measured rendering live follow-up — November 11, 2026

The staged rendering and harness candidate with snapshot hash
`d03af60388ad71e18de8282de8766f15d0ba62cc40f4329fe9b32dcf86da6829`,
on top of commit `945e22f`, was exercised in Google Chrome for Testing
153.0.8010.12. These samples used the same synthetic workload, production
profiling build, 280px sidebar, and closed DevTools as the earlier comparison:

| Action                        | Ordinary pages | Total React render time | Largest commit | Commits | Sample duration | Requests                        |
| ----------------------------- | -------------: | ----------------------: | -------------: | ------: | --------------: | ------------------------------- |
| Initial load                  |            100 |                  41.6ms |         14.0ms |      12 |       5,839.2ms | 5                               |
| Empty search to `P`           |            100 |                  15.6ms |         10.9ms |       5 |       1,467.2ms | 0                               |
| Initial load                  |          1,000 |                  37.4ms |         16.1ms |      12 |       5,013.0ms | 14                              |
| Initial load, repeated reload |          1,000 |                  35.2ms |         15.5ms |      12 |       5,270.7ms | 14                              |
| Empty search to `P`           |          1,000 |                  16.6ms |         12.4ms |       5 |       1,488.5ms | 0                               |
| Empty search to `P`, repeated |          1,000 |                  16.5ms |         12.0ms |       5 |       1,497.9ms | 0                               |
| Clear `P` back to the tree    |          1,000 |                  24.4ms |         15.4ms |       6 |       1,505.7ms | 1 expected recent-items refresh |

All reports passed their recorder checks. The clear-search result is explicitly
**query-inclusive**, rather than a render-only interaction sample. The initial
checks establish that the full inventory loaded while only a window of rows was
mounted. The search samples had no requests.

For this workload, the 1,000-page initial-render totals of 35.2–37.4ms and
first-search totals of 16.5–16.6ms are substantially below the earlier 379.7ms
and 262.2ms individual samples. The rendering strategy changed: the earlier
version mounted every row, while this candidate mounts a measured window. These
few samples show reduced React work for that change; they are not statistical
benchmarks, user-perceived latency measurements, or a supported-size guarantee.
Sample duration includes automation and reading time, not just rendering.

The same pass exercised real keyboard and native menu behavior:

- Tab moved from the first row, Page 0, through virtual window boundaries to
  Page 26; Shift+Tab returned to Page 6.
- PageDown moved the visible window to rows 2–24 while retaining focus on
  Page 0. The next Tab correctly focused Page 1.
- Opening the picker and pressing Tab focused Search.
- The native folder menu remained visible above neighboring rows. Escape
  returned focus to its trigger.

This pass also found a remaining defect: switching from the sidebar to the
picker preserved the search query but lost the saved scroll position. Page 6
was at the top in the sidebar; Page 0 appeared at the top in the picker. The
owner corrected the initially cached zero scroll offset. Browser acceptance was
**not complete at this checkpoint**; the functional retest below verifies the fix.

The native scroll automation returned `noWindowsAvailable`. No valid wheel-scroll
timing sample was captured or inferred from the successful PageDown check.
Remaining visual, scrolling, and state-continuity checks still apply.

## Functional retest after unlocking — November 11, 2026

The updated candidate was exercised in Google Chrome for Testing against the
production profiling harness on port 3346. This pass verified the sidebar-to-
picker scroll fix described above:

- With 1,000 pages and search `P`, 30 Tab presses reached Page 28. The sidebar
  showed Page 19 partially at the top and Page 20 as the first complete row.
  Switching to the picker retained that same partial-row offset.
- In the picker, Tab focused Search. Shift+Tab moved to Pages options, and
  another Shift+Tab wrapped to Page 999. Tab wrapped back to Pages options.
  Escape closed the picker and returned focus to the Choose page trigger,
  displaying Home.

The mixed scene combined six exceptionally long, deeply nested paths with
1,000 ordinary pages. Changing the sidebar width from 240px to 320px caused the
actual row heights to be measured again, without overlapping rows. All remained
reachable by keyboard. The extreme paths, nested six levels deep, became very
tall at 240px; this check establishes correct wrapping and layout, not that this
unusual content is easy to scan at that width.

The 5,000-item collection scene also passed these functional checks:

- Browse all followed by 65 Tab presses reached Post 64; another 60 reached
  Post 124. This crossed the 50- and 100-item pagination boundaries while the
  rendered window remained bounded.
- The sidebar showed Post 115 at the top. Switching to the picker retained
  Post 115 at the top.
- A nonexistent search showed No items. Searching for Post 4999 returned that
  exact final item.

A fresh 1,000-page initial-load report passed the recorder checks: 50.2ms total
React render time, 15.7ms largest commit, 12 commits, 1,002 loaded documents out
of 1,002 expected, 12 mounted rows out of 1,005 logical rows, and zero pending
requests. A concurrent build may have affected this sample, so it is excluded
from the comparative timing results. No wheel-scroll timing was acquired in
this pass.

A separate stale-scroll-offset edge case was still under correction: collapsing
the list to 60 or fewer rows switches to ordinary rendering, and expanding it
again must restore the correct virtual window. The final live retest below
verifies that transition. This checkpoint alone did not complete browser
acceptance or establish release readiness.

## Final candidate checks — November 11, 2026

The final production profiling bundle used runtime, harness, and manifest changes
with HEAD-diff hash
`a479d223b456d1c47419e61ab029f529978802504df7d7b388fe2f0bcf8d45a3`.
Builds and tests were idle during these samples. Google Chrome for Testing and
the 280px sidebar setting remained the same:

| Action              | Ordinary pages | Total React render time | Largest commit | Commits | Sample duration | Requests |
| ------------------- | -------------: | ----------------------: | -------------: | ------: | --------------: | -------: |
| Initial load        |          1,000 |                  48.3ms |         16.5ms |      12 |       4,479.3ms |       14 |
| Empty search to `P` |          1,000 |                  14.1ms |         10.5ms |       5 |       1,800.0ms |        0 |

Both reports were valid and ended with zero pending requests. Initial loading
confirmed 1,002 documents out of 1,002 expected, with 12 mounted rows out of
1,005 logical rows. Search rendered 16 rows out of 1,000 logical results. These
are additional individual measurements of React work on synthetic data, with
the same interpretation limits as the earlier samples.

The final collapse/expand check passed. After clearing search `P`, 42 Tab presses
reached Page 125 in the tree. Switching from the deeply scrolled sidebar to the
picker preserved that state. Pages options → Collapse all clamped the view to
Home and the collapsed Journal and Pages groups. Expand all kept Home at the
top, with Journal and Page 0 visible; the old deep offset did not return.

Together with the preceding functional retest, this completes the described
live keyboard, native menu, wrapped-row layout, pagination, and scroll-position
continuity checks for this candidate. It does not add a wheel-scroll performance
measurement. It also does not measure production-data network performance,
input-to-paint latency, or establish a general supported content-size limit.

The final automated checks passed: 104 test files, 2,811 tests, build, lint,
type checking, and formatting. The final installed-package check also passed:
304 packed files, application and Studio profiles, dependency isolation, and
TypeGen. It used an isolated snapshot of the final working source. The tarball
integrity was
`sha512-rv1Wv4M3vPxvywSlH+wTKo0yjgph2Iq+ihD1V2SkuIyd4Im3UaE3ZY0Yo6mPWG1NcJnyoj2/2cTjJJMxthKo0Q==`.
