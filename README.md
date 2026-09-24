# `@standard/sanity-kit`

Reusable, runtime-explicit Sanity primitives for Standard Design applications.

This repository is a clean extraction of the useful Sanity integration patterns
from Sawkill. It intentionally does not import Sawkill's application models,
styles, environment globals, or Cloudflare bindings.

## Status

The initial extraction is prepared as `0.1.0-alpha.0` for integration testing.
It remains private and is not published to npm. Reviewed consumers install a
compiled tarball from an approved commit. See the [prerelease guide](docs/prerelease.md)
for dependency requirements, verification, and artifact handoff.

Browser-safe configuration is explicit:

```ts
import { defineSanityConfig } from '@standard/sanity-kit/core'

export const sanityConfig = defineSanityConfig({
	apiVersion: '2026-09-18',
	dataset: 'production',
	projectId: 'your-project-id',
	studioUrl: 'https://studio.example.com',
})
```

The API version is required rather than defaulted so a package release cannot
silently pin every consumer to a stale Sanity API date.

Runtime validation is decoder-based rather than tied to a schema library. The
core validator cleans a non-mutating Stega shadow while preserving the original
data for Visual Editing:

```ts
import { validateSanityData } from '@standard/sanity-kit/core'
import { createZodDecoder } from '@standard/sanity-kit/validation/zod'

const validation = await validateSanityData(
	previewData,
	createZodDecoder(pageSchema),
)

// Keep this value for preview rendering and overlays.
validation.data

// Parsed or transformed clean data is separate.
if (validation.result.success) validation.result.value
```

Applications decide whether invalid data is tolerated. Preview loaders can
return `validation.result.diagnostics`; published loaders can call
`requireValidSanityData(validation)` to enforce a strict boundary.

Image helpers are also explicitly configured and retain access to Sanity's
native builder:

```ts
import { createSanityImageTools } from '@standard/sanity-kit/image'

const images = createSanityImageTools(sanityConfig)

const cardUrl = images.buildUrl(image, {
	aspectRatio: '16/9',
	width: 1200,
})

const customUrl = images.urlFor(image).width(800).fit('crop').url()
```

The image entrypoint never reads application environment globals. Crops and
hotspots are passed intact to the official Sanity image URL builder.

React applications can create a configured responsive component from the
separate `/image/react` entrypoint:

```tsx
import { createSanityImageComponent } from '@standard/sanity-kit/image/react'

export const SanityImage = createSanityImageComponent({
	dataset: sanityConfig.dataset,
	projectId: sanityConfig.projectId,
})

<SanityImage
	value={page.image}
	alt={page.image.alt}
	intrinsicWidth={page.image.width}
	intrinsicHeight={page.image.height}
	aspectRatio="16/9"
	sizes="(min-width: 60rem) 50vw, 100vw"
/>
```

The component emits a capped `srcSet`, does not upscale the source, reserves
layout space with width and height attributes, and preloads only images marked
with `fetchPriority="high"`. It has no CSS, context, or application-model
dependency.

React Router applications configure clients and preview sessions through the
physically separate server entrypoint:

```ts
import { createSanityKit } from '@standard/sanity-kit/react-router/server'

export const sanity = createSanityKit({
	apiVersion: '2026-09-19',
	dataset: env.PUBLIC_SANITY_DATASET,
	projectId: env.PUBLIC_SANITY_PROJECT_ID,
	readToken: env.SANITY_API_READ_TOKEN,
	sessionSecret: env.SANITY_PREVIEW_SESSION_SECRET,
	studioUrl: env.PUBLIC_SANITY_STUDIO_URL,
})
```

The returned `sanity.preview.enable` and `sanity.preview.disable` functions are
drop-in resource-route loaders. `sanity.preview.getContext(request)` selects a
published or preview client and typed fetch options without reading global
environment state. The cookie-signing secret is intentionally separate from
Sanity's preview URL validation protocol.

Expose only serializable preview state from the root loader, then mount the
optional browser integration from its dedicated subpath:

```tsx
import {
	SanityPreviewExit,
	SanityVisualEditing,
} from '@standard/sanity-kit/react-router/visual-editing'

export async function loader({ request }: Route.LoaderArgs) {
	const context = await sanity.preview.getContext(request)
	return { sanityPreview: { enabled: context.preview } }
}

export default function App({ loaderData }: Route.ComponentProps) {
	return (
		<>
			<Outlet />
			<SanityVisualEditing
				enabled={loaderData.sanityPreview.enabled}
				onSuspiciousStega={
					import.meta.env.DEV
						? (reports) => console.warn('Suspicious Stega', reports)
						: undefined
				}
			>
				<SanityPreviewExit
					className="application-preview-exit"
					href="/preview-mode/disable"
				/>
			</SanityVisualEditing>
		</>
	)
}
```

`SanityVisualEditing` starts the official React Router overlay and refresh
integration only after browser mount and only when the request-derived
`enabled` flag is true. This keeps the large Visual Editing implementation out
of the normal server and published-visitor module graph. Suspicious-Stega DOM
auditing is opt-in and should normally remain development-only because it uses
a full DOM observer. `SanityPreviewExit` is unstyled, uses document navigation
to clear the HttpOnly session, and hides inside Presentation or preview popups
unless configured with `visibility="always"`.

This subpath intentionally does not own application GROQ queries, live-query
stores, route modules, or view models. Install `@sanity/visual-editing` alongside
the package when using it. This prerelease requires React and React DOM 19.2.7+
to satisfy React Router 8.4's peer requirements.

Sanity-driven page types are registered through the browser-safe React Router
entrypoint:

```tsx
import {
	createSanityRoutes,
	defineSanityRoute,
} from '@standard/sanity-kit/react-router'

export const sanityRoutes = createSanityRoutes({
	routes: [
		defineSanityRoute({
			type: 'article',
			component: ArticlePage,
			meta: (article) => [{ title: article.title }],
		}),
	],
})

export const meta = sanityRoutes.meta
export default sanityRoutes.default
```

The registry exposes immutable runtime `types` and `linkableTypes` collections
for server-loader parity checks and link helpers. It contains no clients,
tokens, queries for page content, or server-only imports.

Framework-neutral link resolution is available from the separate `/link`
entrypoint. Bind the React Router adapter directly to the route registry so its
`linkableTypes` remain the authority for valid internal destinations:

```tsx
import { createSanityLinks } from '@standard/sanity-kit/react-router'

export const sanityLinks = createSanityLinks({ routes: sanityRoutes })
export const SanityLink = sanityLinks.Link

<SanityLink link={callToAction.link} prefetch="intent">
	{callToAction.link.label}
</SanityLink>
```

Call `createSanityLinks()` once at module scope in a shared application module,
then import the configured `SanityLink` wherever it is needed. Do not call the
factory inside a React component or during rendering; doing so creates a new
component identity on every call.

Internal links preserve separate pathname, search, and hash values. A non-empty
`search` includes its leading `?`, and a non-empty `hash` includes its leading
`#`. External links accept only explicit protocols (`http:`, `https:`,
`mailto:`, and `tel:` by default), use document navigation, and add
`noopener noreferrer` whenever they open a new tab. The resolver throws a
structured error for malformed data or internal document types outside the
registry.

Consumers can pair their own route-data projection with the normalized link
contract without importing React Router or Zod:

```ts
import { createSanityLinkQueryFragments } from '@standard/sanity-kit/link'
import { sanityRouteDataQueryFragment } from '@standard/sanity-kit/react-router'

export const { linkQueryFragment, portableTextLinkQueryFragment } =
	createSanityLinkQueryFragments({
		internalDestinationQueryFragment: sanityRouteDataQueryFragment,
	})
```

The matching server registry pairs every route type with a query and decoder:

```ts
import {
	createSanityLoaders,
	defineSanityLoader,
} from '@standard/sanity-kit/react-router/server'

export const sanityLoaders = createSanityLoaders({
	routes: sanityRoutes,
	kit: sanity,
	loaders: [
		defineSanityLoader({
			type: 'article',
			query: articleQuery,
			decoder: articleDecoder,
		}),
	],
	cache: applicationCacheAdapter,
})

export const loader = sanityLoaders.loader
```

Registry parity is checked at startup. Published data is strict by default;
preview data retains its original Stega strings and reports decoder diagnostics
before passing incomplete drafts through. Cache adapters receive only published
requests, and cached values are always decoded again before use. Loaders with
custom query parameters must supply a corresponding `cacheKey` to opt into page
caching; otherwise the kit bypasses that cache to prevent cross-variant data.

## Sitemaps

`createSanitySitemapLoader` from `@standard/sanity-kit/react-router/server`
combines an application-owned query, required decoder, and entry mapper into
a published-only XML resource route. Supply the canonical site origin and
optionally inject a query cache. Preview cookies never select draft content.

For other integrations, `@standard/sanity-kit/sitemap` provides
`serializeSitemap`, `serializeSitemapIndex`, `createSitemapResponse`, and
`createSitemapIndexResponse`. The serializers escape XML, validate URLs and
dates, deduplicate canonical URLs, and enforce protocol limits.

See [sitemap integration and caching](docs/sitemaps.md) for complete examples.

## Intended boundaries

- `@standard/sanity-kit/core`: browser-safe configuration and shared contracts
- `@standard/sanity-kit/image`: explicit image URL helpers
- `@standard/sanity-kit/image/react`: optional responsive React image component
- `@standard/sanity-kit/link`: framework-neutral link contracts, GROQ fragments,
  and safe resolution
- `@standard/sanity-kit/sitemap`: portable XML sitemap and index serialization
  and Web Response helpers
- `@standard/sanity-kit/react-router`: client-safe React Router integration
- `@standard/sanity-kit/react-router/visual-editing`: optional lazy browser
  overlays and headless preview-exit control
- `@standard/sanity-kit/react-router/server`: server-only clients, preview
  sessions, handlers, and loaders
- `@standard/sanity-kit/validation/zod`: optional Zod adapter

Only documented entrypoints are exported. Packed-consumer checks cover runtime
imports, declarations, optional peers, and browser bundle boundaries.

## Development

Node.js 24 and pnpm 11 are required.

```sh
pnpm install
pnpm verify
pnpm test:package
```

No commits are created until each logical change set and its proposed commit
message have been reviewed.

`pnpm build` assembles a compiled-only package in `dist`; root packing is blocked.
After approval and commit, `pnpm pack:release` creates a local tarball with
commit and checksum metadata. It does not tag, push, or publish.
