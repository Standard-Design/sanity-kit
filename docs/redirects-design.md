# Redirect subsystem — design proposal

Status: proposed on October 31, 2026. **Not released.** A private
[snapshot validator and lookup](redirects.md) is implemented and approved; loading,
caching, HTTP handling, Studio controls, and publication coordination remain
future work. All API
names and configuration examples below are candidates for review, not exports
that consumers can import today. This document does not approve the other open
[Pages design proposals](pages-design-proposals.md).

## Purpose and recommended first version

A redirect keeps an old link useful after a page moves. If `/about/team` becomes
`/company/team`, the website should send visitors requesting the old URL to the
new one. Editors should be able to review this consequence before applying the
move, rather than asking a developer to repair links afterward.

Add an optional subsystem that works both with Pages and independently of it:

- Sanity documents store manually authored and automatically generated rules.
- Studio provides editing, validation, and a URL-testing view.
- Pages includes redirect creation in reviewed published-URL changes.
- Server helpers load rules, optionally use consumer-owned caching, and resolve
  a request into a redirect decision.
- A React Router integration turns that decision into the appropriate response.

The first version should support exact pathname matches, same-site destinations,
and GET/HEAD requests. Propose 301 for permanent moves and 302 for temporary manual
rules. Google recommends permanent server-side redirects for permanent URL
changes. See [Google's redirect guidance](https://developers.google.com/search/docs/crawling-indexing/301-redirects).

Defer wildcard/regex rules, external destinations, query-based matching, host or
scheme canonicalization, scheduled rules, automatic release integration, and
hosting-provider exports. Collection-prefix changes create exact rules for the
existing published items, not a rule that captures every possible old-prefix URL.

## Ownership and subsystem boundaries

| Part                     | Kit responsibility                                              | Consumer responsibility                                                      |
| ------------------------ | --------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Pure redirect logic      | Validate rules, detect cycles, build an index, match a pathname | Supply site scope and reserved-path policy                                   |
| Sanity loading           | Fetch a complete published rule set, validate it before use     | Supply a configured client and access policy                                 |
| Cache integration        | Define the read-through contract and invalidation events        | Supply storage, expiry, cross-instance invalidation, and availability policy |
| React Router integration | Convert decisions using router-aware response semantics         | Install it in the relevant request paths                                     |
| Studio                   | Supply opt-in schema, actions, validation, and management UI    | Own Studio configuration, permissions, deployment, and editorial policy      |
| Pages integration        | Plan redirects with URL changes and report activation status    | Approve live changes and connect frontend invalidation                       |

Candidate import boundaries are `/redirect` for pure logic, the existing
`/react-router/server` for server/router adapters, and `/studio` for Studio setup.
Keep Sanity Studio, React, and React Router out of the pure entry point. Final
export names require a separate API review. Do not create a new Studio application
or introduce a Cloudflare dependency.

Installing Studio functionality alone does not make a website redirect. The
frontend installation and its cache refresh path must pass acceptance checks.
Consumers with an existing redirect service can keep it; provider export adapters
are follow-up work, not an implicit requirement of this first version.

## Storage model

Use one ordinary Sanity document per rule. A proposed minimum record is:

```json
{
	"_type": "sanityKitRedirect",
	"site": "main",
	"source": "/about/team",
	"destination": "/company/team",
	"status": 301,
	"enabled": true,
	"origin": "url-change"
}
```

`site` is a stable application-configured scope, not a value trusted from an
arbitrary Host header. Scope uniqueness by project, dataset, and site. A locale
can be part of the pathname; multi-domain policies need explicit site mappings.

Use Sanity-generated document IDs, not IDs derived from source URLs. Sanity
document revisions support concurrency checks. Optional operation IDs and weak
references to affected documents can support audit/navigation, but runtime matching
uses the stored paths and must not depend on a content document still existing.

Redirect documents are website routing data, unlike private organizational folder
metadata. Published rules should be readable by the site's configured public-data
client; private datasets use server-side credentials. They must contain no secrets
or sensitive query strings. Exclude redirects from normal page creation, page
queries, and sitemaps while exposing them in a dedicated management view.

Manual rules use normal draft/published editing. Runtime loading explicitly uses
the published perspective and enabled rules. A draft edit must not change live
routing. See [Sanity perspectives](https://www.sanity.io/docs/content-lake/perspectives).

Disabling a rule takes effect when that change is published. Prefer disable over
delete for recoverability. Unpublish/delete must also trigger invalidation; deleting
only a draft does not remove its published rule. Never automatically expire old
rules merely because they have not been edited recently.

## Path policy, collisions, and precedence

Use the same URL safety and canonicalization contract as Pages, links, and shared
URL helpers. Store pathnames only: no origin, query, or fragment. Root `/` can be
a destination. Reject external and protocol-relative destinations, backslashes,
control characters, dot-segment tricks, and encoded separators according to the
shared safety rules. Do not lowercase an entire pathname or repeatedly decode it.

For the initial version, canonical paths have no repeated or trailing slash,
except root. Legacy noncanonical sources need a later explicit compatibility
policy; do not silently normalize a request and accidentally redirect a different
path. Site-wide slash/case normalization remains the consumer's responsibility.

Before activation:

- Allow at most one enabled published source per site, across manual and generated
  rules. Disabled records may retain old values for history.
- Reject source equal to destination, loops, unsupported statuses, and invalid paths.
- Reject sources that are current published page URLs or reserved app endpoints,
  except when that page is being moved away in the same reviewed operation.
- Do not allow a newly created page to reuse an active redirect source without
  explicitly retiring that rule in a coordinated change.
- Validate known destination ownership. Manual redirects may point to app-owned
  routes; consumers must supply a destination check or explicitly acknowledge
  that the kit cannot establish whether that route exists. Do not fetch arbitrary
  network URLs as an implicit validation step.

Redirects must never intercept authentication, preview-entry/exit endpoints,
assets, API handlers, or other reserved application routes. Apply these exclusions
before reading the cache. Do not hide a permission failure or application error
behind a redirect fallback.

Runtime refuses an invalid or ambiguous snapshot instead of selecting the first
matching record. Studio validation is helpful feedback, not a database-wide unique
constraint; imports and external API writes can bypass it.

## Repeated moves and redirect chains

If A moved to B and B now moves to C, the review should propose A → C and B → C,
not make visitors follow A → B → C. Update compatible permanent aliases in the same
operation, with revision checks. A manual temporary rule or independently edited
rule is a conflict to review, not something the planner silently overwrites.

For the first version, reject newly activated redirect-to-redirect destinations
unless the review explicitly flattens them to their terminal destination. Validate
the resulting full graph before caching. Do not silently convert a temporary chain
into a permanent redirect. Imported loops/chains need correction; they are not
accepted merely because they did not originate in Studio.

Moving C back to A requires retiring A's redirect before A becomes a live page
again, and reviewing the resulting aliases. Deleting a destination does not imply
that all its old URLs should redirect to the homepage; surface the broken target
and require an editorial decision.

## How Pages creates redirects

Integrate with publication, not every field keystroke:

1. Compare the previous published URL with the intended published URL using the
   shared URL resolver. New documents and draft-only changes create no live rules.
2. Expand a folder rename or collection-prefix change into its affected existing
   published URLs. Listing pages move only when their own URL changes.
3. Show old/new pairs, proposed rules, existing-rule updates, conflicts, and live
   impact in the review modal. Respect read-only settings and permissions.
4. Revalidate the reviewed versions and route claims. For supported bounded
   operations, commit URL changes, rule mutations, and an operation receipt in
   one transaction. Never publish unrelated draft content.
5. Report that the dataset change committed, then request frontend cache refresh.
   Report activation/refresh failures separately from data-write failures.

The baseline URL-only bulk-change policy and refusal of affected release versions
were approved October 31 in the separate Pages contracts document. Redirect
publication integration still needs implementation review. Until a workflow can
commit the URL and redirect changes safely together,
do not label it automatic redirect support. A webhook after publication can repair
or report missing rules, but cannot make two separate writes atomic retroactively.

Refuse operations too large for the tested transaction limit instead of splitting
them silently. Refuse unsupported release versions and conflicting pending draft
URLs. Protect reviewed mutations with revision checks. Use an operation receipt
to reconcile unknown outcomes after a timeout before retrying; do not duplicate
rules on an uncertain retry.

Atomic mutations protect the included documents, not the prior query or all future
writers. Revision guards do not prevent a different writer creating a new document
that claims the same path. Coordination between kit writers, publication hooks,
and eventual-query-consistency tests is an implementation gate, not a solved
guarantee. See [Sanity transactions](https://www.sanity.io/docs/content-lake/transactions).

For the fixture, retain an explicit no-redirect mode. For production, propose
redirects enabled by default for supported published moves, with an explicit,
authorized opt-out warning. This is a recommendation, not an approved policy.

## Frontend request handling

The resolver should return one of these conceptual outcomes:

```ts
type RedirectDecision =
	| { kind: 'redirect'; location: string; status: 301 | 302 }
	| { kind: 'none' }
	| { kind: 'bypass'; reason: 'method' | 'preview' | 'reserved-path' }
```

Loading, validation, and cache failures are explicit errors, not `none`. The
consumer handles them according to its availability policy. A pure matcher takes
a validated index and pathname; it has no network or storage dependency.

The recommended integration order is:

1. Determine trusted site scope and preview/session state.
2. Bypass non-GET/HEAD methods, preview traffic, and reserved paths.
3. Resolve an exact rule using a validated published snapshot.
4. If matched, return the redirect; otherwise continue normal routing.

This avoids rendering a 404 first, but assumes source ownership was checked at
publication and the app consistently reserves its own paths. Consumers may instead
check redirects on a deliberate content-not-found branch when they want existing
pages to win. Do not treat every thrown error or every resource-route 404 as a
CMS redirect opportunity.

Explicit app routes plus a catch-all, dedicated collection routes, and other
frameworks can all use the same resolver. A React Router adapter should handle
document requests and client-navigation data requests using the router's response
conventions and logical URL, not raw transport suffixes. Do not hand-roll a generic
302 response for data requests without testing its router behavior. A root loader
alone is not a guarantee of execution on every navigation. Document the supported
middleware/loader installation and test its coverage. See
[React Router middleware](https://reactrouter.com/how-to/middleware).

### Query strings, fragments, and HTTP response caching

Propose matching pathname only and dropping query parameters by default. Allow a
consumer-configured allowlist for campaign or other safe parameters. Never copy
preview credentials, session tokens, or arbitrary user-supplied destination
parameters into Location. Fragments are not available in the incoming server
request and are outside rule matching.

Return a validated root-relative Location. Generate rules only for GET/HEAD in
this version; POSTs and other actions proceed untouched. HEAD responses have no
body. A 301 is the recommended status for permanent public page moves; a 302 is
for a genuinely temporary manual rule, not a workaround for cache freshness.

Propose `Cache-Control: no-store` on generated redirect responses initially,
including errors and preview diagnostic responses. Consumers may explicitly
choose a short response-cache lifetime later. This does not disable caching the
rule snapshot inside the app. Application-cache invalidation cannot recall a
redirect already stored by a browser or CDN under an earlier policy. HTTP
response storage is a distinct layer: see [RFC 9111](https://www.rfc-editor.org/rfc/rfc9111.html).

## Optional cache adapter

Follow the existing [loader](loaders.md#cache-raw-data-not-decoder-output) and
[sitemap](sitemaps.md#query-caching) read-through pattern. Do not change those APIs
or claim they already support redirect invalidation. A candidate redirect cache
contract is the sitemap-style interface plus an explicit invalidation method:

```ts
interface ProposedRedirectCache {
	key(context: RedirectCacheContext): string | null
	getOrLoad(key: string, load: () => Promise<unknown>): Promise<unknown>
	invalidate(key: string): Promise<void>
}
```

`RedirectCacheContext` would contain trusted project, dataset, site, API version,
and query/schema version identifiers, not credentials or arbitrary query strings.
This is a design sketch, not a declaration currently available in the package.

The consumer supplies the backend and owns expiry, serialization, refresh locks,
cross-instance behavior, and transport failures. The kit validates fetched raw
records before the supplied `load` callback resolves, validates adapter-returned
records again, and compiles its lookup index after that boundary. Store serializable
raw rule data and snapshot metadata, not a JavaScript Map, Response, or transformed
decoder result. A corrupt hit raises an error; recovery/eviction is explicit.

Cache keys must isolate project, dataset, site, API/query/schema version, and any
configured rule-source variant. Cache only published records. A null key bypasses
caching; an omitted adapter fetches directly. Preview bypasses the public resolver
by default, so it does not read or write this cache at all.

The proposed normal path is a complete snapshot, then a source-path index:

- One snapshot makes both matches and negative lookups cheap after loading.
- Return a complete bounded result; fetch a limit-plus-one sentinel and refuse an
  oversized result. Do not serve a truncated set as if it were complete.
- Replace snapshots as a whole only after validation. A content hash identifies
  equal snapshots but does not prove that a snapshot is the latest one.
- A resolver instance may retain a bounded compiled index keyed by snapshot
  identity, so parsing/indexing is not repeated for every request. It must obey
  the same invalidation/expiry boundary and scope isolation as the raw cache.
- Do not persist per-request "no rule" entries initially; a complete snapshot
  already represents absence. This avoids another negative-cache invalidation path.

Keep cache payload sizes and rule counts bounded and measurable. Per-path lookup,
paged snapshot construction, and distributed compilation are later scaling work;
do not claim one unbounded list fits every site. Any in-memory convenience adapter
must be instance-scoped and documented as local to that process, not a shared or
durable cache. No provider SDK belongs in the core package.

### Freshness and invalidation

Recommend a short configurable TTL, initially 60 seconds, with stale serving off
by default. This is a proposed application-cache policy, not a browser header or
an end-to-end freshness guarantee. Publication should trigger refresh rather than
waiting for expiry alone.

Invalidate on published rule creation, modification, disable, unpublish, and
delete, including automatic rules and chain rewrites. Draft-only edits should not
invalidate public rules. A consumer connects an authenticated, idempotent webhook
or equivalent publication signal to its backend invalidation handler. The kit
can supply event classification and invalidation helpers; Studio cannot directly
reach arbitrary consumer cache storage without that integration.

Treat invalidation as a generation change or equivalent adapter barrier, not just
a blind delete: an old in-flight load must not repopulate the cache after a newer
invalidation. Adapters must document how they achieve this and deduplicate cold
loads. Multi-region or eventually consistent backends cannot promise instantaneous
global eviction; document their actual guarantees.

After a URL-change commit, refresh from the non-CDN source and verify the expected
operation's records before marking refresh successful. GROQ query visibility can
lag the transaction; bypassing the CDN alone does not eliminate that lag. Retry
boundedly and retain a pending-refresh state rather than caching an old snapshot
for a fresh full TTL. Webhooks can be delayed, duplicated, or delivered out of order.

Coordinate redirect, route-lookup, page, sitemap, and collection-settings caches
after a move. The redirect cache alone cannot prevent a stale page cache from
serving the old location. Dataset atomicity does not make distributed cache
activation atomic. A consumer requiring a zero-gap cutover needs a coordinated
activation protocol; it is not promised by the first adapter.

### Failure policy

| Situation                                    | Proposed default                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------- |
| Fresh validated snapshot                     | Match it normally                                                               |
| Cache miss or expired snapshot               | Load and validate; cache only on success                                        |
| Corrupt snapshot, duplicate source, or cycle | Raise a diagnostic error; never select an arbitrary rule                        |
| Cache unavailable                            | Surface the error; an adapter may explicitly opt into validated origin fallback |
| Origin unavailable on a cold/expired lookup  | Surface the error; do not cache an empty list                                   |
| Data committed but cache refresh failed      | Report committed/pending-refresh; retry refresh, not the URL mutation           |
| Mutation timeout with unknown outcome        | Reconcile the operation receipt before retrying                                 |

The default server integration should return a controlled, non-cacheable service
error for an unresolved redirect-subsystem failure. Consumers may explicitly
choose to continue normal routing or serve a bounded last-known-good snapshot.
Document the risks: continuing can lose old-link coverage; stale rules can override
a correction. Never silently turn an outage into a permanent cached redirect or
a claim that no redirect exists.

## Studio management and preview

Provide a searchable Redirects view with source, destination, permanent/temporary
label, enabled state, and manual/generated provenance. Use native document editing
and permissions. A URL-test action explains match, bypass, conflict, or no match
without making the browser navigate.

Show that a rule remains live while a draft edit is pending. Generated-rule edits
require the same checks as manual edits. Block unsupported publishing paths from
claiming safety; duplicate generation and conflicts must also be detected at
runtime for writes that bypass the kit.

Preview should favor editing current draft locations, not force public historical
redirects. Default to bypassing runtime redirects in preview. A separate Studio
test mode may inspect a draft rule set without emitting a permanent HTTP redirect
or using a shared public cache. Release-specific testing is deferred with release
mutation support.

## Testing and acceptance gates

Before release, cover:

- Exact matches, root destination, case/Unicode/encoding behavior, safe query
  allowlists, non-GET/HEAD bypass, reserved endpoints, and open-redirect attempts.
- Duplicate sources, self-redirects, multi-rule loops, chains, repeated moves,
  source reuse, and conflicts with pages and consumer-owned routes.
- Manual publication/disable/unpublish/delete and generated rules for page,
  folder, slug, and collection-prefix changes; draft-only changes create no rules.
- Revision changes during review, external-writer races, unknown outcomes,
  permissions, release refusal, and all-or-nothing bounded transactions.
- Cache hit/miss/expiry, corrupt serialized hits, empty valid snapshots, adapter
  failures, index expiry, project/site isolation, and preview isolation.
- Delayed query visibility, duplicate/out-of-order invalidations, old in-flight
  loads, multi-instance refresh, and explicit stale/fail-open policies.
- Real React Router document and data navigations, explicit and catch-all routes,
  HEAD behavior, safe HTTP headers, and paths where middleware does not run.
- Installed-consumer builds: pure entry point without Studio/router dependencies,
  and server credentials excluded from browser bundles.
- A live proof that moving a published fixture page makes its old link redirect
  and that disabling the rule reaches the frontend within the documented window.

No test or fixture acceptance is claimed by this design document.

## Delivery sequence and decisions for review

1. Pure record validation, graph checks, lookup, and response policy tests.
2. Published Sanity loading, bounded snapshots, cache adapter contract and tests.
3. Manual Studio management plus frontend integration and live cache acceptance.
4. Pages publication/bulk-change integration, using the approved URL-only mutation
   policy and after its redirect coordination mechanisms pass implementation review.

Keep this separate from the committed fixed-prefix slug-routing foundation. Do
not change existing loader/sitemap adapters or publish a release as part of
documenting the proposal.

Before implementation, confirm the proposed defaults: 301/302 with GET/HEAD only;
same-site exact paths; query dropping with an allowlist option; preview bypass;
no-store HTTP responses; 60-second application-cache TTL with stale serving off;
controlled errors rather than silent fallback; and redirects enabled for supported
published moves. Final names, payload bounds, publication coordination, and cache
conformance requirements need an implementation review, not consumer assumptions.
