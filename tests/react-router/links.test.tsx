import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { createSanityLinks } from '../../src/react-router/index.js'

const links = createSanityLinks({
	routes: { linkableTypes: ['article', 'landingPage'] as const },
})

type RegisteredLinkType = (typeof links.linkableTypes)[number]

describe('createSanityLinks', () => {
	it('renders internal destinations through React Router', () => {
		const html = renderToStaticMarkup(
			<MemoryRouter>
				<links.Link
					className="button"
					link={{
						linkType: 'internal',
						internalDestination: {
							_id: 'article-1',
							_type: 'article',
							pathname: '/articles/typed-links',
						},
						search: '?source=hero',
						hash: '#details',
					}}
				>
					Read the article
				</links.Link>
			</MemoryRouter>,
		)

		expect(html).toContain('href="/articles/typed-links?source=hero#details"')
		expect(html).toContain('class="button"')
		expect(html).toContain('data-discover="true"')
		expectTypeOf<RegisteredLinkType>().toEqualTypeOf<
			'article' | 'landingPage'
		>()
	})

	it('uses document navigation for external links', () => {
		const html = renderToStaticMarkup(
			<MemoryRouter>
				<links.Link
					rel="nofollow"
					link={{
						linkType: 'external',
						url: 'https://example.com/resource?one=two#three',
						openInNewTab: true,
					}}
				>
					External resource
				</links.Link>
			</MemoryRouter>,
		)

		expect(html).toContain('href="https://example.com/resource?one=two#three"')
		expect(html).toContain('target="_blank"')
		expect(html).toContain('rel="nofollow noopener noreferrer"')
		expect(html).not.toContain('data-discover')
	})

	it('fails before rendering unknown internal document types', () => {
		expect(() =>
			renderToStaticMarkup(
				<MemoryRouter>
					<links.Link
						link={
							{
								linkType: 'internal',
								internalDestination: {
									_id: 'secret-1',
									_type: 'secret',
									pathname: '/secret',
								},
							} as never
						}
					>
						Secret
					</links.Link>
				</MemoryRouter>,
			),
		).toThrow('not registered as linkable')
	})

	it('forwards custom external protocol policy to the shared resolver', () => {
		const webOnlyLinks = createSanityLinks({
			routes: { linkableTypes: ['article'] },
			allowedExternalProtocols: ['https:'],
		})

		expect(() =>
			renderToStaticMarkup(
				<MemoryRouter>
					<webOnlyLinks.Link
						link={{ linkType: 'external', url: 'mailto:hello@example.com' }}
					>
						Email
					</webOnlyLinks.Link>
				</MemoryRouter>,
			),
		).toThrow('protocol "mailto:" is not allowed')
	})
})
