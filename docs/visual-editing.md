# Visual Editing

Import from `@standard/sanity-kit/react-router/visual-editing`. This optional
browser adapter wraps Sanity's React Router Visual Editing integration and
provides an unstyled preview-exit link.

Install `@sanity/visual-editing ^6.1.2` and its peers, including
`styled-components`, alongside the React/React Router peers. Older Visual Editing
4.x is not supported by this adapter. See the
[peer requirements and declaration-check caveat](prerelease.md#verification-and-handoff).

## How it connects to the rest of the kit

The [server session](server.md) decides whether a request is in preview and which
Sanity perspective to fetch. [Loaders](loaders.md) fetch preview content with
Stega and preserve render strings. The root UI receives only a preview flag,
then enables this adapter. Sanity's upstream component supplies overlays and
React Router refresh integration.

This wrapper does not authenticate, fetch content, encode Stega, clear cookies,
create a live-query store, or configure Studio. Enabling it without preview data
and correctly configured Studio does not establish a complete preview workflow.

## Mount it from the application root

This example belongs in a React Router root route. The `sanity` import is
server-only and used only by its loader; `Route` is the generated root type.

```tsx
import { Outlet, data } from 'react-router'
import {
	SanityPreviewExit,
	SanityVisualEditing,
} from '@standard/sanity-kit/react-router/visual-editing'
import { sanity } from './sanity.server'
import type { Route } from './+types/root'

export async function loader({ request }: Route.LoaderArgs) {
	const context = await sanity.getContext(request)
	return data(
		{ sanityPreview: { enabled: context.preview } },
		{ headers: { 'Cache-Control': 'private, no-store' } },
	)
}

export default function App({ loaderData }: Route.ComponentProps) {
	return (
		<>
			<Outlet />
			<SanityVisualEditing enabled={loaderData.sanityPreview.enabled}>
				<SanityPreviewExit href="/preview-mode/disable" />
			</SanityVisualEditing>
		</>
	)
}
```

The conservative no-store header above protects the request-specific root state.
Ensure the application's final document/data response headers and any outer
caching layer preserve that policy. Do not return the entire server context.

### Loading and server rendering

`enabled` is required and should come from server-derived state. It is a UI gate,
not an authorization decision. When false, the wrapper renders nothing and does
not initiate the lazy import.

When enabled, server rendering and the first client render show `fallback`
(null by default). After browser mount, the Visual Editing module loads through
React Suspense. Optional `children`, such as application preview controls, render
whenever enabled, including while the overlay loads.

Disabling hides the overlay and children; it does not unload already downloaded
JavaScript or destroy the server session. Use the exit route for that.

### Upstream options and debugging

Other Visual Editing props pass through to the upstream component. For example,
`onSuspiciousStega` can report encoded strings in inappropriate DOM locations.
Keep this opt-in audit development-only: it uses a DOM observer and can be
expensive. Do not enable it merely to make ordinary overlays work.

Avoid globally stripping Stega from preview output. Preserve visible text for
editing; clean individual values used for URLs, comparisons, alt text, and head
metadata. The kit's link and image adapters handle their own navigation/alt
attributes; application metadata remains your responsibility.

## Preview exit

`SanityPreviewExit` requires `href`, pointing at the resource route that calls
`sanity.preview.disable`. It renders a normal anchor so document navigation can
receive the HttpOnly cookie deletion. It has no hardcoded endpoint or styling.

It accepts ordinary anchor props and custom children; the default label is
“Disable preview mode.” The `visibility` setting is:

- `standalone` (default): hidden during SSR and the initial client render, then
  visible only outside an iframe and when the window has no opener. This hides
  it in Presentation and preview popups.
- `always`: visible regardless of iframe/popup state, including SSR.

The exit component alone does not know whether preview is enabled. Nest it under
`SanityVisualEditing` or gate it yourself. Your application owns placement,
styling, labels, and any additional editor controls.

## Acceptance checks and source

Test real Studio authorization, embedded preview, standalone preview, refresh
behavior, and exit using your application's origin and credentials. Also check
that published visits do not load the lazy overlay and that preview cookies
never leak into shared response caches. Package fixtures cannot replace those
application checks.

Implementation: `src/react-router/visual-editing/index.tsx`; tests:
`tests/react-router/visual-editing.test.tsx` and
`tests/react-router/visual-editing.browser.test.tsx`. Packed-consumer tests check
the separate browser chunk. See [server sessions](server.md), [loaders](loaders.md),
or the [documentation index](README.md).
