import { describe, expect, expectTypeOf, it } from 'vitest'
import {
	createSanityLinkQueryFragments,
	createSanityLinkResolver,
	SanityLinkResolutionError,
	type SanityLink,
} from '../../src/link/index.js'

const resolver = createSanityLinkResolver({
	linkableTypes: ['article', 'landingPage'] as const,
})

type LinkableType = (typeof resolver.linkableTypes)[number]

describe('createSanityLinkResolver', () => {
	it('resolves registered internal documents with search and hash intact', () => {
		expect(
			resolver.resolve({
				linkType: 'internal',
				internalDestination: {
					_id: 'article-1',
					_type: 'article',
					pathname: '/articles/typed-links',
				},
				search: '?source=nav',
				hash: '#examples',
				openInNewTab: true,
			}),
		).toEqual({
			linkType: 'internal',
			href: '/articles/typed-links?source=nav#examples',
			internalDestination: {
				_id: 'article-1',
				_type: 'article',
				pathname: '/articles/typed-links',
			},
			search: '?source=nav',
			hash: '#examples',
			openInNewTab: true,
		})

		expectTypeOf<LinkableType>().toEqualTypeOf<'article' | 'landingPage'>()
	})

	it('allows explicit safe external protocols', () => {
		expect(
			resolver.resolve({
				linkType: 'external',
				url: 'mailto:hello@example.com',
			}),
		).toEqual({
			linkType: 'external',
			href: 'mailto:hello@example.com',
			url: 'mailto:hello@example.com',
			openInNewTab: false,
		})

		const custom = createSanityLinkResolver({
			linkableTypes: ['article'],
			allowedExternalProtocols: ['HTTPS:', 'sms:'],
		})
		expect(custom.allowedExternalProtocols).toEqual(['https:', 'sms:'])
		expect(
			custom.resolve({ linkType: 'external', url: 'sms:+15551234567' }),
		).toMatchObject({ href: 'sms:+15551234567' })
	})

	it('supports applications that intentionally disable one link category', () => {
		const externalOnly = createSanityLinkResolver({ linkableTypes: [] })
		expect(
			externalOnly.resolve({
				linkType: 'external',
				url: 'https://example.com',
			}),
		).toMatchObject({ href: 'https://example.com' })

		const internalOnly = createSanityLinkResolver({
			linkableTypes: ['article'],
			allowedExternalProtocols: [],
		})
		expect(() =>
			internalOnly.resolve({
				linkType: 'external',
				url: 'https://example.com',
			}),
		).toThrow('protocol "https:" is not allowed')
	})

	it.each([
		[
			{
				linkType: 'internal',
				internalDestination: {
					_id: 'secret-1',
					_type: 'secret',
					pathname: '/secret',
				},
			},
			['internalDestination', '_type'],
			'not registered as linkable',
		],
		[
			{
				linkType: 'internal',
				internalDestination: {
					_id: 'article-1',
					_type: 'article',
					pathname: '//evil.example/path',
				},
			},
			['internalDestination', 'pathname'],
			'must be a root-relative path',
		],
		[
			{
				linkType: 'internal',
				internalDestination: {
					_id: 'article-1',
					_type: 'article',
					pathname: '/articles/one?bad=shape',
				},
			},
			['internalDestination', 'pathname'],
			'without a query or hash',
		],
		[
			{
				linkType: 'external',
				url: 'javascript:alert(1)',
			},
			['url'],
			'protocol "javascript:" is not allowed',
		],
		[
			{
				linkType: 'external',
				url: '/relative-is-not-external',
			},
			['url'],
			'must contain an absolute URL',
		],
		[
			{
				linkType: 'external',
				url: ' https://example.com',
			},
			['url'],
			'must not contain surrounding whitespace',
		],
	])('rejects invalid or unsafe destinations', (link, path, message) => {
		try {
			resolver.resolve(link)
			expect.unreachable('Expected link resolution to fail.')
		} catch (error) {
			expect(error).toBeInstanceOf(SanityLinkResolutionError)
			expect(error).toMatchObject({
				code: 'SANITY_LINK_INVALID',
				path,
			})
			expect(error).toHaveProperty('message', expect.stringContaining(message))
		}
	})

	it('rejects malformed resolver configuration and URL suffixes', () => {
		expect(() =>
			createSanityLinkResolver({
				linkableTypes: ['article', 'article'],
			}),
		).toThrow('Duplicate linkable document type')
		expect(() =>
			createSanityLinkResolver({
				linkableTypes: ['article'],
				allowedExternalProtocols: ['https'],
			}),
		).toThrow('Invalid external URL protocol')

		const link: SanityLink<'article'> = {
			linkType: 'internal',
			internalDestination: {
				_id: 'article-1',
				_type: 'article',
				pathname: '/articles/one',
			},
			search: 'missing-prefix=true',
		}
		expect(() => resolver.resolve(link)).toThrow(
			'Expected `search` to begin with `?`',
		)

		expect(() =>
			resolver.resolve({ ...link, search: '?one=two#wrong-part' }),
		).toThrow('contain only its search portion')
		expect(() => resolver.resolve({ ...link, openInNewTab: 'yes' })).toThrow(
			'Expected `openInNewTab` to be a boolean',
		)
	})

	it('reports structured failures for malformed link objects', () => {
		expect(() => resolver.resolve(null)).toThrow(
			'Expected a Sanity link object',
		)
		expect(() => resolver.resolve({ linkType: 'download' })).toThrow(
			'Expected `linkType` to be either "internal" or "external"',
		)
		expect(() =>
			resolver.resolve({
				linkType: 'internal',
				internalDestination: null,
			}),
		).toThrow('Expected an internal link destination')
		expect(() =>
			resolver.resolve({
				linkType: 'internal',
				internalDestination: {
					_id: '',
					_type: 'article',
					pathname: '/article',
				},
			}),
		).toThrow('Expected `_id` to be a non-empty string')
	})

	it('rejects malformed runtime configuration values', () => {
		expect(() =>
			createSanityLinkResolver({ linkableTypes: [42] as never }),
		).toThrow('Linkable document types must not be empty')
		expect(() =>
			createSanityLinkResolver({
				linkableTypes: ['article'],
				allowedExternalProtocols: [42] as never,
			}),
		).toThrow('External URL protocols must be strings')
	})
})

describe('createSanityLinkQueryFragments', () => {
	it('creates object and Portable Text projections around app route data', () => {
		const fragments = createSanityLinkQueryFragments({
			internalDestinationQueryFragment: '_id, _type, "pathname": slug.current',
		})

		expect(fragments.linkQueryFragment).toContain('label,')
		expect(fragments.linkQueryFragment).toContain(
			'internalDestination->{_id, _type, "pathname": slug.current}',
		)
		expect(fragments.linkQueryFragment).toContain('search,')
		expect(fragments.portableTextLinkQueryFragment).not.toContain('label,')
		expect(Object.isFrozen(fragments)).toBe(true)
	})

	it('rejects an empty internal destination projection', () => {
		expect(() =>
			createSanityLinkQueryFragments({
				internalDestinationQueryFragment: '   ',
			}),
		).toThrow('must not be empty')
	})
})
