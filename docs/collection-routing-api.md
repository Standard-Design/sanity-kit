# Resolving collection URLs in an application

The collection routing APIs combine an item's stored slug with a route prefix.
They let an application use published settings for visitors and draft settings
for an authorized preview. They do not change documents, publish settings,
register frontend routes, or install a Studio.

These APIs are public entries in this checkout. That does not mean an earlier
published package version contains them. Studio settings editing and publishing
remain separate private integrations; see [collection routing](collection-routing.md)
and [settings publishing](collection-settings-publication.md) for their status.

## Choose the right entry

| Import                                                                          | Purpose                                                               | Reads Sanity?                       |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------- |
| `createCollectionRouting` from `@standard-design/sanity-kit/url`                | Resolve routing from settings already loaded by your application.     | No                                  |
| `createCollectionRoutingLoader` from `@standard-design/sanity-kit/url/settings` | Load the required settings through your client and resolve them.      | Yes, when `load` or `loadBoth` runs |
| `createSanityUrlResolver` from `@standard-design/sanity-kit/url`                | Resolve URLs when all prefixes already come from fixed configuration. | No                                  |

The pure `/url` entry does not load GROQ, React, Studio, or a router. The settings
loader requires the package's supported `groq` peer in addition to the Sanity
client. The application owns the client, credentials, preview authorization,
and any caching. No credentials belong in the routing registration.

## Register stored fields and settings identities

```ts
import type { CollectionRoutingConfig } from '@standard-design/sanity-kit/url'

export const routing: CollectionRoutingConfig = {
	pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
	collections: [
		{
			name: 'journal',
			title: 'Journal',
			settingsDocumentId: 'journal-settings',
			index: { schemaType: 'page', pathname: '/journal' },
			routePrefix: { mode: 'default', value: '/journal' },
			items: [{ schemaType: 'post', slugField: 'slug.current' }],
		},
	],
}
```

`name` is the stable collection identifier. `settingsDocumentId` identifies its
settings document. `slugField` identifies where an item stores its final URL
segment. Pages continue to store complete paths. The collection's required
`index` registration describes an independent page; it does not supply the item
prefix or move when that prefix changes.

A default prefix only initializes a Studio draft. It never substitutes for
missing or invalid published settings. Use `routePrefix: '/journal'` or
`{mode: 'locked', value: '/journal'}` when configuration owns the prefix. Locked
prefixes require no settings read for URL resolution. `displayName` has its own
default/locked configuration for Studio labels; it does not change the URL.

Configuration is captured when the resolver or loader is created. Construct a
new instance if your application changes the registration. Neither factory starts
a network request during construction.

## Load the published URL context

```ts
import { createCollectionRoutingLoader } from '@standard-design/sanity-kit/url/settings'
import { routing } from './routing.js'

const collectionUrls = createCollectionRoutingLoader(routing, sanityClient)

const result = await collectionUrls.load({
	perspective: 'published',
	signal: request.signal,
})
if (!result.ok) {
	// The application chooses its unavailable-content response and logging.
	throw new Error(`Collection routing unavailable: ${result.reason}`)
}

const url = result.value.resolveUrl({
	_type: 'post',
	slug: { _type: 'slug', current: 'first-post' },
})
if (url.ok) {
	// With a published /journal prefix:
	// {pathname: '/journal/first-post', prefix: '/journal', slug: 'first-post'}
	console.log(url.value)
}
```

A successful load returns:

- `routes`: ordinary route registration with the selected prefixes filled in.
- `resolveUrl(document)`: the same result contract as the fixed URL resolver.
- `settings`: the selected editable-prefix records, with collection name, actual
  document ID, revision, and prefix. A selected draft keeps its `drafts.` ID.
  Code-locked prefixes do not add an entry to this list.

The loader makes a bounded, uncached raw-perspective read for the required IDs.
It disables CDN reads and Stega for settings, and resolves the selected
perspective itself. It does not reuse whichever perspective happens to be set
on the supplied client. There is no built-in settings cache.

Resolving a document does not fetch it. The application must query item content
using the intended perspective too. Loading published settings while separately
fetching draft content does not make those drafts public or choose a correct
preview policy for you.

## Load draft settings for authorized preview

```ts
const previewUrls = await collectionUrls.load({
	perspective: 'drafts',
	draftVisibility: 'all-required-drafts',
	signal: request.signal,
})
```

Only supply `draftVisibility` when you know the client's permissions cover every
required settings draft. It is an assertion of known access, not a permission
grant or an authentication mechanism. A successful query can omit documents the
credential cannot read, so the loader cannot infer this from returned rows.
Without the assertion, an editable-prefix draft read returns `access-unconfirmed`.

A draft settings version takes precedence over its published counterpart. If no
draft exists, the published version is used. An invalid draft causes a failure;
it does not silently fall back to the live prefix. A draft-only settings document
can provide a preview context while its published context remains unavailable.
Changing or loading that draft does not publish routes.

Only `'published'` and `'drafts'` are supported. Content Release perspectives
return `unsupported-perspective` rather than being treated as drafts.

## Compare both contexts from one read

```ts
const pair = await collectionUrls.loadBoth({
	draftVisibility: 'all-required-drafts',
	signal: request.signal,
})
if (pair.ok) {
	const liveUrl = pair.published.resolveUrl(post)
	const previewUrl = pair.drafts.resolveUrl(post)
}
```

`loadBoth` reads published and draft settings together. Both contexts must
resolve successfully. Missing published settings remain an error even when a
valid draft exists. This method is useful when comparing URL ownership or showing
a live/preview difference. It is not a lock: another writer can change settings
after the read.

## Resolve settings you already have

```ts
import {
	createCollectionRouting,
	type RoutingSettingsSnapshot,
} from '@standard-design/sanity-kit/url'

const resolver = createCollectionRouting(routing)
const snapshot: RoutingSettingsSnapshot = {
	status: 'available',
	perspective: 'raw',
	coverage: 'published-and-drafts',
	complete: true,
	documents: rawSettingsDocuments,
}
const result = resolver.resolve(snapshot, 'drafts')
```

The caller is responsible for the snapshot's completeness and visibility claims.
Use `coverage: 'published'` when only published IDs were loaded; that snapshot
cannot resolve drafts. `{status: 'unavailable'}` represents a failed or unavailable
read, while a complete empty list means the required documents do not exist.
Do not mark a truncated or permission-filtered list complete.

Each required settings record uses the existing `sanityKitCollectionRoute` shape:
`_id`, `_rev`, `_type`, `collection`, and `prefix: {_type: 'slug', current: '/journal'}`.
Keep raw draft identities intact. The resolver's `documentIds` lists editable
settings IDs that need loading; locked prefixes are omitted. This API accepts
unknown input so runtime validation still applies to external data.

## Handle failures explicitly

| Result reason                             | Meaning and application response                                                                                      |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `settings-unavailable`                    | A complete usable snapshot was not supplied. Do not invent a prefix.                                                  |
| `settings-missing`                        | Required settings are absent for the selected perspective. Complete the settings setup.                               |
| `settings-invalid` / `settings-ambiguous` | Records are malformed or more than one candidate claims the same selected identity. Repair the data.                  |
| `routing-conflict`                        | Resolved prefixes violate the shared route registration's rules. Fix the conflicting configuration or settings.       |
| `unsupported-perspective`                 | This API does not support the requested perspective.                                                                  |
| `access-unconfirmed`                      | The loader lacks the required assertion of draft visibility. Check credentials and the application's access evidence. |
| `request-failed` / `invalid-response`     | The loader could not obtain usable data. Retry or return an unavailable response; do not treat it as an empty site.   |
| `aborted`                                 | The caller cancelled the read. Stop the request's work.                                                               |

Malformed configuration throws during factory construction. Read/data failures
return result objects. A successful routing context can still fail to resolve an
individual document—for example, a collection item without a slug. Handle both
results. Homepage pages retain `{pathname: '/', prefix: '/', slug: ''}`; an empty
collection-item slug is not a homepage.

The application still chooses its actual router strategy, content queries, cache
refresh behavior, and HTTP error responses. These APIs supply consistent URLs
without making those application decisions.

## Public types

`/url` exports `CollectionRoutingConfig`, `SettingsCollectionDefinition`,
`CollectionSettingValue`, `RoutingSettingsSnapshot`, `RoutingPerspective`,
`ResolvedCollectionSetting`, and `CollectionRoutingResult`, alongside the existing
URL result and fixed-route types.

`/url/settings` exports `CollectionSettingsClient`,
`CollectionSettingsLoadRequest`, `CollectionSettingsLoadResult`, and
`CollectionSettingsPairResult`. These use a structural client boundary compatible
with the supported Sanity client versions; callers do not need Studio types.
