# Redirect foundation

Status: the private snapshot foundation was approved on October 31, 2026. The
private Sanity loader described below is prepared for review. This is
not a public package entry point, a working Studio feature, or an installed
website redirect system. The names, record shape, and bounds below describe
these internal slices; they are not a public API contract. The broader
[redirect design](redirects-design.md) still describes the later work.

## What this slice does

A redirect says that an old pathname should lead to a different pathname. The
new private helper checks a complete collection of those rules, then builds an
exact-path lookup. For example, a rule from `/about/team` to `/company/team`
produces a redirect decision for `/about/team`, but not for `/about/team/alex`.

The companion loader reads those rules from Sanity and passes them through the
same checks. Neither helper creates or edits rules, publishes content, sends an
HTTP response, caches anything, or moves pages. Those operations belong to later
Studio, router, cache, and Pages integration slices.

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
respectively. This slice returns the chosen number; it does not emit an HTTP
response or decide response caching.

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
  to the exact path lists supplied in configuration.
- A destination missing from the supplied known-destination list.

Consumers that cannot provide destination knowledge must explicitly select
`destinations: 'unverified'`. There is no implicit network request to test whether
an arbitrary URL exists. A successful known-list check proves only membership in
that supplied list, not that the running website will serve the destination.

Reserved and occupied path lists are copied at compilation. They are exact paths,
not patterns: reserving `/api` does not reserve `/api/anything`. The future request
adapter must apply the application's full endpoint policy before loading rules.
These lists do not themselves implement an authorization or route-matching layer.

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
- `{kind: 'bypass', reason: 'reserved-path'}` for an exact reserved path.
- `{kind: 'invalid-path'}` for malformed or noncanonical input.

Passing a full URL with a query is not supported. Later request handling must
extract the logical pathname and implement the reviewed method, preview, and
query-string policies before turning a decision into a response. No GET/HEAD,
preview, query allowlist, or HTTP cache policy is implemented in this slice.

## How the remaining pieces will use this

The Sanity loader compiles its fetched snapshot before returning a lookup. A later
cache interface must also validate data read back from consumer-owned storage.
That cache interface is not implemented here. Neither are invalidation,
expiry, stale-data handling, or cross-project/dataset cache isolation.

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
later publication and request-handling workflows.

The loader lives in `src/redirect/load.ts`; `tests/redirect/load.test.ts` checks
the actual GROQ projection, SDK request options, cancellation, count and byte
failures, invalid graphs, copied policy, and independent repeated calls. No live
Sanity request, cache, HTTP response adapter, Studio schema, or write workflow is
introduced by this slice.
