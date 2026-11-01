# Studio URL field

The URL field lets an editor choose a folder, enter the final part of a URL, and
see the complete path as it saves. It connects the kit's existing URL
preparation, generation, uniqueness checks, and folder writer to a native Sanity
slug field.

This first implementation is private and under review. The proof Studio imports
it directly from source; there is no public package export or release yet.
It supports fixed collection prefixes and edits to unpublished drafts. Published
documents, documents with release versions, and `liveEdit` schemas display their
URLs but cannot change them through this input. Reviewed live URL changes and
redirects need a later integration.

### Planned editing of published pages

Published pages should allow the same normal draft URL editing as new pages.
Changing the draft URL must leave the live URL unchanged until publication.
At publication, the kit compares the old and new URLs and coordinates the change
with redirect creation. Editors can explicitly choose to publish without a
redirect when the old address should not forward to the new one.

This behavior is agreed, but not implemented in this field slice. It belongs in
the next publication-integration slice, together with the checks and redirect
controls needed to complete the workflow. The current published-page restriction
remains until that integration is ready. Single-page draft editing should not
require the bulk-change review used for folder renames and collection moves.
See [the redirect design](./redirects-design.md#how-pages-creates-redirects).

## What an editor does

1. Choose an existing folder. The picker shows indented folder names, including
   saved empty folders and folders implied by existing page URLs. Choosing a
   folder closes the picker immediately.
2. Enter the final segment, or select **Generate** to derive it from the configured
   title or name. Generate preserves the selected folder and replaces the slug
   directly. If the generated slug is already stored, nothing changes.
3. The field saves automatically after a 500 ms typing pause. Choosing a folder
   or generating a slug also starts a save without another action. The
   input checks the complete URL, checks for other documents using it, and
   preserves the necessary folder records. Only then does it hand a field patch
   to Sanity's normal draft autosave.

Until those checks finish, the edit is a local proposal and the field shows a
small rotating sync icon inside the input, matching Studio’s document-saving
indicator with a one-second eased rotation. Its space is reserved so saving never
moves the content below the field. It has an accessible “Saving URL” label and
stays still when reduced motion is requested.
Invalid URLs, conflicts, or failed reads keep the edit local and
use Sanity’s invalid-input styling and its normal error icon beside the field
label. Hover over the icon to read the message in the native tooltip; there is
no error notice below the input. A hidden description also associates the message
with the input for screen readers. These local errors do not change the saved
document or its schema-validation results.
Duplicate or malformed URLs have no retry button: edit the value to check it again.
Temporary request failures and uncertain folder saves offer a retry; after a network failure,
use **Retry saving URL**. The field does not run a silent retry loop.

Navigating to another document before the pause or checks finish discards the
unsaved local edit. Wait for the field's save indicator to clear before leaving.
Publishing remains a separate native Studio action; URL autosave never publishes.

**Generate** sits at the trailing end of the input row. The resolved URL appears
below it, with **Copy URL** at the right. When the document pane is 480 px wide
or narrower, the folder selector fills the first row. The slug input and Generate
button share the next row. The URL preview and copy control stay on a separate row. Copy feedback crossfades to “Copied!”
for 2.5 seconds without changing the button’s width, then returns to its normal
label.

**Copy URL** copies the displayed root-relative path, including a local proposal
when one exists. It does not add an origin or save the proposal. A whole-field
read-only setting disables editing, generation, folder selection, creation, and
autosave, while leaving copying available.

### Create an empty folder

Choose the **+** button at the top right of the folder picker (its tooltip is
**New subfolder**). A modal asks for a relative folder
name or path, such as `company/team`. The **Nest inside** picker opens in a
popover and initially selects site root `/`. Selecting `/about` produces
`/about/company/team`.

The modal shows the resulting path before creation. **Create and use folder**
saves the folder and any missing ancestors, then selects it in the URL proposal.
That selection starts the ordinary checked URL autosave. The folder is saved
immediately, even if the URL cannot be saved or the editor leaves before it saves.
This is how editors can prepare an empty folder structure. Canceling before
creation saves nothing. Creation failures stay in the modal with an explanation.

This picker does not rename or remove folders. Those actions belong in the Pages
navigator. The approved background synchronization and recovery menu action are
also separate work; opening this field performs reads only.

## One field, two storage modes

The shared route registration determines the field's meaning. It does not require
every document to store its website prefix.

| Registration                                                           | Visible URL      | Stored `current` value |
| ---------------------------------------------------------------------- | ---------------- | ---------------------- |
| Page with `pathnameField: 'pathname.current'`                          | `/about/team`    | `/about/team`          |
| Collection item with `slugField: 'slug.current'` and prefix `/journal` | `/journal/story` | `story`                |

Collection prefixes are shown as locked text in this slice. Existing collection
items that store full paths keep that storage; the input preserves their current
parent path while changing the final segment. Editable collection settings and
moving a legacy item between nested folders remain later work.

The field never stores the derived `{pathname, prefix, slug}` object. Existing
slug-object metadata is preserved: it sets `current` rather than replacing the
whole object. The frontend still uses the shared [URL resolver](url.md), and the
consumer still owns its React Router routes.

## Configure the private fixture field

The internal factory takes the shared routes plus normal slug-field information:

```ts
defineSanityUrlField({
	routes,
	name: 'pathname',
	title: 'URL',
	options: { source: 'title' },
	validation: (rule) => rule.required(),
})
```

Do not copy a deep package import from this example into a consuming application.
The public import and broader editing lifecycle are not finalized. The proof
Studio's schema shows the current source import.

The factory installs native format validation and `options.isUnique`, then adds
any consumer validation. Missing values remain optional unless the consumer
requires them. The field must be at the registered slug-object path; an unrelated
slug field or an array URL field is refused. Other registered types may continue
to use ordinary string fields, but this custom input itself uses a slug object.

Native `source`, `maxLength`, and `slugify` options control generation. The default
generator follows Sanity's behavior. Custom generators may return promises and
replace that default; their results still must pass the kit's single-segment URL
rules. Read-only and hidden settings remain native schema options, including
conditional settings evaluated by Studio.

## Cleanup and validation

An explicit full-path repair or folder creation can collapse repeated internal
slashes and remove trailing slashes. Root `/` remains `/`. Viewing a document
never cleans stored values. Malformed full paths remain visible in a full-path
repair input, so an editor can correct them deliberately.

The final segment does not accept `/`: selecting a folder is a separate action.
Unsafe paths, such as another host, dot segments, encoded separators, whitespace,
query strings, or fragments, are rejected. No numeric suffix is silently added
to resolve duplicates.

The homepage has prefix `/` and an empty final segment. An untouched empty field
is still missing data, not an automatically created homepage. Clearing the final
segment does not silently turn an existing URL into `/`. Choose **Use as homepage**
to make that change deliberately; the same validation, access, conflict, and
folder checks still apply. An existing page at `/about` appears with prefix `/`
and final segment `about`, even when `/about` also contains other pages.

## Checks before autosave

The private controller reads effective dataset access and a bounded raw inventory
of registered documents. This first version accepts only an explicit unrestricted
read grant (`true` or `_id in path("**")`). It refuses custom filtered grants
whose completeness it cannot establish. A successful empty query alone is not
evidence of complete visibility. Sanity continues enforcing write permissions.

Before returning an applicable candidate, the controller:

- Refuses published documents and documents involved in releases.
- Checks complete-path occupancy across registered types and storage modes.
- Preserves the previous and destination ordinary folders using the additive
  writer. It never renames or removes a folder.
- Rechecks versions and conflicts after folder writes.

The input also discards results if the document, URL, read-only state, or routing
context changed while work was pending. It never applies an older generation or
save result to a different document. Opening the field does not create records.

Folder writes and native draft patches are separate operations. If an editor
cancels or the document changes after a folder save, the empty folder can remain;
that is consistent with persistent empty folders. An uncertain folder-write
result blocks another mutation until a fresh read confirms the expected keys and
paths. An unconfirmed absence is not permission to retry blindly.

These checks are not an atomic URL reservation or a database constraint. Another
writer can create a conflict or publish a page after a read. API writers and
other input components can bypass this field. Native validation helps detect
conflicts at publication, but the package does not promise to eliminate every
concurrent-write race.

## How the source fits together

| File                                             | Responsibility                                                                                 |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `src/studio/url/field.tsx`                       | Connect the schema, native validation, and custom input.                                       |
| `src/studio/url/input.tsx`                       | Keep a local proposal, render controls, and emit the final native patch.                       |
| `src/studio/url/validation.tsx`                  | Pass local proposal errors to Sanity’s native field header without changing stored validation. |
| `src/studio/url/folder-picker.tsx`               | Folder selection and the creation modal; delegates persistence to its caller.                  |
| `src/studio/url/edit.ts`                         | Read access/version evidence, check conflicts, and preserve folders before a patch.            |
| `src/studio/url/generate.ts`                     | Bind native source/generator callbacks to the shared authoring helper.                         |
| `src/studio/url/conflicts.ts` and `is-unique.ts` | Check occupancy and adapt it to native slug validation.                                        |
| `src/studio/folders/`                            | Read, plan, and save organizational folder records.                                            |

The tests cover each boundary and the complete input/picker interaction. Live
proof-Studio acceptance is recorded separately in
[`ACCEPTANCE.md`](../tests/fixtures/pages-studio/ACCEPTANCE.md).
