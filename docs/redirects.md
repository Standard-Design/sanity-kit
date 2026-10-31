# Redirect foundation

Status: private implementation approved on October 31, 2026. This is
not a public package entry point, a working Studio feature, or an installed
website redirect system. The names, record shape, and bounds below describe
this approved internal slice; they are not a public API contract. The broader
[redirect design](redirects-design.md) still describes the later work.

## What this slice does

A redirect says that an old pathname should lead to a different pathname. The
new private helper checks a complete collection of those rules, then builds an
exact-path lookup. For example, a rule from `/about/team` to `/company/team`
produces a redirect decision for `/about/team`, but not for `/about/team/alex`.

It does not fetch Sanity data, create or edit rules, publish content, send an HTTP
response, or cache anything. It also does not move pages. Those operations belong
to later loading, Studio, router, and Pages integration slices.

## One complete snapshot for one site

`compileRedirectSnapshot()` accepts an unknown data value and explicit application
configuration. The input envelope has this shape:

```json
{
	"site": "main",
	"perspective": "published",
	"complete": true,
	"records": [
		{
			"_id": "a-sanity-generated-id",
			"_type": "sanityKitRedirect",
			"site": "main",
			"source": "/about/team",
			"destination": "/company/team",
			"status": 301,
			"enabled": true,
			"origin": "url-change"
		}
	]
}
```

The application supplies the expected site separately. It must be a stable name
such as `main` or `en-US`, not a value copied from an arbitrary request host. The
proposed site format starts with a letter and uses up to 64 letters, digits,
hyphens, or underscores.

The helper rejects mixed-site records and raw draft/release document IDs. However,
the envelope's `published` and `complete` labels are **assertions made by the
loader**, not proof that all rules were fetched, that the client had full access,
or that the result is current. A later loader must use the published perspective,
detect an oversized/incomplete result, and handle those failures explicitly.

## Validation before lookup

An enabled record must have a valid identity, the expected document type and site,
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
obsolete source/destination/status values for history, but their identity, site,
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
graph. A future HTTP loader must separately bound response buffering; this helper
cannot undo memory already consumed when its input was fetched.

The index keeps copied strings in a private map, exposes a frozen facade, and
returns a fresh decision each time. Changing the input records, configuration
arrays, or a previous decision does not alter subsequent lookups. No global
cache is introduced.

## What callers receive

Compilation returns either `{ok: true, value}` or `{ok: false, reason}`. A failure
may identify the offending record. There is no partially usable index on failure.
Invalid trusted configuration throws instead of being reported as bad fetched data.

The successful value exposes `site`, enabled-rule `size`,
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

A later Sanity loader can compile its fetched snapshot before passing data to a
consumer-owned cache, then compile or revalidate cache-returned data too. That
loader and cache interface are not implemented here. Neither are invalidation,
expiry, stale-data handling, or cross-project/dataset cache isolation.

Studio and Pages can eventually use the same validation when reviewing proposed
rules. A valid graph does not prove source ownership, publication permission,
atomic URL changes, or freedom from concurrent writes. Those checks still belong
to the reviewed publication workflow.

Implementation is in `src/redirect/snapshot.ts`; offline tests are in
`tests/redirect/snapshot.test.ts`. Tests cover graph conflicts, scope, malformed
paths, size bounds, disabled history, immutable lookup behavior, and a browser
bundle with no Studio, React, router, or network-client runtime. The shared path
validator does use the client's pure Stega utilities, not its fetching APIs.

No live redirect acceptance or public consumer API is claimed yet.
