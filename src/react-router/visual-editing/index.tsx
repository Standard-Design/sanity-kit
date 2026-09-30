/**
 * Show Visual Editing and optional app controls when the server enables preview.
 *
 * The app root reads `kit.getContext` and sends only the preview flag to
 * the UI, never the client or secrets. Sanity's component connects the router and
 * Studio; this wrapper delays loading until browser mount and controls visibility.
 * It does not fetch content, encode Stega, authorize preview, or clear cookies.
 * The exit link must lead to an app resource route using the server disable handler.
 *
 * @see docs/visual-editing.md for the root-loader and UI example.
 * @see docs/server.md#wire-enable-and-disable-resource-routes for the session handlers.
 */
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import type {
	SuspiciousStegaReport,
	VisualEditingProps,
} from '@sanity/visual-editing/react-router'
import { lazy, Suspense, useEffect, useState } from 'react'

export type { SuspiciousStegaReport }

// Keep this dynamic and outside component bodies. Published/SSR paths must not
// execute the import; package browser-bundle tests verify the lazy chunk boundary.
const LazyVisualEditing = lazy(async () => {
	const module = await import('@sanity/visual-editing/react-router')
	return { default: module.VisualEditing }
})

/** Sanity overlay options plus the server-derived preview flag and optional app controls. */
export type SanityVisualEditingProps = VisualEditingProps & {
	/** Request-derived preview state. The overlay is never loaded when false. */
	enabled: boolean
	/** Rendered until the browser-only overlay module is ready. Defaults to null. */
	fallback?: ReactNode
	/** Optional application-owned preview controls. */
	children?: ReactNode
}

/**
 * Lazily mount Sanity's React Router Visual Editing adapter in preview mode.
 * The heavy overlay package is not requested during SSR or for published users.
 * `enabled` is a UI gate, not an authorization decision: derive it server-side.
 * The initial render and hydration show the same fallback. After mounting,
 * Suspense covers the async import. Children are visible whenever preview is
 * enabled, even while the overlay loads. Disabling hides everything but does not
 * unload already-downloaded JavaScript or clear the server preview session.
 * @see docs/visual-editing.md#loading-and-server-rendering
 */
export function SanityVisualEditing({
	children,
	enabled,
	fallback = null,
	...visualEditingProps
}: SanityVisualEditingProps): ReactNode {
	const [browserMounted, setBrowserMounted] = useState(false)

	useEffect(() => {
		if (enabled) setBrowserMounted(true)
	}, [enabled])

	if (!enabled) return null

	return (
		<>
			{browserMounted ? (
				<Suspense fallback={fallback}>
					<LazyVisualEditing {...visualEditingProps} />
				</Suspense>
			) : (
				fallback
			)}
			{children}
		</>
	)
}

/** Preserve normal anchor behavior while requiring an explicit app exit endpoint. */
type NativeAnchorProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>

/** Presentation visibility is a UI choice, independent of preview authorization. */
export interface SanityPreviewExitProps extends NativeAnchorProps {
	/** React Router resource route that destroys the preview session. */
	href: string
	/**
	 * `standalone` hides the link in Presentation and preview popups.
	 * Defaults to `standalone`.
	 */
	visibility?: 'always' | 'standalone'
}

/**
 * Unstyled preview-exit link. This intentionally uses document navigation so
 * the server resource route can clear its HttpOnly preview cookie.
 * The app typically renders it as a child of SanityVisualEditing. Standalone mode
 * stays hidden on the server/first client render, then checks iframe/popup state
 * in an effect; no window access occurs during SSR. No route path is hardcoded.
 * This link does not check preview state itself; nest it under SanityVisualEditing
 * or have the app hide it when preview is off.
 * @see docs/visual-editing.md#preview-exit
 */
export function SanityPreviewExit({
	children = 'Disable preview mode',
	href,
	visibility = 'standalone',
	...anchorProps
}: SanityPreviewExitProps): ReactNode {
	const [visible, setVisible] = useState(visibility === 'always')

	useEffect(() => {
		setVisible(
			visibility === 'always' ||
				(window === window.parent && window.opener == null),
		)
	}, [visibility])

	if (!visible) return null

	return (
		<a {...anchorProps} href={href}>
			{children}
		</a>
	)
}
