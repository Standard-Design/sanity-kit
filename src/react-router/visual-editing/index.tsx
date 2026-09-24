import type { AnchorHTMLAttributes, ReactNode } from 'react'
import type {
	SuspiciousStegaReport,
	VisualEditingProps,
} from '@sanity/visual-editing/react-router'
import { lazy, Suspense, useEffect, useState } from 'react'

export type { SuspiciousStegaReport }

const LazyVisualEditing = lazy(async () => {
	const module = await import('@sanity/visual-editing/react-router')
	return { default: module.VisualEditing }
})

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

type NativeAnchorProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>

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
