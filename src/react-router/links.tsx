/**
 * Render the results of `/link` using React Router; exported by `/react-router`.
 * The route registry supplies allowed types and the link resolver checks CMS
 * fields/URLs. This file adds the React component, anchor refs, document versus
 * router navigation, and safe new-tab attributes. The app supplies children.
 *
 * @see docs/link.md#create-the-shared-react-router-component
 */
import type { ForwardRefExoticComponent, RefAttributes } from 'react'
import type { LinkProps } from 'react-router'
import { forwardRef } from 'react'
import { Link as RouterLink } from 'react-router'
import {
	createSanityLinkResolver,
	type CreateSanityLinkResolverConfig,
	type SanityLink,
	type SanityLinkResolver,
} from '../link/index.js'

/** The resolved CMS link sets the destination and navigation mode, not caller props. */
type RouterLinkProps = Omit<LinkProps, 'reloadDocument' | 'target' | 'to'>

/** Native router-link behavior plus the projected canonical CMS link object. */
export interface SanityLinkProps<
	TType extends string = string,
> extends RouterLinkProps {
	link: SanityLink<TType>
}

/** Stable factory-created component with an anchor ref and typed destination union. */
export type SanityLinkComponent<TType extends string = string> =
	ForwardRefExoticComponent<
		SanityLinkProps<TType> & RefAttributes<HTMLAnchorElement>
	>

/** Reuse the route registry's allowed types instead of maintaining a second list. */
export interface CreateSanityLinksConfig<
	TType extends string = string,
> extends Omit<CreateSanityLinkResolverConfig<TType>, 'linkableTypes'> {
	/** Browser-safe route registry whose linkableTypes define allowed destinations. */
	routes: { readonly linkableTypes: readonly TType[] }
}

/** Includes `resolve` for non-rendering callers alongside the configured component. */
export interface SanityLinks<
	TType extends string = string,
> extends SanityLinkResolver<TType> {
	/** React Router-aware component for normalized Sanity link data. */
	Link: SanityLinkComponent<TType>
}

/**
 * Bind framework-neutral Sanity link resolution to a React Router component.
 * Construct this once at module scope so the component identity remains stable.
 * Import the configured Link throughout the app rather than constructing it in
 * every component. Render the original CMS label as children to retain Stega.
 * External links force document navigation even when their URL shares the app's
 * origin. Invalid links throw the neutral resolver's path-addressed error; the
 * application decides whether to omit them or show an editor warning.
 * @see docs/link.md#create-the-shared-react-router-component
 * @see docs/react-router.md#registry-settings-and-returned-values for allowed types.
 */
export function createSanityLinks<const TType extends string>(
	config: CreateSanityLinksConfig<TType>,
): SanityLinks<TType> {
	const resolver = createSanityLinkResolver({
		linkableTypes: config.routes.linkableTypes,
		...(config.allowedExternalProtocols === undefined
			? {}
			: { allowedExternalProtocols: config.allowedExternalProtocols }),
	})

	const Link = forwardRef<HTMLAnchorElement, SanityLinkProps<TType>>(
		function SanityLink({ link, rel, ...props }, ref) {
			const resolved = resolver.resolve(link)
			const target = resolved.openInNewTab ? '_blank' : undefined

			// Generated values follow the spread so runtime callers cannot replace
			// the resolver's destination or new-tab policy via untyped props.
			return (
				<RouterLink
					{...props}
					ref={ref}
					rel={mergeSafeRel(rel, resolved.openInNewTab)}
					reloadDocument={resolved.linkType === 'external'}
					target={target}
					to={resolved.href}
				/>
			)
		},
	)

	Link.displayName = 'SanityLink'

	return Object.freeze({
		...resolver,
		Link,
	})
}

/** Preserve caller rel tokens while guaranteeing isolation for `_blank` anchors. */
function mergeSafeRel(
	rel: string | undefined,
	opensNewTab: boolean,
): string | undefined {
	if (!opensNewTab) return rel

	const tokens = new Set(
		(rel ?? '')
			.split(/\s+/)
			.map((token) => token.trim())
			.filter(Boolean),
	)
	tokens.add('noopener')
	tokens.add('noreferrer')
	return [...tokens].join(' ')
}
