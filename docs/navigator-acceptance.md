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
