# Studio URL field

The URL field lets an editor choose a folder, enter the final part of a URL, and
see the complete path as it saves. It connects the kit's existing URL
preparation, generation, uniqueness checks, and folder writer to a native Sanity
slug field.

This first implementation is private and under review. The proof Studio imports
it directly from source; there is no public package export or release yet.
It supports fixed collection prefixes, opt-in settings-backed prefixes, and draft URL editing. With the private
publication plugin installed, editors can also edit drafts of published pages.
Documents with release versions and `liveEdit` schemas remain protected. Without
that plugin, the field still limits editing to unpublished documents.

## Using the field without Pages

The URL field does not require the Pages tool. It can appear in an ordinary
Structure document editor, or in native Presentation, without installing
`pagesTool`. The field and its publishing integration are separate from the
Pages navigator. They remain private source integrations until their public
package exports are finalized.

Standalone use still needs the shared route registration. It tells the field
which document types own URLs, where those values are stored, which collection
prefixes apply, and which paths are reserved. Use the same registration for the
field and the publishing integration. Install `withUrlPublication` to enable
draft URL editing on published documents and review redirects when publishing
a changed URL. That helper works independently of Pages.

The folder picker also works without Pages. The field's own controller loads
saved folders and folders implied by registered page URLs, and saves folder
records when needed. It uses the same folder subsystem and permissions as the
navigator; it does not need a mounted Pages tool to supply the folder list.
Folder rename and removal remain navigator actions. Location hints from a
Pages **Create page** action are optional; an ordinary Structure-created document
does not need one.

### Settings-backed collection prefixes

Pass the same optional `collectionRouting` to the field and
`withUrlPublication` when collections read their prefixes from settings documents.
The field loads draft routing and checks URL ownership against both draft and
published routes. Loading or unreadable settings disable URL edits instead of
using a guessed prefix. Standalone Structure fields support this too.

An article can still store `first-post` while the field displays
`/stories/first-post` from its collection's settings draft. Publishing the article
does not publish that settings draft. URL-changing publication requires matching
live/draft routing until the separate prefix-publish workflow is ready;
content-only updates use fresh checks without activating a draft prefix.
See [live collection routing](collection-routing.md#connecting-live-routing-to-studio-and-the-website).

### Text input and stored strings are separate choices

Set `inputMode: 'text'` on the field definition to replace an ordinary page's
folder picker and final-segment input with one full-path text input. The default,
`inputMode: 'folders'`, keeps the folder picker. For example:

```ts
defineSanityUrlField({
	routes,
	name: 'pathname',
	title: 'URL',
	inputMode: 'text',
	options: { source: 'title' },
})
```

Typing `/about/company/team` still places the page in `/about/company` and
preserves its folder records through the same controller. Text mode uses the
same cleanup, validation, uniqueness checks, read-only rules, autosave, and
publish review as the picker. Enter `/` for the homepage. **Generate** replaces
the final segment while preserving the typed parent path: `/about/team` becomes
`/about/hello-world` for a title of “Hello World.” A trailing slash specifies a
folder to append to; `/about/company/` generates `/about/company/hello-world`.
Generation waits for malformed paths to be corrected. A blank input generates
at the site root. A contextual creation action pre-fills its folder with a
trailing slash, so Generate uses that folder unless the editor clears it.

Collection items retain their resolved, read-only prefix beside the editable segment in both
modes. Text mode does not make a collection prefix editable on individual items.
In folder mode, an invalid existing page pathname can still appear in a full-path
repair input; that recovery behavior is separate from the configuration option.

The custom field currently uses Sanity's native slug object, storing its value
in `current`. The shared routing helpers also support ordinary string fields
such as `route: '/about/team'`. A consumer can register those fields and use a
native string input, but doing so does not install this custom field's generation,
cleanup, validation, or folder-saving behavior. Supporting string storage in
the routing layer is not the same as supporting it in this input component.

### Editing published pages

Published pages use the same normal draft URL editing as new pages. Changing the
draft leaves the live URL unchanged. When the editor clicks Publish and an
existing live URL has changed, a dialog puts the old and new URLs first, with
the redirect checkbox directly below them.
“Redirect the old URL to the new URL” starts checked. Unchecking it publishes
without creating a new redirect. Cancel closes the dialog and keeps the draft.

When older redirects already point to this page, the dialog lists their sources
and old/new destinations below the checkbox. The old destination has a soft red
highlight and a strikethrough; the new destination has a soft green highlight on
the next line. Publishing updates those same records to point directly
to the new URL, preserving their status and other fields. This avoids sending a
visitor through a chain of redirects. Those reviewed updates happen even when the
checkbox is off; the checkbox controls only the new rule from the current URL.

Publication saves the reviewed draft, updates to existing redirects, its optional
new permanent redirect, and a private operation receipt together in one Sanity
transaction. Unlike a folder
rename, this is ordinary document publication: all reviewed draft content is
published, not just the URL. New pages and edits that leave the live URL unchanged
use Sanity's normal Publish action.

The field and action coordinate while an editor types. Publish waits for local
URL checks, native draft saving, and native validation to finish. If the document
or routing evidence changes during review, the editor must reopen the review.
If a request fails while loading the review, **Retry** runs the checks again
inside the dialog using the latest document version. It only reads data;
publishing still requires a successful review and a separate Publish click.
If another page occupies the proposed URL, the review shows a red error notice
with that URL and a clickable page row that opens the Structure editor.
The row shows the page's configured title (when readable) and URL, using the
navigator’s hover styling and native version-status dots. The URL and
its owner appear together, separate from the guidance below. Document IDs stay
out of the notice; if a title cannot be loaded, the row still opens the page.
A redirect conflict instead shows its source and destination with an
**Open redirect** link; reserved application URLs explain
that their routing configuration must change. These details help editors find
the blocker. They do not weaken the uniqueness checks or automatically modify
another page or redirect.

If a response is lost, **Check publish status** reads the operation receipt;
it does not send the publication again. An unconfirmed result remains uncertain.
A warning at the top of the dialog explains this and stays visible while the
editor checks the result. The button reads “Checking result…” during that check.
Editors can close this dialog and keep working, including while a check is in
progress. The document's Publish action becomes **Check publish status**;
it reopens the original attempt instead of sending another publication.

The expected receipt is saved separately for each project, dataset, and document
in the browser tab's session storage. Navigation and reloading that tab preserve
the pending check. If browser storage is unavailable, an in-memory fallback
preserves it while Studio stays open, but cannot survive a full reload. This is
local recovery state, not a lock across browsers or other editors. An absent
receipt is still not proof that publication failed. If checking cannot resolve
the outcome, a developer or Studio administrator needs to investigate; the UI does not offer a blind
retry or an option to discard uncertainty.

After either an ordinary successful URL publication or a successful result check,
a native success notification says **Page published** and includes the published
URL. It remains visible for nine seconds and can be dismissed. A result check
confirms the reviewed operation, not edits made afterward. If the original
request instead returns a definite server rejection while the editor is away,
the resumed check reports **Publication not completed** and allows a fresh
review. Only that explicit rejection clears the uncertainty; a missing receipt
does not.

This private integration creates redirect records; consumers still need the
forthcoming routing integration to serve them as HTTP redirects. Saving a rule
alone does not change how an application's router behaves. See
[the redirect design](./redirects-design.md#how-pages-creates-redirects).

### Pages with planned release versions

Release-aware URL handling is deferred until a consumer needs it. This is a
limitation of SanityKit's current implementation, not an error in the editor's
content. Publishing a changed live URL is blocked when the same page has a
Content Release version, because that version could later restore a URL that
conflicts with the new redirect. The kit does not modify or remove release work.

Editors can keep the current live URL and publish other content edits through
Sanity's normal Publish action. For the URL change, they can finish the planned
release first and retry once no release version remains. Removing the page from
a release is only appropriate when that inclusion is no longer needed; the
notice must not encourage discarding planned work to bypass this limitation.

### App-owned URL sections

Set `reservedPathPrefixes` in the shared `routes` configuration to reserve whole
sections, such as `['/account', '/api']`. The field refuses both the prefix itself
and paths below it. The same check applies to page URL resolution, publish review,
and redirect sources. `/accounting` is not part of `/account`; redirect destinations
may still point to `/account/settings`. See [URL ownership configuration](url.md).
Keep this policy in the shared routes rather than repeating it on individual fields.

### When redirect data is incomplete

The lower-level checker requires its caller to mark a redirect inventory as
complete. If that flag is missing or false, it refuses to approve a change:
a partial list could hide a conflicting redirect or a loop. This means the list
is incomplete, not that a particular redirect is missing a destination.

The built-in Studio workflow marks the list complete after a successful bounded
fetch and a separate read-access check. Connection failures and excessive record
counts have their own notices. The **Redirect data is incomplete** simulation
exercises a defensive caller-contract failure; it is not an expected result of
ordinary editing or a half-downloaded response. The flag itself cannot prove
that credentials can read every document.

### Current publication limits

- Existing redirects pointing to the old URL appear in the same publication
  review. Affected redirects with a draft or release version block publication
  until that pending work is resolved; no unrelated draft is published.
  The notice identifies the redirect and links to its pending version. Updating
  only its published version with explicit approval is deferred to redirect
  management, together with safeguards against later publishing an outdated draft.
- The redirect inventory is bounded to 1,000 records and 1 MiB of projected data,
  including disabled records and pending versions. One publication can update at
  most 100 existing redirects, with a 1 MiB budget for its action request. These
  are kit limits, not Sanity platform quotas. Oversized operations stop before
  writing; they never apply just part of the change.
  Notices distinguish the number of affected redirects, the full inventory's
  record count, its data size, and the combined request size when publishing. Each shows
  the measured value and supported limit. A bounded read reports **at least** the
  amount found, rather than pretending to know the complete total. Projected data
  sizes include reserved metadata space and are labeled **estimated**. Invalid
  redirect data gets a separate notice describing the correction needed.
  Review obsolete rules and unintended URL values before retrying; disabling a
  rule does not remove it from inventory limits. If all records and updates are
  needed, the workflow must be expanded by a developer. Increasing a limit alone
  does not establish that larger reads and atomic writes are supported.
- The destination cannot already be a page, redirect source, or reserved path.
  Both the current and resulting redirect graphs must be valid.
  A conflicting redirect appears as a clickable row showing its source and
  destination, with the same document-status indicators as the navigator.
  Clicking a page or redirect row in Pages or Presentation opens that document
  in the same editor panel and keeps the website preview in place. In Structure,
  these links open through its normal document navigation. Generated redirects are
  still read-only in this slice; redirect management is separate work.
- Existing release versions, live editing, and invalid old published URLs remain
  unsupported. Scheduling is removed for registered types in this private plugin.
- The wrapper covers the document-pane Publish action and its shortcut. API
  writers, custom actions, bulk publication, and Content Releases can bypass it;
  installing a Studio plugin is not a dataset-wide publication rule.
- Revision guards protect the documents being published. URL/redirect inventory
  checks do not reserve every possible path against concurrent external writers.

The integration is private while these boundaries receive acceptance testing.

## Trying different URLs without accumulating redirects

Typing, generating a slug, changing folders, and saving drafts create no
redirects. Editors can try several draft URLs and preview them before publishing.
Only a changed, previously published URL can create a new rule, and only when the
publication checkbox is checked. Updating older rules reuses those records.

Repeatedly publishing experimental URLs with the checkbox enabled will accumulate
redirects. Uncheck it when the old URL does not need forwarding. The kit does not
automatically expire or delete older rules: a URL's age alone cannot tell us
whether people still use it. General redirect management and deliberate cleanup
remain separate work.

The pure redirect helper builds a lookup table once per loaded snapshot, so it
does not scan every rule for each match. The planned cache adapter lets consuming
apps reuse that snapshot. HTTP delivery and caching are not implemented in this
slice. Studio publication deliberately reloads current routing evidence for its
review and final checks; larger inventories increase that work.

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

### Starting a page from a folder

Pages can open a new draft from an ordinary folder’s menu. **Create page** sets
that folder as the URL field’s starting selection, but leaves the final segment
blank. For `/about`, entering `team` then proposes `/about/team`. The field saves
nothing while that final segment is missing; `/about` is already the folder’s
index URL and must not be used as a placeholder for a child page.

**Create index page** proposes the folder URL itself. It passes through the same
access, uniqueness, folder-preservation, and read-only checks as a typed URL before
native draft autosave receives a patch. An index URL that another page already
uses remains a local proposal with the normal validation feedback. There is no
automatic publication or guaranteed URL reservation.

The starting location arrives in Sanity’s native create-intent parameters and is
kept in the Studio URL, not in an extra document field. The input checks that this
context belongs to the selected document, schema type, template, and URL-field
path before using it. Existing stored or template URL values are not overwritten.
The ordinary header Create page action has no folder hint and keeps its existing
behavior. These contextual actions require the kit-managed URL field; a plain
string path input cannot consume the hint.

Creation hints are temporary starting values, not a durable creation history.
Reopening an old creation URL after an external writer completely removes the
URL field can apply its original hint again. A normally opened document has no
creation hint. Existing nonempty URLs are always preserved.
An empty template URL object can receive the hint before its first save. On
reload, an already-saved empty object is left alone because it may represent an
editor's deliberate choice to clear it. A title-only draft with no URL field
still receives its original folder suggestion.

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
parent path while changing the final segment. Settings-backed collections use
`collectionRouting` to read their draft prefix; editors change that prefix in the
collection settings document, not on each item. Moving a legacy item between
nested folders remains later work.

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

The private controller checks the editor's read permissions before loading a
bounded inventory of registered documents. URL editing and publication use the
same access checker. It checks the document types and versions needed by the
operation, rather than requiring a particular role name or unrestricted access to
unrelated content. Custom roles can pass when their grants establish that coverage.
A successful empty query alone is not evidence of complete visibility: Sanity
may have filtered out documents the editor cannot read. Sanity continues enforcing
write permissions.

Both operations need read access to every registered page type, including drafts
and release versions, and to the folder registry. Publication also reads redirect
records and the internal records used to confirm a publication after a lost
response. Editing does not require access to redirects. The registry and recovery
records need access by ID or namespace, even if their stored type is malformed;
otherwise a broken record could look like a missing record.

The checker reads Sanity's effective dataset permissions for the current user.
It combines read grants and understands boolean conditions, equality and literal
lists for document types, exact metadata IDs, and complete ID namespaces such as
`drafts.**`, `versions.**`, and `sanityKit.**`. It uses Sanity's GROQ parser. More
complex filters, including ownership conditions and narrower namespaces, remain
unverified unless another grant proves the required coverage. It never guesses
access from a few sample documents or from the editor's role name.

If required access is missing or cannot be verified, the field and publication
dialog name the access requirements that need attention. **Missing read access**
means the returned grants do not cover a requirement. **Read access could not be
verified** means the kit cannot prove coverage, for example because it cannot
safely interpret a custom grant filter. These are different conditions; an
unverified requirement does not prove that the editor has been denied access.
The notice directs editors to someone who manages project permissions to review
the requirements; it does not assume editors can change role settings. It identifies
configured document types, version categories, and internal records needed by
the check; it does not reveal hidden documents' titles or IDs.

The publication dialog and initial field loading show these requirements in a red
notice. If access changes while preparing an edit, the same details appear in the
field's native validation feedback beside the URL label. No draft patch or
publication is sent until the relevant checks pass. Reloading the field or
starting a new publication review checks the current permissions again.

Before returning an applicable candidate, the controller:

- Refuses documents involved in releases. Published documents require the paired
  publication plugin before their drafts can be edited.
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

When existing redirect data is invalid, the publish dialog shows the affected
URL and a link to the identified redirect when that information is available.
For duplicate source URLs, it lists all active published redirects using that
source so the editor can inspect each rule. Loops and chains show connected
redirects in order; chains also show their final destination. When a redirect
competes with a page for the same URL, the notice links to both records. Invalid
field values show the field name, a bounded description of its current value,
and what needs correcting. Missing or unusable data-loading results have their
own message and never invent a document to link to. Disabled redirects and
unpublished versions are not presented as active duplicates or graph connections. The notice uses only records
already read for the review; it does not reveal documents the access check could
not verify.

## How the source fits together

| File                                                                | Responsibility                                                                                                      |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `src/studio/url/field.tsx`                                          | Connect the schema, native validation, and custom input.                                                            |
| `src/studio/url/input.tsx`                                          | Keep a local proposal, render controls, and emit the final native patch.                                            |
| `src/studio/url/creation-context.ts` and `creation-presentation.ts` | Validate the private location hint and read it from native Presentation parameters; do not write document metadata. |
| `src/studio/url/validation.tsx`                                     | Pass local proposal errors to Sanity’s native field header without changing stored validation.                      |
| `src/studio/url/folder-picker.tsx`                                  | Folder selection and the creation modal; delegates persistence to its caller.                                       |
| `src/studio/url/edit.ts`                                            | Read access/version evidence, check conflicts, and preserve folders before a patch.                                 |
| `src/studio/url/generate.ts`                                        | Bind native source/generator callbacks to the shared authoring helper.                                              |
| `src/studio/url/conflicts.ts` and `is-unique.ts`                    | Check occupancy and adapt it to native slug validation.                                                             |
| `src/studio/folders/`                                               | Read, plan, and save organizational folder records.                                                                 |

Publication has a separate path through the code:

- `publication-plugin.tsx` pairs the field with the document action across
  Structure and Presentation. Its layout context enables published-page editing
  only for the same route registration.
- `publication-state.tsx` connects local field proposals to Publish readiness;
  Sanity's own saving state cannot see a value the field has not patched yet.
- `publication-action.tsx` preserves native Publish behavior and shows the URL
  change dialog when needed.
- `publication-plan.ts` checks the redirect graph without reading or writing data.
- `publication-diagnostics.ts` turns checked redirect records into field errors,
  connected redirect rows, and bounded display values for the review dialog.
- `publication-limits.ts` measures bounded redirect data and describes which limit
  was reached. `publication-limit-notice.tsx` turns that evidence into readable
  counts, sizes, and next steps in the dialog.
- `publication.ts` reads fresh evidence, guards revisions, sends the atomic Actions
  API request, and reconciles uncertain responses using a private receipt.

The proof Studio wraps its workspace configuration with the private
`withUrlPublication(config, {routes: proofRoutes})` helper, then passes that result
to Sanity's `defineConfig`. The helper installs the layout context and finalizes
Publish actions at the workspace root, after all plugins have supplied their
actions. Plugin order alone is not enough: Sanity adds built-in actions after
consumer plugins.

The helper preserves existing root action customization before applying its own
wrapper. Its layout checks the final resolved actions and reports a configuration
error if Publish is unwrapped or unsupported scheduling actions remain. Do not
replace the finalized actions afterward. The field uses the same `proofRoutes`.
These are not public package imports yet. Generated redirects are read-only in
Studio and omitted from creation templates until redirect management is
implemented.

The tests cover each boundary and the complete input/picker interaction. Live
proof-Studio acceptance is recorded separately in
[`ACCEPTANCE.md`](../tests/fixtures/pages-studio/ACCEPTANCE.md).
