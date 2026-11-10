# Read access for collection URL changes

Status: this is a private, read-only integration. It connects the collection-prefix
reviewer to Sanity's permission system. It does not enable the settings Publish
action or grant permission to change documents.

## Why the reviewer needs this check

Changing a collection's prefix changes the URL of every item in that collection.
The review checks those proposed URLs against pages, drafts, planned release
versions, and redirects. It must also see the configured settings documents,
including versions with malformed data.

A successful query is not enough to prove that this inventory is complete.
Sanity can return only the documents the caller can read. An empty result could
mean either “there are none” or “this account cannot see them.” This adapter checks
the caller's effective permissions before the reviewer relies on its query.

## How it uses Sanity's permissions

`createNativeCollectionPrefixReadAccess(client)` requests the dataset ACL from
`/projects/{projectId}/datasets/{dataset}/acl`. This is the same endpoint used by
Studio's dataset-grant reader. Sanity returns the filters and permissions that
apply to the current caller, resolving user-attribute filters for that caller.
It does not require the app to list project members or inspect role names. See
[Sanity's dataset ACL reference](https://www.sanity.io/docs/http-reference/roles).

The adapter uses the credentials already configured on the supplied client. It
pins the API version, disables retries and CDN use, and requests `no-store` without
inheriting a framework revalidation policy. Every call fetches grants again.
It does not add a token, cache the response, or log grants. The project and dataset
must match the reviewer; proof from another dataset is not reused.

The existing URL-access interpreter in `src/studio/url/access.ts` evaluates the
returned filters. This is the same bounded GROQ parser used by URL editing and
page publishing, with two small shared helpers for whole document-type coverage
and collection settings release identities. There is no second permission parser.

## What must be readable

The reviewer requests these scopes:

- Every published, draft, and release version of each registered page or
  collection-item document type.
- Every published, draft, and release redirect record.
- Each configured collection settings document and its exact draft identity,
  regardless of document type.
- Every release version of each configured settings identity, also regardless
  of type.

The last two requirements are deliberate. A settings document with the wrong
`_type` must remain visible so the reviewer can reject it. A grant that only reads
`_type == "sanityKitCollectionRoute"` cannot prove that coverage.

A grant for `_id in path("versions.*.journal-settings")` can cover every release
version of that settings document, including future releases. A grant for just
`versions.spring.journal-settings` cannot prove that no other release version is
hidden. The adapter never discovers release IDs by sampling visible documents.

## Custom roles and uncertain results

The check uses effective grants, so custom roles can pass without being named
Administrator or Editor. Recognized grants can combine to cover different document
versions. Supported expressions include boolean combinations, `_type` and exact
`_id` comparisons, literal lists, and the path patterns the shared interpreter can
prove cover an entire requested scope.

The interpreter deliberately does not claim to solve every possible GROQ filter.
A content-dependent rule, such as allowing only documents with a particular
owner, cannot prove access to all records of a type. Unsupported expressions stay
unverified. A separate recognized grant can still establish complete coverage.
Malformed or oversized ACL responses also remain unverified.

Each requested requirement receives one of three results:

| Result       | Meaning                                                          |
| ------------ | ---------------------------------------------------------------- |
| `granted`    | The returned grants prove the entire requirement.                |
| `missing`    | At least one required scope is definitely not covered.           |
| `unverified` | The available grants or response cannot establish full coverage. |

The reviewer keeps the requirement's key and plain-language label when it reports
missing or unverified access. A connection failure is reported as a failed
request, not as proof that the editor lacks permission. Cancellation remains a
separate aborted result. Native write permissions are a separate check.

## Connecting the reviewer

These names are private source APIs; they are not package exports yet:

```ts
const confirmReadAccess = createNativeCollectionPrefixReadAccess(client)

const reviewer = createCollectionPrefixReviewer(configuration, client, {
	confirmReadAccess,
})

const result = await reviewer.review(choice, request.signal)
```

The reviewer calls the adapter before and after reading its inventory. Its
`recheck()` repeats both access checks and the inventory read. Revoked permissions
therefore invalidate a review instead of reusing earlier approval. These reads
still do not make a later write atomic; the guarded writer must perform its own
final checks and revision-protected operation.

## Reading the operation's confirmation record

The separate
`checkCollectionPrefixReceiptReadAccess(client, receiptId, signal, includeDraft)`
helper checks one generated confirmation record. It accepts the
`sanityKit.collectionPrefixPublication.<UUID>` and
`sanityKit.collectionSettingsPublication.<UUID>` namespaces. It uses fresh ACL
data and the same exact-ID interpreter, independent of the record's type.

The writer reads this record to determine whether an uncertain request completed.
By default, `includeDraft` is `true`: the Actions API creates and publishes the
record through a draft, so both identities must be readable. First settings
publication creates the published record directly in a transaction and passes
`false`; there is no receipt draft to check for that operation.

Inventory visibility does not imply access to this confirmation record, and read
access does not authorize its creation. The helper reports specific missing or
unverified receipt requirements. It does not read, create, or publish the record
itself.

## What has been checked

Offline tests cover scoped custom grants, complete and partial version access,
malformed filters, uncertain results, revoked permissions, project/dataset
isolation, connection failures, cancellation, and exact confirmation-record
access. They also connect the native adapter to the real inventory reviewer and
exercise the installed Sanity SDK's ACL request transport and cache settings.
Existing URL-editing permission tests continue to run against the shared parser.

A read-only live check also passed against the authorized `ha9kep4l/development`
tooling dataset using one unrestricted Studio user's credentials. All seven
requested requirements were granted: four registered page/item types, redirects,
exact settings identities, and settings release identities. No content was
changed and no credentials or grant contents were logged. This establishes live
transport behavior for that account; it is not live acceptance of custom-role
configurations, write permissions, or publishing.
