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
exported from a package entry point yet. They do not cache settings, write
documents, publish changes, or add Studio controls. The existing public
`PagesRouteConfig` continues to require string prefixes.

See [URL handling](url.md) for the existing storage and resolution rules, and
[Pages design decisions](pages-design-proposals.md) for the broader editor plan.

## Fixed prefixes and editable prefixes

Each collection chooses one source for its prefix:

- A string in application configuration, such as `/journal`. Editors cannot
  override that prefix with a settings document.
- A binding to one settings document, such as `{documentId: 'journal-routing'}`.
  The selected published or draft version of that document supplies the prefix.

The binding identifies the document explicitly. The kit never guesses it from a
document title, overview page, or matching prefix. Each collection needs its own
settings document. There is no default prefix to fall back to if that document
is missing or invalid.

For example, the private configuration can contain:

```ts
const routing = createCollectionRouting({
	pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
	collections: [
		{
			name: 'journal',
			title: 'Journal',
			routePrefix: { documentId: 'journal-routing' },
			overview: { schemaType: 'page', pathname: '/insights' },
			items: [{ schemaType: 'post', slugField: 'slug.current' }],
		},
	],
})
```

This is an internal API example, not a supported package import. The returned
`routing.documentIds` lists the published document IDs the loader needs to
read. The application supplies the project and dataset when it loads them; this
pure helper has no client or connection settings.

The overview remains `/insights` even when the item prefix changes from
`/journal` to `/blog`. Other pages that list posts also keep their own URLs. The
existing Pages registry still requires a document-backed overview for each
registered collection. This slice does not add document-free overviews.

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

Studio integration will supply the settings schema and controls. A prefix change
can then be previewed as a draft before a reviewed routing change is published.
Publishing needs checks for conflicting page URLs, concurrent edits, redirects,
and cache invalidation. Those are separate from resolving an already-loaded
snapshot. This slice does not make publication safe or activate a new route by
itself.

The consuming application still decides how React Router recognizes collection
URLs: for example, through dynamic routes or a CMS catch-all alongside explicit
application routes. It must use the resolved prefix consistently in routing,
links, sitemaps, and preview. The kit does not rewrite route modules or move
overview pages when a setting changes.
