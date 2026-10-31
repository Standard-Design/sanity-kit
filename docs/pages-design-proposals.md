# Pages: approved contracts and remaining proposals

Prepared October 30, 2026; approvals updated October 31. The folder-storage and
synchronization direction, reviewed folder-rename policy, collection-prefix
preview/publication lifecycle, and the field/helper/creation behavior described
below are now approved. **They are not implemented features or finalized public
APIs.** The initial fixed-prefix [URL resolver](url.md) is now implemented and
approved locally; the editor and persistence workflows below are not. The private
[authoring preparation](url.md#authoring-preparation-internal) is implemented and
approved, with Sanity-compatible generation. The next private
[conflict-checking layer](url.md#url-conflict-checks-and-native-validation-internal)
is implemented and approved. It uses a native `options.isUnique` adapter and excludes
all versions of the current document, following Sanity. The field UI and write
safeguards remain future work. Remaining
proposals are explicitly identified. See also
[the Pages guide](pages.md#design-decisions-and-remaining-work).

The private [folder validation and planning](folders.md) foundation is approved.
[Collection-settings resolution](collection-routing.md) is also approved.
These layers do not yet add schema registration, persistence, editor
controls, or publication actions. Their guides explain the exact behavior and
limits of each slice.

[Redirect snapshot validation](redirects.md) is also approved.
The integration tests exercise the shared route configuration across these
foundations without writing to Sanity.

The private collection-settings loader is approved. The folder read layer is
under review. Both preserve the foundations' perspective and validation rules.
Reads alone do not establish publication safety or authorize mutations.

The private [Studio generation bridge](url.md#studio-generation-context-internal)
is implemented and approved. It binds native source and slugify callbacks, returns
candidates, and discards invalidated async results. The field UI must still clear
displayed candidates, confirm replacement, check conflicts, and apply changes.

## Folder storage

Approved October 31: private internal metadata, one registry document per dataset,
immediate organizational changes, no frontend dependency, and path-derived page
placement. Exact schema fields, limits, and concurrent-write mechanisms still
need implementation review.

Use one internal folder-registry document, `sanityKit.folders`, in the configured
Sanity project/dataset. It
contains a schema version and an array of folder records with stable keys and
canonical paths. Page documents keep their own pathnames; they do not acquire
parent-folder references. The initial kit supports one website per project/dataset.
There is no separate `site` identifier. Multi-site routing is deferred until it
has a concrete use case.

This is a deliberately managed singleton, not a path-derived ID for each page or
folder. Place its ID in a kit-owned dotted namespace, outside Sanity's reserved
namespaces. Sanity restricts unauthenticated access to documents whose IDs contain
dots. This is separate from hiding the type in Studio's content lists and create
menus. Authenticated access still depends on permissions; the document is not
secret from authorized project users. See [Sanity IDs and paths](https://www.sanity.io/docs/content-lake/ids).

The kit should supply and document the internal schema and operations. Consumers
keep ownership of their Studio and dataset. Folder metadata should take effect
immediately, with no draft/publish step, because it organizes the editor rather
than publishing a website page. The frontend should not need to fetch it.

A singleton gives us one revision to check when preventing duplicate folder
creation and coordinating kit folder writes. It also creates a size and write
contention limit: test and document supported bounds, and refuse oversized writes
rather than silently splitting state. Revisit per-folder documents if real sites
outgrow those bounds.

Collection routing settings are different: the frontend needs their published
prefixes. Do not place them in the private folder registry or silently require a
read token for otherwise public routing data.

## Persist inferred folders too

Approved October 31: adopt inferred folders so they have the same lifecycle as
explicitly created folders. Once adopted, moving the last page does not remove
them.

- Setup offers an explicit synchronization step that finds valid folder paths
  implied by registered page documents, including required ancestors, and saves
  the missing records. Root remains implicit; collection groups remain separate.
- URL changes made through the kit ensure both existing and destination folder
  ancestors are retained. The exact write integration must be tested with native
  field patches; do not claim page and metadata changes are atomic until it is.
- Imports and other API writers can run the same synchronization operation. Until
  synchronization, the navigator can still display inferred folders, but cannot
  guarantee an imported empty folder will survive if its last page moves first.
- Opening or searching the navigator remains read-only. No hidden background
  migration runs simply because an editor views the tool.

Synchronization is additive. It never removes unused folders. Empty-only removal
checks index pages, descendant pages, and saved subfolders across relevant drafts,
published documents, and release versions, not just the currently visible tree.
If access is insufficient to establish emptiness, refuse removal.

## Reviewed folder renames

Approved October 31: a deliberate **Apply URL changes** operation, not an automatic
side effect of typing a folder name. The modal lists old/new URLs, affected document
versions, and which changes affect the live website. The approved policy preserves
draft-only status and unrelated content, stops for conflicting draft URLs or
affected releases, and uses bounded atomic writes with revision checks. Concrete
permissions, concurrency mechanisms, and size limits are implementation gates.

For the first implementation:

- Draft-only documents remain drafts; change only their URL fields.
- Published documents receive URL-only patches after explicit confirmation of
  live impact. Update matching existing draft URLs too, without publishing any
  other draft content. If a draft already has a conflicting planned URL, stop
  and ask the editor to resolve it; do not overwrite that plan.
- Refuse operations involving affected release versions until release-aware
  changes are supported. Also refuse protected/read-only URLs and collections
  whose configured prefixes would be crossed by an ordinary folder rename.
- Review the folder index page, all descendant pages, and saved descendant folder
  records. Never merge destination folders implicitly.
- Validate destination URLs, reserved routes, collisions, and permissions before
  offering Apply. Patch reviewed documents by ID with revision guards. If anything
  reviewed changes, stop and rebuild the review instead of blindly retrying.
- Keep the folder records and affected document mutations in one bounded
  transaction. If the operation is too large, refuse it and require a separate
  migration workflow rather than applying half a rename.

Sanity supports atomic transactions and revision-checked patches. This protects
the included documents against partial commits and lost updates; it does not
turn a prior GROQ collision query into a global uniqueness constraint. Queries
can lag writes, and an external writer can introduce a conflicting document.
See [Sanity transactions](https://www.sanity.io/docs/content-lake/transactions).

Before shipping, define coordination for concurrent kit URL writes and tests for
stale queries, new documents, and new draft/release versions during review. Keep
the external-writer limitation explicit; do not claim database-wide uniqueness.

## Collection prefix changes

Approved October 31: editors can preview a draft settings prefix, then explicitly
publish the reviewed routing change. Public traffic continues using the published
prefix until activation. Item documents retain their slugs; no per-post URL rewrite
is needed. Independently located listing pages do not move. One settings document
per collection remains the preferred arrangement; its concrete schema,
registration, and optional overview relationship still need finalization.

The small storage change does not eliminate activation work. The kit must validate
the newly resolved URLs, review old/new URLs for redirects, use the correct
perspective in Studio and frontend helpers, and coordinate cache refresh. Redirect
rules or operation metadata may be written even though post documents are not.
Propose a controlled settings action to enforce that review, rather than an
unchecked generic publish shortcut; the exact action integration remains to be
implemented and tested.

Show the affected resolved URLs even though only the settings document changes.
Refuse conflicting reserved routes, overlapping collection ownership, unsupported
frontend path shapes, and unsupported release scenarios. Keep code-fixed prefixes
outside this editor workflow.

Frontend links, lookup, preview, and sitemap generation must use the same routing
settings and perspective. Invalidate published routing caches after activation;
do not describe the website's caches as part of the dataset transaction.

## Redirects and recovery

The detailed [redirect subsystem design](redirects-design.md) proposes an optional
built-in Sanity-backed implementation, frontend helpers, and a consumer-supplied
cache adapter. It supersedes the earlier assumption that every consumer must
provide its own redirect system. These are still proposals, not implemented APIs.

For the test-only fixture, explicitly allow applying changes without redirects.
For real consumers, recommend requiring a configured redirect policy or an
explicit authorized acknowledgment that old URLs will stop working. Produce an
old/new URL manifest for review and recovery. Consumers could use the proposed
built-in subsystem or retain an existing service; neither requires a Cloudflare
dependency. External-provider integrations remain follow-up work.

A same-dataset redirect adapter could contribute mutations to the URL-change
transaction. An external redirect service cannot share that atomicity; it needs
a separate staged activation/retry contract before we enable that integration.
Cache refresh failure after a successful commit must be reported as a refresh
failure, not as though the data changes were rolled back. A network timeout with
unknown commit outcome requires reconciliation before retrying.

## Field and helper contracts

Approved October 31: one field factory sharing routing registration, a configurable
title source and slug generator, shared validation without silent numeric suffixes,
pure resolution against separately loaded settings, explicit success/failure
outcomes, and the root representation below. Function names and exact TypeScript
shapes require implementation approval except for the approved fixed-prefix
resolver. It uses `createSanityUrlResolver()` from `/url` and the `ok`/`value` result below;
see [its guide](url.md) for the implemented scope and exact failure reasons.

- **One field factory:** resolve the storage mode and prefix source from shared
  type/collection registration. Do not configure the prefix independently in the
  schema, navigator, and frontend. The exact factory and registration names remain
  open; no example here is an exported API.
- **Existing storage:** preserve native slug-shaped fields such as
  `pathname.current` and `slug.current`, with explicit field mappings. Do not
  silently migrate existing strings or introduce a three-value stored URL object.
- **Title source:** accept a field path such as `title` or `name`, or a callback
  when the name is composed from multiple fields. Permit a custom slugifier.
- **Generation:** agreed October 31 to follow native Sanity generation: use
  `speakingurl`, symbol conversion, and native truncation (200 by default).
  Custom generators may be async and bypass `maxLength`; all results still pass
  kit URL-safety validation. See the [detailed rules](url.md#generate-follows-sanity-defaults).
  Present the candidate before replacing a
  nonempty value; never append a number silently to resolve a collision. Ordinary
  title changes do not regenerate URLs. Empty names produce helpful feedback.
- **Read-only:** honor the native field's static or conditional read-only state
  across every control. A locked collection prefix is a separate restriction.
  Read-only prevents edits here, not a centrally authorized collection move.
- **Pure resolution:** take a document plus already resolved routing context and
  return a result. Loading settings is a separate operation so callers can cache
  once and choose the correct published/preview perspective explicitly.
- **Successful result:** the agreed value is `{pathname, prefix, slug}`; the
  approved wrapper is `{ok: true, value: {pathname, prefix, slug}}`.
  For `/about`, use `{pathname: '/about', prefix: '/', slug: 'about'}`. For the
  homepage, use `{pathname: '/', prefix: '/', slug: ''}`; empty collection
  item slugs remain invalid.
- **Unsuccessful result:** distinguish missing values, invalid values, and
  unavailable routing. The approved wrapper is `{ok: false, reason: ...}`.
  Do not fabricate a URL. Reverse lookup must also distinguish not-found from
  ambiguous matches. Consumers decide
  whether to render a warning, omit a link, or return an HTTP error.

The successful inner `{pathname, prefix, slug}` shape is agreed. The result
wrapper and fixed-prefix reason codes are approved and implemented, not yet
released. Private settings-backed resolution is now approved. Its read-only
loader is also approved; editor/publication controls remain future work.

## Creation contract

Approved October 31: explicitly register eligible types/templates, skip the chooser
for one eligible choice, offer it for several, and create drafts without
auto-publishing. The contextual defaults and parameter integration below remain
detailed proposals.

Register eligible schema types and native templates explicitly, with optional
defaults. Apply permissions and context before showing choices: one eligible
choice can open directly; multiple choices show a chooser; none disables the
action with an explanation. Browsability alone does not grant creation access.

Folder-menu creation prefills that prefix, header creation uses root as the
suggested starting location, and index creation supplies the exact folder URL.
Collection creation offers only its registered item choices. Preserve unrelated
template values; fail configuration checks when URL initialization rules conflict
rather than silently overriding them. Create drafts, never auto-publish.

The concrete template-parameter API and generation rules need review before
implementation. Ordinary document IDs remain Sanity-generated.

## Remaining review items

- Exact folder schema, supported size limits, and
  concurrency/synchronization protocols. The singleton and immediate lifecycle
  are decided; their implementation is not.
- Settings registration/schema and any optional overview shortcut. Draft preview
  followed by reviewed publication is decided; action and cache coordination need
  implementation design.
- Field/settings API names, their failure codes, template parameters, and native
  source/context integration. The fixed-prefix resolver API, root value,
  Sanity-compatible generation behavior, configurable sources, and chooser
  behavior are decided.
- Publication/redirect/cache integration and its acceptance gates. The separate
  [redirect design](redirects-design.md) now covers this subsystem; acknowledging
  that design is not approval of every proposed status, query, or failure default.

These approvals authorize the design direction, not a commit, release, live
dataset mutation, or changes to the committed fixed-prefix routing foundation.
