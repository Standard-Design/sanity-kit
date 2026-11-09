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

A narrower sidebar, extreme labels, and browser performance measurement remain
separate acceptance checks.
