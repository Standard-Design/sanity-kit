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

type RouterLinkProps = Omit<LinkProps, 'reloadDocument' | 'target' | 'to'>

export interface SanityLinkProps<
	TType extends string = string,
> extends RouterLinkProps {
	link: SanityLink<TType>
}

export type SanityLinkComponent<TType extends string = string> =
	ForwardRefExoticComponent<
		SanityLinkProps<TType> & RefAttributes<HTMLAnchorElement>
	>

export interface CreateSanityLinksConfig<
	TType extends string = string,
> extends Omit<CreateSanityLinkResolverConfig<TType>, 'linkableTypes'> {
	/** Browser-safe Sanity route registry used as the link authority. */
	routes: { readonly linkableTypes: readonly TType[] }
}

export interface SanityLinks<
	TType extends string = string,
> extends SanityLinkResolver<TType> {
	/** React Router-aware component for normalized Sanity link data. */
	Link: SanityLinkComponent<TType>
}

/**
 * Bind framework-neutral Sanity link resolution to a React Router component.
 * Construct this once at module scope so the component identity remains stable.
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
