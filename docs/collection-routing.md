# Collection routing settings

## What this part of the kit does

A post can store the slug `first-post` while a separate routing setting supplies
`/journal`. Together they produce `/journal/first-post`. Changing the setting to
`/blog` changes the resolved URL without rewriting the post.

This keeps reusable content separate from the website's organization. The post
owns its slug. A collection's routing settings own the prefix used on this site.
An ordinary page still stores its complete pathname.

This version supports one website per configured Sanity project and dataset.
There is no separate website discriminator in the configuration or documents.
Supporting several websites in the same dataset is deferred.

The implementation is a **private foundation**. A pure resolver validates supplied
documents and builds the ordinary route configuration used by the existing URL
helpers. A separate loader can now read those documents from Sanity. Neither is
exported from a package entry point yet. A private Studio integration now adds
settings documents and native draft editing. The loader and resolver still do
not cache settings, write documents, or publish changes. The existing public
`PagesRouteConfig` continues to require string prefixes.

See [URL handling](url.md) for the existing storage and resolution rules, and
[Pages design decisions](pages-design-proposals.md) for the broader editor plan.

## Defaults and locked settings

The display name and URL prefix each have their own ownership setting:

- **Default:** configuration supplies a starting value. Editors can change it in
  the collection settings document.
- **Locked:** configuration owns the value. Studio shows it in a disabled,
  read-only field. Saved values cannot override it.

For example, editors can rename Articles while its `/articles` prefix stays fixed:

```ts
{
  name: 'articles',
  settingsDocumentId: 'articles-settings',
  displayName: {mode: 'default', value: 'Articles'},
  routePrefix: {
    mode: 'locked',
    value: '/articles',
  },
  index: {schemaType: 'page', pathname: '/articles'},
  items: [{schemaType: 'article', slugField: 'slug.current'}],
}
```

Change either `mode` independently. Both can be editable, both can be locked, or
one can be locked while the other is editable. `settingsDocumentId` belongs to the
collection because one document holds all of its editable settings. It is required
when either setting explicitly uses `mode: 'default'`, or when the URL prefix is
omitted. Both settings can be locked without any settings document. Supplying an
ID still exposes their read-only form if that is useful.

The collection's stable `name` remains its identity; the display name is only a
label. `title` remains available as a fallback for older configuration, but it is
not necessary when `displayName.value` supplies the label. Without either, the
stable collection name is the fallback.

Default values initialize new settings documents through Sanity's initial-value
template. Changing a default later does not overwrite existing saved values.
An absent display name falls back to the configured name, since that only affects
Studio labels. A default **URL prefix is not a runtime fallback**: missing,
unpublished, invalid, or unreadable routing settings still produce a routing
error. A draft prefix never becomes live merely because it matches the default.

Locked values are taken directly from configuration, even when an older settings
document contains different values. Showing a locked field does not rewrite that
document. The routing loader does not need to read settings for locked prefixes.
Changing a locked prefix in code changes routing when that configuration is
applied; it does not create redirects or run the Studio publish review. Coordinate
that change with application routes and redirects before deploying it.

A plain string prefix remains shorthand for a locked prefix. It can now coexist
with `settingsDocumentId` and an editable display name.

Omitting `routePrefix` means the prefix is editable with no initial value. The
settings form starts with an empty prefix, and URL resolution requires a valid
saved setting. For example:

```ts
{
  name: 'articles',
  settingsDocumentId: 'articles-settings',
  displayName: {mode: 'default', value: 'Articles'},
  index: {schemaType: 'page', pathname: '/insights'},
  items: [{schemaType: 'post', slugField: 'slug.current'}],
}
```

Omitting `displayName` allows an editable name when a settings document is bound;
otherwise the configured `title` or stable `name` supplies its code-owned label.

The previous private `routePrefix.documentId` location is replaced by
`settingsDocumentId`; update configuration rather than changing stored documents.
The collection page property is now `index`, previously `overview`. It still
identifies an ordinary document and need not match the item URL prefix.

The binding identifies the document explicitly. The kit never guesses it from a
document title, index page, or matching prefix. Each bound collection needs its
own settings document.

For example, the private configuration can contain:

```ts
const routing = createCollectionRouting({
	pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
	collections: [
		{
			name: 'journal',
			title: 'Journal',
			settingsDocumentId: 'journal-routing',
			index: { schemaType: 'page', pathname: '/insights' },
			items: [{ schemaType: 'post', slugField: 'slug.current' }],
		},
	],
})
```

This is an internal API example, not a supported package import. The returned
`routing.documentIds` lists the published document IDs the loader needs to
read. The application supplies the project and dataset when it loads them; this
pure helper has no client or connection settings.

The index remains `/insights` even when the item prefix changes from
`/journal` to `/blog`. Other pages that list posts also keep their own URLs. The
existing Pages registry still requires a document-backed index for each
registered collection. This slice does not add document-free index pages.

## The stored settings document

The proposed document shape is:

```json
{
	"_id": "journal-routing",
	"_rev": "revision-from-sanity",
	"_type": "sanityKitCollectionRoute",
	"collection": "journal",
	"prefix": { "_type": "slug", "current": "/journal" }
}
```

`collection` must exactly match the registered collection name. The document
type, identity, collection, revision, and prefix are checked before the prefix is used.
The prefix must be a complete, non-root pathname with no repeated or trailing
slashes. Invalid values are rejected rather than silently rewritten during a
read.

The configured published ID must have no dots. These settings are intended to be
readable by the public site's data client when the dataset and access policy
allow it. They are not private folder metadata, and they must not contain
secrets. A private dataset still requires an appropriately authorized client.

Settings-backed collections require slug-only items. The private factory rejects
a binding on a collection whose items store full paths: changing the prefix
would otherwise disagree with those stored paths. Existing code-fixed collections
can continue using the supported legacy full-path registration.

## Published and preview reads

The caller supplies a snapshot with raw document identities:

```ts
const result = routing.resolve(
	{
		status: 'available',
		perspective: 'raw',
		coverage: 'published',
		complete: true,
		documents: loadedSettings,
	},
	'published',
)
```

`coverage: 'published'` means the caller checked all configured published IDs.
This works with a public client that cannot read drafts. For preview, use
`coverage: 'published-and-drafts'`: the caller must also have checked the exact
`drafts.` counterpart of every configured ID. An empty result means a document
is absent only when that read was complete and had the necessary access.

The requested mode determines which records are used:

| Mode        | Required coverage      | Selected document                                  |
| ----------- | ---------------------- | -------------------------------------------------- |
| `published` | Either coverage value  | Exact published ID only                            |
| `drafts`    | `published-and-drafts` | Exact draft ID, or published ID if no draft exists |

A draft with an invalid prefix blocks preview resolution. It does not fall back
to a published prefix and hide the problem. Invalid draft contents do not affect
published resolution. Duplicate selected records are ambiguous and are refused.
Records for other IDs are not substituted for the configured document.

Release perspectives are unsupported in this slice. A draft-only settings
document can be previewed, but cannot supply a published URL. A snapshot produced
by merging drafts over published identities is not the raw input this helper
expects; a selected record whose `_originalId` disagrees with `_id` is refused.

The coverage flags are a caller assertion, not proof of permissions or freshness.
The loader or caller must make that assertion honestly. The helper cannot tell
whether a query omitted an ID, a permission rule hid a draft, or cached data is
stale. A failed or incomplete read should be supplied as
`{status: 'unavailable'}`. Published-only coverage cannot be reused for a draft
preview. A configuration with only code-fixed prefixes does not depend on any
settings snapshot at all.

## Loading settings from Sanity

The private `createCollectionRoutingLoader(config, client)` combines the pure
resolver with a small, read-only Sanity query:

```ts
const loader = createCollectionRoutingLoader(config, client)
const result = await loader.load({
	perspective: 'published',
	signal: request.signal,
})
```

It queries only the explicitly configured document IDs. Published requests read
only published IDs, so they can use an unauthenticated client when those records
are publicly readable. Preview requests also read the exact draft counterparts:

```ts
const result = await loader.load({
	perspective: 'drafts',
	draftVisibility: 'all-required-drafts',
	signal: request.signal,
})
```

The visibility option is an assertion by the caller: this client's permissions
allow it to read every required draft. The loader cannot prove that from a query
response. Without the assertion, preview returns `access-unconfirmed` without
making a request. If credentials hide a draft despite that assertion, the loader
cannot distinguish the hidden draft from a nonexistent one. Applications must
establish those permissions before using this option.

The query uses raw identities and projects only the document metadata and prefix
needed by the resolver. It deliberately does not filter by document type or
collection: a wrong value must produce a validation failure, not make the
document disappear. An absent `_originalId` stays absent; an actual value is
preserved so the resolver can detect a merged identity.

Reads use the dated API version `2026-10-01`, `useCdn: false`, `stega: false`,
`filterResponse: true`, and `cache: 'no-store'`. The loader derives a configured
client without modifying the supplied client. A custom client or request wrapper
must honor those options; the kit cannot verify a wrapper's cache or access
behavior. This does not add a cache adapter. Every load performs a fresh query.
With only code-fixed prefixes, the loader neither configures nor fetches a
client, and requires no draft-visibility assertion.

The supplied client determines the project and dataset for the website. Use the
correct client, credentials, and document bindings. The kit does not infer a
dataset from the request host or add an authorization boundary around collection
names or document IDs.

The response must be an array with unique, expected document IDs. Duplicate or
unexpected IDs and malformed rows are rejected. At most 200 identities can be
requested; the query includes a 201st-row limit as an overflow check. The loader
also rejects a serialized response larger than 1 MiB. This is validation after
the response arrives, not a network download-size limit. Existing resolver
failures still distinguish missing settings, invalid content, and route conflicts.

Additional loader failures are `request-failed`, `invalid-response`,
`access-unconfirmed`, and `aborted`. Request errors are not exposed verbatim and
never become a fallback prefix. The cancellation signal is passed to the client,
and checked again after the request: a transport that ignores cancellation
cannot return a late success. Such a transport still has to settle before the
loader can finish.

## What resolution returns

On success, `result.value` contains:

- `routes`: the validated ordinary `PagesRouteConfig`, with every prefix resolved
  to a string. Existing authoring, uniqueness, and navigation helpers can use
  this shape once their callers are wired to load settings first.
- `resolveUrl`: the existing pure document URL resolver, bound to these routes.
  A successful document result contains `{pathname, prefix, slug}`.
- `settings`: the selected collection, document ID, revision, and prefix for each
  settings-backed collection. This records which versions supplied the context.

For a post whose stored slug is `first-post`, the resolver returns
`{pathname: '/journal/first-post', prefix: '/journal', slug: 'first-post'}`.

Configuration and results are copied and frozen. Changing the caller's
configuration or settings objects later does not alter an existing result. A
new settings snapshot needs a new call to `resolve`. This is isolation from
in-memory edits; it is not a guarantee that the snapshot is current in Sanity.

The complete resolved route set passes the existing registry checks. For example,
two collection prefixes cannot overlap. A prefix cannot be accepted merely
because it is valid in isolation.

Failures are explicit:

| Reason                    | Meaning                                                                         |
| ------------------------- | ------------------------------------------------------------------------------- |
| `settings-unavailable`    | The snapshot is unavailable, incomplete, or does not cover the requested mode.  |
| `settings-missing`        | The complete snapshot has no selected version for a required settings document. |
| `settings-invalid`        | A selected document or the supplied snapshot has invalid data.                  |
| `settings-ambiguous`      | More than one record has the selected document's exact identity.                |
| `routing-conflict`        | The resolved route configuration fails the shared registry checks.              |
| `unsupported-perspective` | The requested mode is neither published nor drafts.                             |

Invalid application configuration throws during factory creation. Invalid or
missing loaded settings return a failure instead of producing guessed URLs.
Snapshot rows must be objects with their own string `_id`; selected rows receive
the full checks described above. Unrelated or unselected rows are not required
to have valid settings contents.

## Limits and decisions to review

The private implementation proposes these initial bounds:

- Settings document IDs contain 1–121 letters, digits, underscores, or hyphens;
  they cannot begin with a hyphen. The reserved identities `drafts` and
  `versions` are refused. This leaves space for the draft prefix.
- A configuration can bind up to 100 settings-backed collections.
- A supplied snapshot can contain up to 1,000 records.
- Collection prefixes can contain up to 2,048 characters.

These limits, the document type and fields, and the private API names are concrete
implementation proposals for review before exposing a public API. Prefix length
is checked without truncation. Callers should supply only the relevant records,
not an entire dataset.

## What comes later

The private loader now reads the configured settings IDs and supplies the correct
snapshot for the requested mode. Future consumer integration must use its result
before calling the existing URL helpers. Any cache must distinguish project, dataset,
bindings, and perspective. Draft reads must never reuse public-only coverage.

Studio integration supplies the settings schema and draft controls. A prefix change
can then be previewed as a draft before a reviewed routing change is published.
Publishing needs checks for conflicting page URLs, concurrent edits, redirects,
and cache invalidation. Those are separate from resolving an already-loaded
snapshot. This slice does not make publication safe or activate a new route by
itself.

The consuming application still decides how React Router recognizes collection
URLs: for example, through dynamic routes or a CMS catch-all alongside explicit
application routes. It must use the resolved prefix consistently in routing,
links, sitemaps, and preview. The kit does not rewrite route modules or move
index pages when a setting changes.

## Editing settings in Studio (private integration)

The private `withCollectionRoutingSettings(workspace, {routes})` wrapper adds
one `sanityKitCollectionRoute` schema. `collectionRoutingSettingsItems(S, routes)`
creates a native Structure entry for each collection with a document binding.
Settings entries depend on `settingsDocumentId`, independently of the prefix
mode. A collection without that property has no settings entry.
These helpers are not exported from the package yet.

The consuming Studio chooses where to put the entries. For example, its Structure
resolver can use the same `routes` registration:

```ts
structure: (S) =>
	S.list()
		.title('Content')
		.items([
			...S.documentTypeListItems().filter(
				(item) => item.getId() !== 'sanityKitCollectionRoute',
			),
			S.listItem()
				.id('collection-url-settings')
				.title('Collection URL settings')
				.child(
					S.list()
						.id('collection-url-settings')
						.title('Collection URL settings')
						.items(collectionRoutingSettingsItems(S, routes)),
				),
		])
```

The filter keeps these singletons out of generic content lists. The integration
also removes their templates from ordinary creation menus. Opening a settings
entry uses the configured document ID and initializes its immutable `collection`
name. There is no `site` field and no separate index-page requirement for prefix
storage. Existing Pages navigation still requires its configured index page.

Editors use Sanity's normal slug input to enter the complete prefix, such as
`/journal`. Native draft autosave, field validation, read-only handling, and
permission checks continue to apply. A missing or incorrectly bound document,
and a release version, cannot be edited through this schema. Settings headings use the effective display name, such as **Articles collection
settings**. Sanity may show its generic new-document heading until the first save.
The stored collection key stays stable.

The read-only **Collection identifier** field appears at the bottom of the form.
It displays the stable key and cannot receive typing focus. Its description is
“Read-only string that identifies the collection”. Above it, **Display name** and
**URL prefix** each follow their own configured default/locked mode.

Editable names update the document heading and matching Pages collection labels
after Sanity autosaves the draft. The listener waits until saved changes are
visible to queries before refreshing. This prevents a refresh from reading the previous name just after a save. This metadata
read does not load or activate a prefix. A locked name always comes from code. Native Structure settings-list
labels use the configured name; the document heading uses the effective name.
Changing a name does not change identifiers, item slugs, URLs, or explicitly
configured item labels such as “Posts” and “Create post”. Metadata-read failures
fall back to the configured label without blocking navigation.

Validation checks the prefix's format, length, app reservations, and overlap with
code-configured collections. It does not fetch other settings or claim that the
prefix is globally available. A complete collision check needs fresh settings,
page URLs, and redirects, and belongs to the reviewed publish workflow. Sanity's
ordinary slug uniqueness check is disabled here because its schema/field scope
does not represent that full routing inventory.

### Default draft-only behavior and private publishing integration

By default, a visible notice explains that draft changes can be saved, but collection URL
publishing is not available yet. Existing published settings remain unchanged.
The only retained document action is Sanity's native **Discard changes**, with its
normal permission checks. Publish, scheduling, deletion, unpublishing, duplication,
release actions, and custom document actions are unavailable for this settings
type until they have an explicit safe integration. Other document types keep
their existing actions.

The private [settings Publish integration](collection-settings-publication.md)
adds guarded publishing behind an explicit development gate. It supports first
saves, unchanged prefixes, and reviewed prefix moves. The proof Studio explicitly
enables the gate with its shared live collection registration. Live checks on
November 10, 2026 verified a display-name save and repeated prefix moves, including
redirect creation and retargeting. Other installations remain draft-only unless
they enable the private gate. The first-ever settings publish remains untested
live; see the [acceptance record](collection-settings-publication.md#current-acceptance-boundary).

Use the workspace wrapper, not the plugin by itself: its final action reducer runs
after built-in tools and app reducers. A layout check refuses an unsafe later
replacement that would restore publishing. This is a Studio workflow guard, not
a Content Lake access rule; external writers can still bypass Studio validation.

The private live integration now connects saved prefixes to Pages and URL fields
when they receive `collectionRouting`. The proof website loads the same settings
in its requested perspective. Reviewed prefix publishing and its redirect updates
are connected through the private development gate. Their basic live save flows
are verified, but broader acceptance remains. The fixture does not yet serve saved
rules as HTTP redirects. Consumer cache activation is a separate application responsibility. Changing a
settings draft alone does not activate a new live route or rewrite item slugs.

## Collection actions in Pages

Pages now has collection-specific controls. They are Studio UI configuration,
separate from the plain route registration:

```ts
pagesTool({
	...resolvedRoutes,
	previewUrl: 'https://preview.example.com',
	collectionUi: {
		journal: {
			itemTitle: 'post',
			create: [
				{ schemaType: 'post', templateId: 'post', title: 'Post' },
				{
					schemaType: 'post',
					templateId: 'postWithIntro',
					title: 'Post with intro',
				},
			],
			// Optional: a React icon component from the consumer's Studio.
			icon: DocumentsIcon,
		},
	},
})
```

`collectionUi` is keyed by the collection's registered `name`. `itemTitle` is the
singular label used in **Create post**; it defaults to **Create item**, without
guessing how to singularize a plural title. `create` explicitly lists the allowed
native types and templates, just like the Pages header's creation setting. These
choices must belong to that collection. They do not inherit the Pages header's
choices, and they do not grant permission to create documents.

The collection `…` menu offers creation. A single permitted template is a direct
action; several open a native submenu. Loading, denied access, template problems,
and retry behavior use the same checks as ordinary page creation. The collection
browse header's `+` opens those same choices. Creation opens an ordinary native
draft and never publishes it or supplies a folder-placement hint. The collection's
route registration still determines how its URL field handles the item's slug.

Collection rows use Sanity's `DocumentsIcon` by default. Consumers may pass another
React icon component, including native memo/forwardRef icons. The icon and UI
choices remain in the Studio runtime; they never enter the pure URL registry,
settings documents, or frontend routing results. Folders keep their existing icon
and actions. Collections do not gain folder removal or rename actions.

### Opening settings without moving the website preview

**Settings** appears only when the installed `withCollectionRoutingSettings`
registration binds that collection to a settings document. Pages reads this
registration from the settings plugin's context, so it does not accept another
settings ID or prefix source in `collectionUi`. The name, item types, and stored
slug fields must match; a legacy full-path collection with the same name is not
treated as that settings-backed collection.

The link opens the configured singleton in the current native editor pane. It
preserves the preview URL, viewport, and preview perspective and clears parameters
belonging to the previously edited document. It also carries the singleton's
initial-value template, so a settings document that has not been saved yet starts
with the correct collection identity. Opening the menu or following the link
performs no direct dataset mutation. Native editing saves the draft normally.

Settings access and live routing are separate options. Add `collectionRouting`
to Pages, fields, and the publishing integration to use saved prefixes. Without
it, existing fixed-route integrations retain their behavior. With it, unavailable
settings block routing instead of falling back to the supplied fixed prefix.
Prefix publishing stays guarded.

### Reviewing this UI in the proof Studio

The existing Journal content and `kitProofJournalRouting` identity are preserved.
That separate settings proof now demonstrates a locked name and editable prefix. Journal's menu offers a direct **Create post** action and no Settings
link because its existing posts store complete pathnames.

A separate **Articles** collection demonstrates the new matched contract. It uses
`kitProofCollectionArticle` slug documents, the new `kitProofArticleRouting`
settings ID, and two creation templates. Its menu shows **Create article** with a
submenu and **Settings**; **Browse all articles** has the same choices behind `+`.
Articles demonstrates an editable default name and an editable prefix, initially
`/articles`. Pages, its URL field, and the proof website load that prefix in the
requested perspective. A draft prefix can differ from the published prefix.
No existing Journal content or settings identity needs to be migrated.

The November 10 publishing checks changed this test collection's display name to
**Stories** and its published prefix to `/stories-test`. Those are test-data
values, not new configuration defaults. The collection identifier stays
`articles`, and item slugs stay unchanged.

## Private Studio routing sessions

The private read boundary is installed by Pages and URL fields when
`collectionRouting` is supplied. The proof website uses the matching server loader.
Existing fixed-route integrations do not opt into these subscriptions.

For example, a collection can have a published `/articles` prefix and an edited
`/journal` prefix in its settings draft. The published session must keep returning
`/articles`, while the draft session can resolve `/journal` for preview. This
shared source of routing information lets the navigator, URL field, and
preview agree on which version they are showing.

`createCollectionRoutingStore(config, client, options)` belongs to one tool and
one Sanity client. It snapshots the registration and supplies separate sessions
for published and draft views. The sessions share neither resolved URLs nor
requests across those views. There is no package-wide cache.

Each session exposes `getSnapshot()`, `subscribe()`, and `retry()`. Its result is
one of three states:

- **Loading:** a routing check is in progress. Previously resolved URLs are not
  included, so a caller cannot accidentally continue using an obsolete prefix.
- **Ready:** the result contains validated routes, the shared URL resolver, and
  the exact settings revisions used to resolve them.
- **Unavailable:** settings are missing, invalid, unreadable, or disconnected.
  The result gives a reason rather than substituting a default prefix.

The store's separate `settingsDocuments` list contains the configured editor
identities and labels. The navigator therefore keeps Settings accessible
while routing is unavailable. This list does not contain fallback URLs.

Published sessions read only published settings. Draft sessions prefer a saved
draft and otherwise use the published version. An invalid draft blocks draft
resolution; it does not silently fall back to the published prefix. The caller
must provide `confirmDraftVisibility(requiredDraftIds, signal)` before draft
settings can be read. That check must establish access to every required draft;
successfully querying visible documents is not enough. The check runs again on
each refresh, and a missing or failed check returns `access-unconfirmed`.

String prefixes and locked prefix values resolve directly from configuration.
They need no routing query, listener, or draft-access check, even if the collection
has a settings document for its editable display name. Default prefix values
still only initialize new settings documents. The index page keeps its own
pathname when an item prefix changes.

The listener watches the exact configured identities using raw perspective and
query-visible notifications. Waiting for query visibility matters: a mutation
notification must not trigger a read before the changed value can be queried.
Welcome and mutation events refresh the session. A reconnect removes the old
routes until a new welcome event permits a fresh read. Failed requests and ended
connections also remove old routes. Retry repeats the check, and transports that
ignore cancellation cannot restore a superseded response. The last unsubscribe
releases the listener and aborts work; disposing the store closes every session.
Retry during a reconnect waits for that welcome too, so a successful query alone
cannot restore routes while future settings changes could still go unnoticed.

Only published and draft perspectives are supported here. Release stacks and
content variants return `unsupported-perspective` instead of being treated as
drafts. This restriction applies to the private session, not to existing fixed
Pages configurations.

`resolveCollectionPagesRuntime(snapshot, options)` is the matching private Pages
integration boundary. For a ready snapshot, it builds both the navigation model
and native Presentation resolvers from the same resolved routes. A changed
snapshot produces new main-document resolver arrays, which the Presentation
wrapper passes through without remounting the tool. The native document-location
banner uses a stable Observable resolver backed by the same routing store. Loading and unavailable snapshots
produce no runtime. Explicit consumer resolver overrides retain their existing
replacement behavior and remain the consumer's responsibility.

Native Presentation, URL input validation, uniqueness checks, and publishing
now opt into this context together through `collectionRouting`. Settings reads
do not authorize publishing a changed prefix or creating redirects.

## Checking URLs while a collection prefix has a draft

Preview routing and URL validation have different responsibilities. A preview
can show the draft `/blog/story` URL, but saving that slug also needs to consider
the live `/journal/story` URL. Otherwise an editor could choose a value that
looks available in preview while another page already owns its live address.

The private `createCollectionUrlConflictChecker` in
`src/studio/collections/url-conflicts.ts` prepares this authoring boundary. It
checks both URL spaces, and returns separate published and draft candidates and
conflict lists. For example:

- A post with the proposed slug `story` is checked at both `/journal/story` and
  `/blog/story` while the prefix change is unpublished.
- An ordinary page proposed at `/blog/story` is checked against posts using the
  draft prefix, even though its own pathname does not depend on settings.
- Each candidate URL is checked against both routing views, including other
  collections' prefixes. If Journal is moving to `/blog` while another collection
  is moving away from `/blog`, that other collection's live `/blog/story` still
  counts as a conflict. Two draft prefix changes cannot quietly assume that the
  other change will be published first.
- Active published redirect sources count as occupied URLs in either space.
- All versions of the edited document remain its own identity, so its own draft
  and published records do not conflict with each other.

This initial policy is conservative: other documents' published, draft, and
release versions count in both URL spaces. It may reserve a URL that only a
planned version would use. It does not guess which planned version will be
published first or resolve release-specific routing settings.

The settings loader's private `loadBoth()` operation reads the configured
published and draft settings identities in one raw query, then resolves each
view separately. Both views must resolve. A missing published prefix does not
mean an empty website or permission to use the configured seed value. An invalid
draft remains an error rather than falling back to the published prefix.

Before reading, the checker verifies access to the exact settings IDs, including
their draft counterparts. A successful query that omitted a hidden draft is not
proof that no draft exists. Exact-ID and broad read grants can satisfy this
check; a type-only grant cannot prove visibility of a malformed record stored at
one of those IDs. The occupancy queries separately require read access to all
registered page versions and published redirects. They do not require folder or
operation-receipt access because this check reads neither.

After checking occupancy, the service reads settings and permissions again. If
selected settings revisions changed, it returns `routing-changed` so the caller
can refresh before trying again. Failed reads, invalid settings, and canceled
requests never become empty conflict lists. HTTP cache settings inherited from
the supplied client are overridden for these checks.

Each candidate is checked with two bounded queries. Repeated conflicts are
combined by document identity; the result lists at most 20 conflicts per candidate
and reports when more exist. If the reads observe different revisions of the same
conflicting document, the check stops so the caller can try again with fresh data.

`createCollectionUrlIsUnique` adapts the same check to Sanity's native slug
validation. It verifies the registered field path, leaves storage unchanged, and
throws when the check cannot finish; only a completed check can return true or
false. It requires no Pages context and is installed by the settings-aware
field factory, including standalone fields.

These helpers remain private. Settings-aware field and Publish integrations use
them without publishing settings or rewriting collection item slugs. Query and
revision rechecks do not establish a database-wide uniqueness lock against
concurrent or external writers.

## Connecting live routing to Studio and the website

The private Studio APIs accept an optional `collectionRouting` configuration.
Pass the same object to `pagesTool`, `defineSanityUrlField`, and
`withUrlPublication`. Their ordinary route registration still identifies the
same document types and stored fields. With live routing enabled, its fixed
prefixes are never used as a fallback for failed settings reads.

```ts
pagesTool({ ...routes, collectionRouting, previewUrl })
defineSanityUrlField({
	routes,
	collectionRouting,
	name: 'slug',
	options: { source: 'title' },
})
withUrlPublication(workspace, { routes, collectionRouting })
```

These are private source integrations pending public API review. The consuming
app owns its Studio and website; SanityKit does not provide a hosted Studio.

Pages uses the selected published or draft perspective for navigation and native
Presentation locations. The URL field edits the draft, so it uses draft routing.
Native publishing checks live routing separately. A Pages-scoped provider shares
its store with matching nested consumers. A field in Structure can create the
same subscription independently; it does not require Pages. Settings refreshes
replace routing results without deliberately remounting the native editor.

While settings are loading or unavailable, the navigator does not keep offering
obsolete paths. It shows the loading/error state, a retry where appropriate, and
links to the configured settings documents. Unsupported release perspectives
remain unavailable rather than silently becoming drafts. RxJS is an optional
Studio peer because the native Presentation location API uses Observables.

The website needs its own server read. Load settings with the same perspective
as the content query, then use the resolved routes for lookup, links, and sitemaps.
Do not pass a Studio subscription to the server or reuse draft settings in a
published cache. The proof website demonstrates this with Articles: a saved draft
prefix of `/stories` changes its draft item URLs, while published requests keep
using `/articles`. The item still stores only its slug. The independently located
collection index stays at its own URL.

### Checks before changing URLs

Field validation and draft edits check the candidate against both published and
draft routing. This catches a page that would collide with either version of a
collection's URLs. These checks query fresh settings with confirmed read access;
a React subscription alone is not permission or freshness evidence.

URL-changing publish actions, redirect writes, and folder moves/removal also
recheck routing before sending their writes. Until reviewed collection-prefix
publishing is implemented, those operations require published and draft routing
to agree. A pending prefix change therefore temporarily blocks these operations
with an explanation. Content-only page publishing can still proceed after its
own fresh checks; it does not publish the settings draft. Creating folders and
saving folder metadata do not activate a prefix change.

The checks detect changed settings and refresh stale reviews. They do not create
a database-wide lock: an unrelated external writer can still change settings or
create conflicting content after a check. Existing revision checks protect the
records actually included in each reviewed write.
