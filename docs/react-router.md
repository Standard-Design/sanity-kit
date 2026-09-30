# React Router: page components and metadata

Import from `@standard/sanity-kit/react-router`. This browser-safe entrypoint
maps Sanity document types to React components, supplies metadata dispatch, and
exposes the route information used by [links](link.md) and [server loaders](loaders.md).
It does not contain clients, credentials, or content-fetching code.

Install the React, React DOM, React Router, and `groq` peers listed in the
[prerelease guide](prerelease.md#supported-peers).

## What a Sanity route registry is

A registry dispatches a loaded document by `_type`. It is **not** your React
Router route configuration and does not create URLs or generate `routes.ts`.
Your application normally mounts it in a CMS catch-all route; ordinary custom
React Router routes can coexist alongside it.

The component receives `{ data }`, where `data` is the document returned by the
server loader. `SanityRoutable` promises only an `_type` string. Published and
draft decoders establish any stronger field guarantees.

## Register document types

```tsx
// app/sanity/routes.tsx
import { stegaClean } from '@sanity/client/stega'
import {
	createSanityRoutes,
	defineSanityRoute,
} from '@standard/sanity-kit/react-router'

// In an application, derive this from published and preview decoder outputs.
type Article = { _type: 'article'; title?: string | null }

function ArticlePage({ data }: { data: Article }) {
	return <h1>{data.title ?? 'Untitled draft'}</h1>
}

export const sanityRoutes = createSanityRoutes({
	routes: [
		defineSanityRoute({
			type: 'article',
			component: ArticlePage,
			meta: (article) => [{ title: stegaClean(article.title ?? 'Article') }],
		}),
	],
})
```

`defineSanityRoute` preserves inferred component data and document-type literals.
It does not perform data validation itself. Components and metadata callbacks
must accept both published and preview output, including missing fields allowed
by draft schemas. Do not cast a draft to a fully validated published type.

Render original strings where Visual Editing needs them. Clean values separately
when producing head metadata, URLs, or comparison keys.

## Export from an application route module

After defining the matching server loader in a server-only module:

```tsx
import { sanityRoutes } from '../sanity/routes'
import { sanityLoaders } from '../sanity/loaders.server'

export const loader = sanityLoaders.loader
export const meta = sanityRoutes.meta
export default sanityRoutes.default
```

Register this route module in your application's React Router configuration.
Keep the exports as top-level route-module bindings. The framework can then
recognize the loader as server code; do not export a combined object containing
both browser and server functions or import server modules into shared UI.

The direct component export expects the document itself as `loaderData`. If an
application wrapper instead returns `{ page, diagnostics }`, unwrap `page` when
rendering and when calling metadata:

```tsx
const Page = sanityRoutes.default

export default function CmsRoute({ loaderData }: Route.ComponentProps) {
	return <Page loaderData={loaderData.page} />
}

export const meta = ({ loaderData }: Route.MetaArgs) =>
	sanityRoutes.meta({ loaderData: loaderData?.page })
```

This second example replaces the direct component/meta exports; it assumes the
[request-scoped loader wrapper](loaders.md#request-scoped-diagnostics). Import
`Route` from the generated types for your route module. Display diagnostics
separately only when appropriate for authenticated preview.

## Registry settings and returned values

| Setting                      | Behavior                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------- |
| `routes`                     | Nonempty list of unique document-type registrations                             |
| Route `meta`                 | Metadata callback for that document type                                        |
| Route `linkable`             | Defaults to true; false excludes the type from link destinations, not rendering |
| `extraLinkableTypes`         | Types served outside this registry that internal links may target               |
| `layout({ data, children })` | Optional application wrapper around the selected page component                 |
| `defaultMeta(data)`          | Fallback when the document type has no metadata callback                        |

The returned object and its `types` and `linkableTypes` arrays are frozen.
`types` is the authority for server-loader parity: every registered type needs
one loader, including types with `linkable: false`. `linkableTypes` configures
the link resolver. Extra linkable types do not require a loader in this registry.

An empty registry, duplicate registered type, empty type name, or a type marked
both non-linkable and extra-linkable throws during construction. The component
throws if `loaderData` is missing or its type has no renderer. Metadata returns
an empty list without loader data; otherwise it uses the type callback or
`defaultMeta`, returning an empty list if neither exists.

## Route lookup data

The entrypoint also exports:

- `sanityRouteDataQueryFragment`: `_id`, `_type`, and
  `"pathname": pathname.current`.
- `sanityRouteDataQuery`: looks up the first document matching
  `pathname.current == $pathname` and projects those fields.
- `sanityRouteDataDecoder`: validates nonempty identity strings and a
  root-relative pathname, then returns a frozen minimal object, dropping other
  fields.
- `SanityRouteData`: the corresponding `_id`, `_type`, and `pathname` contract.

Server loaders perform this small lookup before running the selected page query.
Your content model must maintain unique routable pathnames; selecting the first
match does not enforce uniqueness. This minimal decoder is not full content
validation, canonical-URL policy, or a check that the type is registered.

## Source and related guides

Implementation: `src/react-router/index.tsx` and `src/react-router/route-data.ts`.
Tests: `tests/react-router/routes.test.tsx` and loader tests.
Continue with [loaders](loaders.md), [links](link.md), or the
[documentation index](README.md).
