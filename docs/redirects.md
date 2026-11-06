# Redirect foundation

Status: the private snapshot foundation was approved on October 31, 2026. The
private Sanity loader described below is also approved. The private request and
consumer-cache boundary is approved. Native Studio draft editing and guarded redirect publishing/retirement are implemented for review. This is
not a public package entry point or an installed website redirect system.
A separate private [Studio publication integration](url-field.md#editing-published-pages)
can now create a redirect with a single-page URL change. The names, record shape, and bounds below describe
these internal slices; they are not a public API contract. The broader
[redirect design](redirects-design.md) still describes the later work.

## What this slice does

A redirect says that an old pathname should lead to a different pathname. The
new private helper checks a complete collection of those rules, then builds an
exact-path lookup. For example, a rule from `/about/team` to `/company/team`
produces a redirect decision for `/about/team`, but not for `/about/team/alex`.

The companion loader reads those rules from Sanity and passes them through the
same checks. A separate request helper now decides when to check those rules,
optionally obtains them through the app's cache, and can produce a plain HTTP
redirect response. None of these helpers creates or edits rules or moves pages.
The separate publication integration owns generated-rule creation and reviewed
destination updates when a page moves again. The private management integration now reviews manual redirect publishing and retirement. Framework-specific request integration remains later work.

## One complete snapshot for the configured dataset

`compileRedirectSnapshot()` accepts an unknown data value and explicit application
configuration. The input envelope has this shape:

```json
{
	"perspective": "published",
	"complete": true,
	"records": [
		{
			"_id": "a-sanity-generated-id",
			"_type": "sanityKitRedirect",
			"source": "/about/team",
			"destination": "/company/team",
			"status": 301,
			"enabled": true,
			"origin": "url-change"
		}
	]
}
```

One website uses one configured Sanity project and dataset. The application's
client selects that boundary; there is no separate `site` option or field.
Every enabled source path must be unique across the redirect records in that
dataset. The query does not divide those records into additional website scopes.

The helper rejects raw draft/release document IDs. However,
the envelope's `published` and `complete` labels are **assertions made by the
loader**, not proof that all rules were fetched, that the client had full access,
or that the result is current. The Sanity loader below uses the published
perspective and checks for too many rows; it cannot prove that the supplied
credentials can see every rule.

## Validation before lookup

An enabled record must have a valid identity, the expected document type,
a boolean enabled flag, safe source and destination pathnames, and status 301 or 302. The proposed status choices mean permanent and temporary redirects
respectively. The compiler returns that number; the request boundary below
handles HTTP responses and their separate cache policy.

Paths follow the shared URL safety rules: a leading slash, no origin, query,
fragment, backslash, control characters, dot-segment tricks, or encoded separators.
They must also be canonical: no repeated or trailing slash, except root `/`.
Root can be a destination. The helper does not lowercase, decode, slugify, trim,
remove Stega, or repair either stored paths or incoming lookup values. For example,
`/Old`, `/old`, and `/%4Fld` remain distinct.

Before it builds an index, it rejects the whole snapshot if it finds:

- Duplicate document IDs or duplicate enabled source paths.
- A source that redirects to itself.
- A cycle, such as A → B → A.
- A chain, such as A → B → C. A later reviewed operation may flatten a chain;
  runtime lookup does not silently rewrite it or change a temporary rule's meaning.
- A source reserved by the app or already occupied by a published page, according
  to the exact path lists and reserved prefixes supplied in configuration.
- A destination missing from the supplied known-destination list.

Consumers that cannot provide destination knowledge must explicitly select
`destinations: 'unverified'`. There is no implicit network request to test whether
an arbitrary URL exists. A successful known-list check proves only membership in
that supplied list, not that the running website will serve the destination.

Reserved and occupied path lists are copied at compilation. `reservedPaths`
and `occupiedPaths` match exact paths. `reservedPathPrefixes` reserves a path
and every segment below it: `/account` covers `/account/settings`, but not
`/accounting`. Prefixes must be canonical paths with no repeated or trailing
slashes; `/` reserves every path. Matching is case-sensitive, with no wildcards
or decoding. Redirect destinations may still point into reserved sections.

The loader accepts the same options and copies them before fetching. The Studio
publishing integration takes prefixes from the shared Pages route configuration,
so page fields and redirect checks use the same reservations. Standalone redirect
loaders must receive that same policy from the consumer. These rules do not
discover frontend routes or implement authorization.

Disabled records never enter the index or participate in chains. They may retain
obsolete source/destination/status values for history, but their identity,
projected field shape, and size must still be valid. Draft or release records are
rejected even when disabled; this is not a raw-perspective filtering helper.

## Bounded input and independent results

The proposed bounds are 1,000 total records and 1 MiB of serialized UTF-8 envelope
data, including disabled history. They are deliberately conservative first-version
limits, not claims that every site fits one snapshot. An oversized input fails;
it is never truncated into a seemingly complete lookup.

Records use a small projected shape. In addition to the fields in the example,
the helper accepts `_rev`, `_createdAt`, and `_updatedAt`. Values must be JSON
primitives; arbitrary nested objects and unknown fields are rejected. The byte
check processes records and primitive values incrementally, rejecting very large
strings before serializing them. It does not stringify an arbitrary whole object
graph. This check happens after the SDK has received and parsed the response.
The loader bounds row count, but does not cap raw response bytes before buffering;
a single oversized field can still consume transport memory before rejection.

The index keeps copied strings in a private map, exposes a frozen facade, and
returns a fresh decision each time. Changing the input records, configuration
arrays, or a previous decision does not alter subsequent lookups. No global
cache is introduced.

## What callers receive

Compilation returns either `{ok: true, value}` or `{ok: false, reason}`. A failure
may identify the offending record. There is no partially usable index on failure.
Invalid trusted configuration throws instead of being reported as bad fetched data.

The successful value exposes enabled-rule `size`,
`destinationsVerified`, and `match(pathname)`. The verification flag means the
destinations were checked against a supplied list, not independently confirmed.
Matching returns:

- `{kind: 'redirect', location, status}` for an exact rule.
- `{kind: 'none'}` for a valid pathname with no rule.
- `{kind: 'bypass', reason: 'reserved-path'}` for an exact reserved path or a path covered by a reserved prefix.
- `{kind: 'invalid-path'}` for malformed or noncanonical input.

The compiler accepts a pathname, not a full URL. The request helper below
extracts that pathname and applies method, preview, and query-string policy
before turning a decision into a response.

## How the remaining pieces will use this

The Sanity loader validates its fetched snapshot before returning a lookup.
`loadRedirectData()` exposes the same validated raw data internally so the
request helper can store JSON, then check it again on every cache hit. Expiry,
refresh coordination, and durable invalidation belong to the app's adapter.

Studio and Pages can eventually use the same validation when reviewing proposed
rules. A valid graph does not prove source ownership, publication permission,
atomic URL changes, or freedom from concurrent writes. Those checks still belong
to the reviewed publication workflow.

Implementation is in `src/redirect/snapshot.ts`; offline tests are in
`tests/redirect/snapshot.test.ts`. Tests cover graph conflicts, malformed
paths, size bounds, disabled history, immutable lookup behavior, and a browser
bundle with no Studio, React, router, or network-client runtime. The shared path
validator does use the client's pure Stega utilities, not its fetching APIs.

No live redirect acceptance or public consumer API is claimed yet.

## Reading rules from Sanity

`loadRedirectSnapshot(client, options)` is a private, one-shot read helper. The app
supplies its own configured Sanity client and the same reserved-path,
occupied-path, and destination policy used by the compiler. It may also pass an
`AbortSignal`. The loader validates this configuration before fetching and copies
the path lists so changes during the request cannot change the policy being used.

The supplied client owns the project, dataset, credentials, and transport. The
loader clones it with API version `2026-10-01`, the `published` perspective, CDN
use disabled, and Stega disabled. It does not change the app's client or choose a
project or dataset from a hostname. Each fetch repeats those read guards, requests a plain
result with `filterResponse: true`, disables source maps, and passes `cache:
'no-store'`. The installed SDK transport is tested to forward that cache option
and override inherited caching settings. No framework package is needed. Custom
client transports can still disregard those settings; the loader cannot inspect
their implementation or prove freshness.

The query selects all `sanityKitRedirect` records in that dataset, explicitly
excludes draft and release document IDs, and projects only the fields accepted by
the snapshot compiler. It includes disabled history, because those records count
toward the snapshot limit too. It requests at most 1,001 rows: up to 1,000 allowed
records, plus one extra to detect overflow. If the extra row exists, it refuses
the entire result rather than using an incomplete list. It does not paginate,
silently truncate the list, or repair invalid rules.

A successful read returns `{ok: true, value}`, where `value` is the compiled
lookup described above. Failures distinguish:

- `aborted`: the caller cancelled. A response arriving after cancellation is
  discarded even if the transport ignored the signal.
- `request-failed`: the SDK request failed. This never becomes an empty success.
- `invalid-response`: the transport returned something other than a row array,
  or returned more rows than the query can request.
- `invalid-snapshot`: the returned rows failed the compiler's checks. The
  `snapshotReason` gives the existing reason, such as `too-many-records`,
  `duplicate-source`, or `unpublished-record`; `recordId` is included when known.

Invalid trusted configuration still throws. Request errors are not logged or
returned verbatim, so the helper does not expose SDK credentials or response
details in its result. Every call reads again; there is no shared cache or shared
in-flight request.

"Complete" means the query did not exceed its row limit within the client's
visible data. It does not prove unrestricted access, immediate visibility of a
recent write, destination existence, or that the app's reserved/occupied lists
are current. Those remain responsibilities of client configuration and the
publication workflow and consumer integration.

The loader lives in `src/redirect/load.ts`; `tests/redirect/load.test.ts` checks
the actual GROQ projection, SDK request options, cancellation, count and byte
failures, invalid graphs, copied policy, and independent repeated calls. The
loader itself has no cache or HTTP response behavior; those are separate below.

## Handling a website request

The private `resolveRedirectRequest(client, request, options)` helper lives in
`src/redirect/request.ts`. The consumer supplies its Sanity client and an explicit
`preview` boolean from its own trusted session handling. A query parameter alone
is not proof that a request is an authorized preview.

The helper skips non-GET/HEAD requests and previews before touching the client or
cache. It also skips app-reserved paths before loading rules. On other requests,
it checks the exact pathname against the complete, validated published snapshot.
A missing rule returns `none`; failed reads return an explicit `error`. Invalid
paths are reported separately. There is no automatic fallback to an empty list.

By default the redirect drops the incoming query string. An optional
`queryParameterAllowlist`, such as `['utm_source', 'lang']`, copies only those
exact parameter names, preserving repeated values with URL-safe encoding.
Configuration rejects common authentication, credential, and preview names,
case-insensitively. **The app must still choose names whose values are safe to
expose.** No generic list can recognize every custom parameter containing private
data. Fragments are never forwarded. Stored destinations are still canonical
root-relative paths, without a query, fragment, or external origin.

`redirectResponse(result)` converts a redirect into an empty native `Response`
with status 301 or 302 and `Cache-Control: no-store`. It returns no response for a
miss or bypass, so ordinary routing can continue. A data/cache failure becomes a
non-cacheable 503 with a generic message; an invalid path becomes a 400. The app
can instead inspect the result and render its own service-error response or log
its reason without exposing diagnostics to visitors. An aborted request should
normally stop work rather than send a response to a disconnected visitor.

HTTP response caching is separate from rule caching. `no-store` makes these
responses easier to change or retire; it does not invalidate older responses a
browser or proxy may already have cached under a different policy.

This is a **plain HTTP boundary**, not installed middleware. The app must place
it where each intended page request is checked and pass a logical page URL.
React Router data requests need a framework adapter that follows the router's
redirect response conventions. This helper does not strip `.data` or other
suffixes: `/article.data` remains a distinct pathname. A root loader alone is not
proof that every client navigation passes through the check. That integration,
including document and data-request acceptance, remains a separate slice.

## Optional consumer-owned caching

Omit `cache` to read Sanity on each eligible request. When supplied, its private
contract is:

```ts
interface RedirectCache {
	key?(context: RedirectCacheContext): string | null
	getOrLoad(key: string, load: () => Promise<unknown>): Promise<unknown>
	invalidate(key: string): Promise<void>
}
```

The adapter owns storage, serialization, expiry, and refresh coordination.
`getOrLoad` returns a stored value or calls `load()` and stores its successful
value. That callback validates the complete raw snapshot **before** permitting
storage. Failed loads throw to the adapter and must not be stored. The adapter
returns JSON data, never a compiled map, function, or `Response`. Every returned
value, including a cache hit, is checked again before matching a request.

The kit builds a SHA-256 key from the client's project and dataset, pinned API
version, query/schema versions, and all validation policy lists. Equivalent
list orderings use the same key. A custom `key` hook may add a partition or return
`null` to bypass storage; it cannot remove this isolation. Cache envelopes carry
the same scope identity, so an adapter returning another dataset's entry fails
validation. Credentials and request queries never enter this context. The
origin read is explicitly pinned to the captured project and dataset.

Use a finite TTL; **60 seconds, without stale serving, is the recommended initial
adapter policy**. The kit does not provide a backend, timer, or implicit stale
fallback. A corrupt hit or unavailable cache returns an error rather than silently
loading a replacement or reporting no redirects. The adapter should provide its
own timeout for a shared refresh. A cancelled request stops waiting promptly;
it does not cancel a refresh shared with other requests. Uncached reads receive
the request's abort signal and reject late results after cancellation.

The same 1,000-record and 1 MiB snapshot limits apply before storage and on hits.
The small scope wrapper is additional metadata. These checks happen after the
SDK/cache has parsed its value; they are not a streaming limit on bytes received
from either backend. Trusted adapters should bound their own response sizes.

## Refreshing the cache after changes

`invalidateRedirectCache(client, policy, cache)` derives the same scoped key and
calls the adapter's invalidation hook. It reports storage failure explicitly.
The app connects this helper to an authenticated, idempotent change hook after
published redirects are created, edited, disabled, unpublished, deleted, or
updated to point directly to a new destination. Draft-only edits need no refresh.
If the app uses several policies or custom partitions, its hook must invalidate
each active one; this helper does not enumerate another service's keys.

Invalidation must prevent an **older in-flight load** from filling the cache
again afterward. A simple delete is insufficient. The adapter can use generation
checks or another backend-specific coordination mechanism; it also owns
cross-instance refresh deduplication. The kit does not promise global atomicity.

A just-committed Sanity change may not immediately be visible to a new query,
even with the CDN disabled. When immediate activation matters, the consumer's
refresh process must verify the expected records before replacing its active
snapshot, with bounded retries and an explicit pending/failed refresh state.
Calling this helper alone does not establish that publication and cache
activation happened together. Existing browser caches are outside this process.

`tests/redirect/request.test.ts` covers method/preview/reserved bypasses, exact
paths, query handling, response headers, cache corruption and isolation,
invalidation errors, shared-refresh cancellation, and a real SDK transport stub.
No live frontend or cache-backend acceptance is claimed by these offline checks.

## Preparing redirect drafts in Studio

The private management checkpoint uses Sanity's ordinary document list and form.
Editors can search redirects, inspect their old and destination URLs, create a
manual redirect draft, and prepare changes to an existing rule. Sanity supplies
document IDs, native permissions, autosave, validation indicators, and draft
status. There is no separate custom list or replacement form control.

The opt-in belongs to the existing `withUrlPublication()` integration:

```ts
withUrlPublication(studioConfig, {
	routes,
	redirectManagement: 'drafts',
})
```

Add `redirectManagementItem(S)` to the consumer's Structure items where the
Redirects list belongs. These helpers are still private source integrations,
not new package exports. Without the option, generated redirects remain
read-only and there is no creation template. With it, one native manual template
starts with status 301, enabled true, and origin `manual`. It does not choose an
ID or create a published document. The list can sort by old URL or last edited,
and its preview shows destination, permanent/temporary type, enabled state, and
manual/generated origin.

The form has five fields:

- **Old URL:** an exact path on this website, such as `/previous-name`.
- **Destination URL:** another same-site path, such as `/new-name`. `/` is valid.
- **Redirect type:** permanent (301) or temporary (302).
- **Enabled:** turning it off prepares retirement in the draft.
- **Created by:** read-only provenance. Editing a generated rule does not turn it
  into a manually created rule.

Local validation rejects unsafe or noncanonical paths, reserved source URLs,
unsupported status codes, missing values, and a redirect to itself. Reservations
come from the same route registration and extra reserved paths used by page
publication. Destinations may point into reserved sections. Studio validation
helps editors; it is not a Content Lake constraint on API writes.

Use `redirectManagement: 'drafts'` to prepare drafts without live actions, or
`redirectManagement: 'publish'` to enable the guarded Publish action. The latter
keeps Sanity's native permission, validation, syncing, and lock checks, then runs
the kit's conflict and write checks automatically. Release versions remain
read-only. This mode also keeps Sanity's native Delete action for active, retired,
and draft-only redirects. Unpublish, duplicate, and scheduling remain unavailable. The
final workspace action reducer and layout guard prevent a later plugin from
restoring an unguarded publish action.

## Publishing or retiring a redirect

An editor changes a redirect using ordinary fields, then clicks Publish once.
The button shows progress while the kit checks and saves the change. There is no
extra confirmation dialog or routine success toast; native document status shows
that it was published. A notice opens only when something needs attention, such
as a conflict, failed check, changed data, or an uncertain result. Retry publish
runs the checks again and saves if they pass. To retire a rule, turn off Enabled
and publish: its record remains available for history and later reuse.
Editing a draft, including disabling it, never changes the live rule by itself.

Before publishing, the controller proves read access to all registered
page versions, redirect versions, the folder registry used by the shared loader,
and the `sanityKit.redirectPublication.` confirmation namespace. A successful
query alone cannot prove that inaccessible records were not omitted. Known
missing and unverified requirements are listed separately in the dialog.

It reads raw, uncached inventories and checks the proposed complete redirect
graph. Published, draft, and release page URLs reserve their paths. An unfinished
page with no URL is allowed; an invalid stored page URL blocks the check. A
release version of the redirect blocks publishing because this workflow cannot
coordinate that planned work yet. Other redirect drafts are not published or
changed. Conflicts and invalid rules include clickable redirect rows when their
identities are available. The existing 1,000-record and 1 MiB data bounds also
apply to the raw redirect review, including drafts and release versions.

Immediately before sending the write, the controller repeats the access and
inventory reads and compares them with its earlier checks. Changed evidence
stops the write and asks the editor to retry publishing. One atomic Mutation API transaction then:

1. Guards the reviewed draft revision.
2. Strictly creates the published ID for a new redirect, or guards the existing
   published revision before replacing it with the reviewed full draft.
3. Deletes that guarded draft and creates a confirmation record.

The full draft preserves consumer-added fields and creation metadata. Reference
fields receive the same strengthen-on-publish treatment as Sanity's native
publisher. The request is bounded to 1 MiB. A strict create prevents first
publishing from replacing a live document created after the review. Native
Publish mode permissions correspond to creating/updating the published document
and deleting the draft; Content Lake enforces the actual writes. The confirmation
record also needs create access. No client-side permission check grants access.

Before sending, the browser must save the exact attempt in session storage. If
storage is unavailable, nothing is sent. The mutation client has retries disabled.
A lost response leaves the outcome unconfirmed; Check publish status reads the
atomic receipt through the Doc API and never sends the write again. Closing the
dialog permits other work, while publishing this redirect stays blocked until
its outcome is known. A matching receipt confirms success even after navigation
or a reload in the same tab. An absent receipt alone cannot prove failure. A
success toast tells the editor when this previously uncertain result is confirmed.

These revision checks do not lock every URL or prevent an external writer from
creating a new conflicting page or release concurrently. Consumers must keep
imports and other writers consistent with the routing policy. The pending record
is scoped to this project, dataset, document, and browser tab; it is not a global
cross-device lock. Confirmation records are internal dotted-ID documents and
must not be removed while an outcome still needs investigation.

Publishing saves redirect data; the website must still use the request helper.
Consumers refresh or invalidate their cache on published redirect changes.
Retirement therefore reaches visitors when that website refreshes its rules,
and previously cached permanent browser redirects may remain cached.

### Deleting a redirect

Choose **Delete** from the document actions menu. A redirect does not need to be
retired first: active, retired, and draft-only records can all be deleted, subject
to Sanity's permissions and native version restrictions. Sanity shows its normal
confirmation and checks references before deletion. For an active published
redirect, the confirmation explains that deleting it stops visitors being
redirected after the website refreshes its data, then asks whether to proceed.
A disabled draft does not hide this warning while the published rule is active.
Retired and draft-only redirects keep the ordinary confirmation.

The kit wraps only the native dialog wording; permissions, reference and version
warnings, buttons, and the delete operation remain Sanity’s. The wrapper forks
the dialog’s translation resources using `i18next` and `react-i18next`, the same
libraries used by Studio. It does not change translations for other dialogs or
use private Sanity components. These libraries are optional Studio peers, not
frontend dependencies.

Deleting an active published redirect removes that rule; the website stops using
it when its redirect data refreshes. Existing browser-cached permanent redirects
may still be followed. Consumers should invalidate their redirect cache after
deletions, just as they do after publishing changes. Retire a redirect instead
when you want to keep its record available. The optional draft-management-only
mode still omits actions that can change live rules.

## Checking a proposed redirect draft

`reviewRedirectDraft(candidate, inventory, policy)` is the private, pure graph
check used by the guarded publishing workflow. It does not fetch records,
change documents, or authorize publication. The native draft form currently runs
local field validation; it does not silently load and claim a complete graph on
every keystroke.

The caller supplies a bounded, complete published inventory. The helper replaces
only the candidate's published counterpart, or adds it when this is a new draft,
and runs the shared snapshot compiler on the **resulting** rules. It checks
source conflicts, occupied page paths, app reservations, known destinations,
loops, chains, and record/data limits. Errors identify affected field values and
related redirect rows where the inventory provides them. This data can feed the
same clickable conflict-row pattern as page publication.

This ordering matters for repair: an invalid published redirect must not prevent
an editor from correcting that very record. A valid replacement may fix its bad
path, destination, or status. Other invalid rules remain visible and blocking;
replacing one record does not discard or silently repair anything else. Duplicate
published IDs, incomplete inventories, draft rows masquerading as published data,
and release candidates are rejected before replacement.

Success means the proposed graph is valid under the supplied evidence and policy.
It does not prove read access, currentness, absence of concurrent new writers,
publication permission, or safe handling of other pending drafts/releases. The guarded controller supplies those checks. Explicitly updating a live redirect while
preserving conflicting unpublished work remains deferred.

Implementation lives in `src/studio/redirects/schema.tsx`, `review.ts`, and the
`publication` controller/action/recovery files; the
existing `src/studio/url/publication-plugin.tsx` owns registration and action
finalization. Offline tests exercise native schema/template/action resolution,
field feedback, repair semantics, graph conflicts, and published-only runtime
reads. Live proof-Studio acceptance covered manual draft creation, autosave,
native self-redirect validation, read-only provenance, and the absence of live
actions. See the fixture acceptance log for the remaining access and release
checks. The guarded service/action tests also cover first-publish races, stale
reviews, retirement, native permission changes, full-draft preservation, real SDK
transport options, uncertain results, and recovery after module reload. Live
publish/update/retire acceptance also passed in the test Studio; see the fixture
acceptance log for the observations and checks that were not performed live.
