# Server clients and preview sessions

Import from `@standard/sanity-kit/react-router/server` only in server-side
application code. This entrypoint creates Sanity clients and signed preview
sessions. It also exports [page loaders](loaders.md) and the
[sitemap loader](sitemaps.md), documented separately.

It uses standard Web APIs and React Router cookies, not Cloudflare bindings or
an application-global environment. Install the server adapter's
[required peers](prerelease.md#supported-peers), including `@sanity/preview-url-secret`.

## Create the server kit

```ts
// app/sanity.server.ts — env is supplied by your application's runtime.
import { createSanityKit } from '@standard/sanity-kit/react-router/server'

export const sanity = createSanityKit({
	projectId: env.PUBLIC_SANITY_PROJECT_ID,
	dataset: env.PUBLIC_SANITY_DATASET,
	apiVersion: '2026-09-18',
	studioUrl: env.PUBLIC_SANITY_STUDIO_URL,
	readToken: env.SANITY_API_READ_TOKEN,
	sessionSecret: env.SANITY_PREVIEW_SESSION_SECRET,
})
```

If your runtime supplies secrets per request, put this construction in an
application factory that receives those bindings. The kit does not choose how
environment values are loaded or stored. Construction validates configuration
locally; it does not fetch Sanity data.

`studioUrl` is required here, unlike in public core configuration. The read token
must be nonempty. The signing secret must contain at least 32 characters after
trimming; an empty/whitespace-only secret and a short nonempty secret produce
distinct errors. The original supplied string is used for signing. A length
check is not a randomness guarantee: supply an independently generated secret,
not the Sanity token or a public value.

## Published and preview clients

| Client            | Token             | Perspective          | Stega               | CDN                                       |
| ----------------- | ----------------- | -------------------- | ------------------- | ----------------------------------------- |
| `publishedClient` | None              | `published`          | Off                 | On by default; configurable with `useCdn` |
| `previewClient`   | Server read token | Defaults to `drafts` | On, with Studio URL | Off                                       |

Separate client instances prevent published requests from inheriting preview
credentials or settings. `clientFor(preview)` is a low-level boolean selection;
it does not apply a request's release-stack perspective. Use request context for
ordinary page fetching so the same code handles published and preview requests:

```ts
const { preview, options, client } = await sanity.getContext(request)
const result = await client.fetch(query, params, {
	...options,
	signal: request.signal,
})
```

`getContext` is the shared path for both published and preview requests. It reads
the signed cookie and returns a `SanityRequestContext` containing `preview`,
`perspective`, `client`, and fetch `options`. Here `preview` is a boolean, not the
whole context; omit it from destructuring if you only need to fetch. Pass the
options to fetch: the selected perspective can differ from the preview client's
default. Reading context does
not enable preview or write a cookie. [Page loaders](loaders.md) handle this
selection once for their lookup and page query.

Never serialize the kit, either client, context, or secrets to the browser. A
root loader should return only required serializable state such as
`{ sanityPreview: { enabled: preview } }` when using the destructuring above.

### Migration from alpha.2

In alpha.3, replace `sanity.preview.getContext(request)`
with `sanity.getContext(request)` and rename any imported `SanityPreviewContext`
type to `SanityRequestContext`. The old method and type are not retained as aliases.
The result fields, signed cookies, client selection, and fetch options are unchanged.
`sanity.preview.enable` and `sanity.preview.disable` remain the session-changing
operations. Update hand-written kit mocks to put `getContext` at the top level too.

## Wire enable and disable resource routes

Create two route modules and register their paths in your application:

```ts
// app/routes/preview-enable.ts
import { sanity } from '../sanity.server'

export const loader = sanity.preview.enable
```

```ts
// app/routes/preview-disable.ts
import { sanity } from '../sanity.server'

export const loader = sanity.preview.disable
```

For example, mount them at `/preview-mode/enable` and `/preview-mode/disable`.
Configure Studio's Presentation/preview URL setup to use your enable endpoint.
The kit does not modify Studio configuration or generate route paths.

The enable handler validates Sanity's preview URL protocol using the server
client. An invalid URL returns 401 with `Cache-Control: no-store`. A valid one
stores preview state and perspective in a signed cookie, then returns a 307
redirect. The disable handler destroys that session and redirects to the
`redirect` query parameter, falling back to `/`.

Both redirect paths use `safeRedirectLocation`: relative and same-origin
absolute targets become local path/query/fragment values; invalid or off-origin
targets fall back to `/`. Successful redirects are also no-store. The request
URL must have the correct public origin; proxy/origin handling belongs to the
host application.

Use a document-navigation link to the disable endpoint so the browser receives
the cookie-clearing response. [SanityPreviewExit](visual-editing.md#preview-exit)
provides that link.

## Cookie configuration

Optional `preview.cookie` settings are `name`, `domain`, `path`, `sameSite`,
`secure`, and `maxAge` (seconds). Defaults are:

- Name `__sanity_preview`, path `/`.
- `SameSite=None` and `Secure=true`, for cross-origin Studio iframe use over HTTPS.
- HttpOnly and signing are always enforced, even when other settings are changed.

The cookie stores preview state and perspective, not the token or signing secret.
Signing detects tampering; it is not encryption. Use suitable names/scopes when
multiple apps share a host. HTTPS, browser third-party-cookie restrictions, and
any local-development overrides remain application concerns. Changing the
signing secret invalidates existing signed sessions.

Successful content responses are not automatically no-store just because the
request is in preview. Your loader wrapper and HTTP caching layer must keep
preview responses private and non-cacheable. The kit's page-data cache bypass
does not control a CDN or framework response cache.

## Perspectives and trusted extension points

`parseSanityPreviewPerspective` accepts the built-in perspectives and custom
release IDs/stacks. Empty or invalid input falls back to `drafts`. A single
custom release becomes a one-element stack. Parsing limits input to ten
comma-separated entries of up to 256 characters each, with letters, digits,
and `._~:/-`. It checks syntax and bounds, not whether a release exists.

`preview.parsePerspective` can replace this parser.
`preview.validateUrl` can replace the preview URL validator and is useful for
controlled integration/testing. These are trusted server extension points;
do not replace protocol validation with a truthy query-parameter check.

The preview URL protocol authorizes this preview workflow. It is not a general
application login, authorization system, or content-access policy.

## Source and related guides

Implementation: `src/react-router/server/index.ts`; tests:
`tests/react-router/server.test.ts`. Continue with [loaders](loaders.md),
[Visual Editing](visual-editing.md), [sitemaps](sitemaps.md), or the
[documentation index](README.md).
