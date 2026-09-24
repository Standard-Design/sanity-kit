# Sitemaps

SanityKit provides XML serialization and a React Router resource-route loader.
Your application supplies its canonical origin, query, decoder, and mapping from
content to URLs. These APIs use standard Web APIs and require no Cloudflare
bindings.

## React Router integration

Create the loader in a server module. This example assumes a project whose
`page` documents have `pathname.current` and `seo.noIndex`; adapt the query to
your schema. Include only canonical, indexable pages that return successful
responses. A registered or linkable route is not automatically indexable.

```ts
// app/sitemap.server.ts
import { createSanitySitemapLoader } from '@standard/sanity-kit/react-router/server'
import { createZodDecoder } from '@standard/sanity-kit/validation/zod'
import { z } from 'zod'
import { sanity } from './sanity.server'
import { siteUrl } from './config.server'

const decoder = createZodDecoder(
	z.array(z.object({ pathname: z.string(), _updatedAt: z.string() })),
)

export const sitemapLoader = createSanitySitemapLoader({
	client: sanity.publishedClient,
	siteUrl,
	query: `*[_type == "page" && defined(pathname.current) && seo.noIndex != true]{
		"pathname": pathname.current,
		_updatedAt
	}`,
	decoder,
	toEntries: (pages) =>
		pages.map((page) => ({
			loc: page.pathname,
			lastmod: page._updatedAt,
		})),
	headers: { 'Cache-Control': 'public, max-age=300' },
})
```

```ts
// app/routes/sitemap.xml.ts
import { sitemapLoader } from '../sitemap.server'

export const loader = sitemapLoader
```

Register that resource route at `/sitemap.xml` in your route configuration.
The loader returns XML with the proper content type, supports GET and HEAD,
and passes the request's abort signal to Sanity. It always fetches with
`perspective: 'published'`, `stega: false`, and `filterResponse: true`, including
when the requester has a preview cookie. The canonical origin comes only from
`siteUrl`, never the request host. Use the published client and keep this module
on the server.

The decoder is required but Zod is optional: any `SanityDataDecoder<T>` works.
The mapper receives the decoded `T` and React Router loader arguments. It may
be asynchronous, add static pages, filter documents, or resolve project-specific
paths. Query `params` can be a static object or a callback receiving loader
arguments. Fetch, decoder, cache, and mapping failures propagate to the
application's error handling; invalid results are never returned as a successful
empty sitemap. Decoders should be pure because caching may require validation
both before storage and after lookup.

## Portable XML helpers

```ts
import {
	createSitemapResponse,
	serializeSitemap,
} from '@standard/sanity-kit/sitemap'

const entries = [{ loc: '/' }, { loc: '/articles/one', lastmod: '2026-09-24' }]
const xml = serializeSitemap(entries, { siteUrl: 'https://example.com' })
const response = createSitemapResponse(entries, {
	siteUrl: 'https://example.com',
})
```

`loc` accepts a root-relative path or an absolute HTTP(S) URL on the same origin.
`siteUrl` must contain only an origin, with an optional trailing slash. Subpath
deployments should include the subpath in every entry. Credentials, fragments,
protocol-relative URLs, controls, backslashes, malformed percent escapes, and
URLs of 2,048 or more characters are rejected. Supply percent-encoded spaces;
Unicode paths are URL-encoded. Stega metadata is cleaned before validation and
XML values are escaped.

`lastmod` is optional. Supply a valid `Date`, `YYYY-MM-DD`, or ISO timestamp with
seconds and a timezone. Use the page's actual modification date, which may
include changes to referenced content; omit it if you cannot determine that
reliably. SanityKit never substitutes the time of sitemap generation.

Duplicate normalized URLs retain their first-seen position and the latest
supplied `lastmod`. Entries otherwise preserve input order; order your query
when deterministic output across fetches matters. Trailing slashes and query
strings remain distinct, so the application should choose its canonical forms.
No default priority or change frequency is emitted.

Response helpers set `application/xml; charset=utf-8` and `nosniff`. They default
to `Cache-Control: no-cache`; use `headers` to supply your application's caching
policy. These policies apply only to successful responses.

## Query caching

The loader optionally accepts a cache adapter. Cache raw query data, including
only published content. Every returned value is decoded, including cache hits;
invalid fetched data is rejected before the cache can store it.

```ts
cache: {
	key: () => 'sitemap:v1:example.com:production:pages',
	getOrLoad: (key, load) => applicationCache.getOrLoad(key, load),
}
```

The application owns TTLs and invalidation. Include the site, dataset, query
version, and every parameter variant in the key. The key callback receives
loader arguments and can return `null` to bypass caching. Do not reuse a cache
that can contain preview data. A decoded shape alone cannot establish whether
an arbitrary cache value was originally fetched from the published perspective.

## Large sites and sitemap indexes

Both serializers enforce the protocol's 50,000 unique-entry and 50 MiB
uncompressed limits, including XML escaping overhead. Exceeding either limit
throws instead of truncating content. The application owns pagination and
partitioning, including stable ordering for paginated Sanity queries.

```ts
import { createSitemapIndexResponse } from '@standard/sanity-kit/sitemap'

export function loader() {
	return createSitemapIndexResponse(
		[{ loc: '/sitemap-pages.xml' }, { loc: '/sitemap-articles.xml' }],
		{ siteUrl: 'https://example.com' },
	)
}
```

`serializeSitemapIndex` returns the equivalent XML string. For index entries,
`lastmod` describes the sitemap file's modification date. Use resource routes
for each listed file, with separate queries/parameters and cache keys. Serve the
index and child sitemaps at the site root so their scope covers the listed pages.
Add the index URL to your application-owned `robots.txt`.

The initial API covers page URLs and sitemap indexes. Image/video extensions,
hreflang alternates, compression, automatic partitioning, and robots generation
remain application concerns.

Protocol references: [Sitemaps XML format](https://www.sitemaps.org/protocol.html)
and [Google's sitemap guidance](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap).
