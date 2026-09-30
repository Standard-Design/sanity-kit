# Links

Use `@standard/sanity-kit/link` to resolve Sanity link data without a framework.
Use `createSanityLinks` from `@standard/sanity-kit/react-router` for the React
Router component. Both are browser-safe; neither fetches documents or requires
server secrets. The router adapter needs the [React Router peers](prerelease.md#supported-peers).

The path from content to UI is: stored link fields, a GROQ projection that
resolves any reference, the kit's resolver, then a renderer. The application
owns its Studio schema and query; the kit owns the normalized link contract and
navigation checks.

## Stored fields versus query results

The canonical stored fields are `linkType` (`internal` or `external`),
`internalDestination` (a reference), `url`, optional `search`, `hash`, and
`openInNewTab`. Labeled links also have `label`.

An internal link passed to the resolver must contain a **dereferenced destination**,
not just `{ _ref: '...' }`:

```ts
const link = {
	linkType: 'internal',
	internalDestination: {
		_id: 'article-123',
		_type: 'article',
		pathname: '/journal/example',
	},
	search: '?view=full',
	hash: '#details',
	openInNewTab: false,
} as const
```

An external link uses `{ linkType: 'external', url: 'https://example.com' }`.
`SanityLink` is the union of these shapes. `SanityLabeledLink` adds a string
label; Portable Text links can use their marked text as children instead.
Missing or null `openInNewTab` means false; truthy non-booleans are rejected.

## Resolve links without React

```ts
import { createSanityLinkResolver } from '@standard/sanity-kit/link'

const links = createSanityLinkResolver({ linkableTypes: ['article', 'page'] })
const resolved = links.resolve(link)
// resolved.href: /journal/example?view=full#details
```

The factory snapshots the allowed document types and external protocols. When
using a [route registry](react-router.md), derive allowed types from its
`linkableTypes` rather than maintaining a competing list.

### Internal navigation rules

The destination needs nonempty `_id` and `_type` strings, an allowed `_type`, and
a root-relative pathname. A pathname cannot start with `//`, contain backslashes
or control characters, or include its own query or fragment. Keep those suffixes
separate: nonempty `search` starts with `?`, and nonempty `hash` starts with `#`.
A search value cannot contain a fragment. Missing/null suffixes become empty.

The resolver validates navigation fields after removing Stega from them. It
does not mutate the original link or clean its label. It does not verify that
the target exists, check authorization, or discover the target's route.

### External navigation rules

External URLs must be absolute and use an allowed protocol. Defaults are
`http:`, `https:`, `mailto:`, and `tel:`. Relative and protocol-relative URLs,
surrounding whitespace, control characters, and unapproved protocols are rejected.
`allowedExternalProtocols` replaces the defaults; it is trusted application
policy, so do not populate it from CMS content.

The clean authored URL is retained rather than rewritten through URL
serialization. A same-origin URL marked `external` still uses external
navigation behavior in the React adapter.

## Create the shared React Router component

In a shared application module such as `app/components/sanity-link.tsx`:

```tsx
import { createSanityLinks } from '@standard/sanity-kit/react-router'
import { sanityRoutes } from '../sanity/routes'

export const sanityLinks = createSanityLinks({ routes: sanityRoutes })
export const SanityLink = sanityLinks.Link
```

Then import `SanityLink` into each component that needs it:

```tsx
<SanityLink link={callToAction.link} prefetch="intent">
	{callToAction.link.label}
</SanityLink>
```

**Call the factory once, not everywhere you render a link.** It creates a
component identity bound to your route policy. The returned `sanityLinks` also
exposes `resolve` for non-rendering callers.

Internal links use React Router navigation. External links force document
navigation. `openInNewTab` sets `_blank` and merges `noopener noreferrer` into
any supplied `rel`. The component forwards its ref to the anchor. Normal React
Router props such as classes and `prefetch` pass through, but `to`, `target`,
and `reloadDocument` are owned by the resolved CMS link.

Supply children explicitly; the component does not insert a label itself. Render
the original label or Portable Text children to retain Visual Editing metadata.

## Query fragments and TypeGen

The static exports in this section are **unreleased**, after alpha.2. They
project canonical fields without requiring a runtime factory call:

```ts
import { defineQuery } from 'groq'
import { sanityLinkQueryFragment } from '@standard/sanity-kit/link'

export const navigationQuery = defineQuery(`
  *[_type == "navigation"][0]{items[]{${sanityLinkQueryFragment}}}
`)
```

`sanityLinkQueryFragment` projects a label and uses `coalesce(_key, label)` for
`_key`. That fallback is not a uniqueness guarantee; author appropriate keys
for arrays. `sanityPortableTextLinkQueryFragment` omits label and uses the stored
annotation `_key`. Both dereference `internalDestination` into `_id`, `_type`,
and `"pathname": pathname.current`. The kit does not ship a Portable Text renderer.

For custom projections at runtime, the existing factory remains available:

```ts
import { createSanityLinkQueryFragments } from '@standard/sanity-kit/link'
import { sanityRouteDataQueryFragment } from '@standard/sanity-kit/react-router'

export const { linkQueryFragment, portableTextLinkQueryFragment } =
	createSanityLinkQueryFragments({
		internalDestinationQueryFragment: sanityRouteDataQueryFragment,
	})
```

Do not assume TypeGen can evaluate that function call and destructuring. Use the
static exports inside named `defineQuery` calls, or application-owned literal
fragments for custom TypeGen projections. Generated types describe the query;
runtime decoding is still needed at the data boundary.

### Monorepo code generation

Declare the kit as a direct dev dependency of the Studio/codegen workspace,
using the same artifact version as the frontend's runtime dependency. Point
Studio's TypeGen scan at the frontend query files. Do not depend on incidental
hoisting or add aliases into `node_modules` or `.pnpm`.

The packed-consumer suite checks Sanity codegen 8.1.0 from `apps/studio` against
queries in `apps/web/app/data`, using a normal pnpm workspace and no custom
resolver. Other versions/layouts need their own generation checks. The `/link`
export's default resolution target lets TypeGen's CommonJS-style static resolver
locate ESM source; it does **not** add a CommonJS build.

## Invalid links and migration from application-specific shapes

Invalid data throws `SanityLinkResolutionError`, a `TypeError` with code
`SANITY_LINK_INVALID` and a field `path`. The React adapter lets it propagate;
it does not quietly render a broken anchor. The application chooses whether to
reject published content, omit an incomplete draft link, or show an editor warning.
Diagnostic messages are not guaranteed safe for public error payloads.

Legacy fields such as `kind` or `page` are not aliases in this contract. Adapt
them in application queries or migrate stored data explicitly. The kit is a
reusable version of the Sawkill pattern, not a copy of every Sawkill schema or
style assumption. Check actual projections against the canonical shape above.

## Source and related guides

Implementation: `src/link/index.ts` and `src/react-router/links.tsx`. Tests:
`tests/link`, router link tests under `tests/react-router`, and
`tests/package/typegen.mjs`. Continue with [routing](react-router.md),
[loaders](loaders.md), or the [documentation index](README.md).
