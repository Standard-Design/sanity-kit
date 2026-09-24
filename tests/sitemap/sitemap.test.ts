import { describe, expect, it } from 'vitest'
import {
	createSitemapIndexResponse,
	createSitemapResponse,
	serializeSitemap,
	serializeSitemapIndex,
	type SitemapEntry,
} from '../../src/sitemap/index.js'

const options = { siteUrl: 'https://example.com' }

describe('sitemap serialization', () => {
	it('renders canonical URLs, escaped XML, Unicode paths, and actual modification dates', () => {
		const xml = serializeSitemap(
			[
				{ loc: '/', lastmod: '2024-02-29' },
				{
					loc: "/café?wood=oak&finish='raw'",
					lastmod: new Date('2026-09-24T10:00:00Z'),
				},
			],
			options,
		)
		expect(xml).toBe(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>https://example.com/</loc><lastmod>2024-02-29</lastmod></url>
<url><loc>https://example.com/caf%C3%A9?wood=oak&amp;finish=%27raw%27</loc><lastmod>2026-09-24T10:00:00.000Z</lastmod></url>
</urlset>`)
		expect(xml).not.toContain('<priority>')
	})

	it('deduplicates normalized URLs in first-seen order and retains the latest lastmod', () => {
		const xml = serializeSitemap(
			[
				{ loc: '/one' },
				{ loc: '/two' },
				{ loc: 'https://EXAMPLE.com:443/one', lastmod: '2025-01-01' },
				{ loc: '/old/../one', lastmod: '2026-01-01' },
				{ loc: '/one', lastmod: '2024-01-01' },
			],
			options,
		)
		expect(xml.match(/<url>/gu)).toHaveLength(2)
		expect(xml).toContain(
			'<loc>https://example.com/one</loc><lastmod>2026-01-01</lastmod>',
		)
		expect(xml.indexOf('/one')).toBeLessThan(xml.indexOf('/two'))
	})

	it('renders sitemap indexes with the same validation and escaping', () => {
		const xml = serializeSitemapIndex(
			[{ loc: '/sitemap-1.xml?a=1&b=2', lastmod: '2026-01-01' }],
			options,
		)
		expect(xml).toContain(
			'<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
		)
		expect(xml).toContain(
			'<sitemap><loc>https://example.com/sitemap-1.xml?a=1&amp;b=2</loc><lastmod>2026-01-01</lastmod></sitemap>',
		)
		expect(xml).toMatch(/<\/sitemapindex>$/u)
	})

	it.each([
		'http://example.com/one',
		'https://other.test/',
		'//other.test/',
		'article',
		'',
		'/one#part',
		'/one#',
		'https://user:pass@example.com/',
		'/bad\\path',
		'/line\nbreak',
		'/bad%zz',
		'/\ud800',
		' /trim',
		'javascript:alert(1)',
	])('rejects unsafe or ambiguous location %j', (loc) => {
		expect(() => serializeSitemap([{ loc }], options)).toThrow()
	})

	it.each([
		'example.com',
		'ftp://example.com',
		'https://example.com/blog',
		'https://example.com/blog/..',
		'https:////example.com',
		'https://user@example.com',
		'https://example.com/?',
		'https://example.com/#',
		' https://example.com',
		'https://example.com\n',
	])('rejects invalid site origin %j', (siteUrl) => {
		expect(() => serializeSitemap([], { siteUrl })).toThrow()
	})

	it.each([
		'2025-02-29',
		'2024-02-30',
		'0000-01-01',
		'2026-13-01',
		'2026-01-00',
		'yesterday',
		'2026-01-01T24:00:00Z',
		'2026-01-01T00:60:00Z',
		'2026-01-01T00:00:60Z',
		'2026-01-01T00:00:00',
		'2026-01-01T00:00:00+25:00',
		'2026-01-01</lastmod>',
	])('rejects invalid lastmod %j', (lastmod) => {
		expect(() => serializeSitemap([{ loc: '/', lastmod }], options)).toThrow(
			TypeError,
		)
	})

	it('rejects malformed runtime input and invalid Date objects', () => {
		expect(() =>
			serializeSitemap(null as unknown as SitemapEntry[], options),
		).toThrow(TypeError)
		expect(() =>
			serializeSitemap([null] as unknown as SitemapEntry[], options),
		).toThrow(TypeError)
		expect(() =>
			serializeSitemap([{ loc: '/', lastmod: new Date('invalid') }], options),
		).toThrow(TypeError)
	})

	it('enforces the URL length limit after encoding', () => {
		const prefixLength = 'https://example.com/'.length
		expect(() =>
			serializeSitemap(
				[{ loc: '/' + 'a'.repeat(2047 - prefixLength) }],
				options,
			),
		).not.toThrow()
		expect(() =>
			serializeSitemap(
				[{ loc: '/' + 'a'.repeat(2048 - prefixLength) }],
				options,
			),
		).toThrow(RangeError)
		expect(() =>
			serializeSitemap([{ loc: '/' + 'é'.repeat(400) }], options),
		).toThrow(RangeError)
	})

	it('accepts 50,000 unique entries and rejects excess entries in urlsets and indexes', () => {
		const entries = Array.from({ length: 50_000 }, (_, index) => ({
			loc: `/${index}`,
		}))
		expect(() => serializeSitemap(entries, options)).not.toThrow()
		entries.push({ loc: '/overflow' })
		expect(() => serializeSitemap(entries, options)).toThrow(/50,000/u)
		expect(() => serializeSitemapIndex(entries, options)).toThrow(/50,000/u)
	})

	it('enforces the 50 MiB limit on escaped XML bytes', () => {
		// Escaping ampersands pushes the XML past 50 MiB with fewer than 50k URLs.
		const entries = Array.from({ length: 6_000 }, (_, index) => ({
			loc: `/${index}?${'&'.repeat(1800)}`,
		}))
		expect(() => serializeSitemap(entries, options)).toThrow(/50 MiB/u)
	})

	it('returns XML Responses with explicit application cache policy', async () => {
		const response = createSitemapResponse([{ loc: '/' }], {
			...options,
			headers: {
				'Cache-Control': 'public, max-age=300',
				'Content-Type': 'text/html',
			},
		})
		expect(response.headers.get('Content-Type')).toBe(
			'application/xml; charset=utf-8',
		)
		expect(response.headers.get('Cache-Control')).toBe('public, max-age=300')
		expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
		expect(await response.text()).toContain('<urlset')
		const index = createSitemapIndexResponse([{ loc: '/sitemap.xml' }], options)
		expect(index.headers.get('Cache-Control')).toBe('no-cache')
		expect(await index.text()).toContain('<sitemapindex')
	})
})
