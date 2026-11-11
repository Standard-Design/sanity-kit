# Testing website redirects

The fixture provides two local websites when you run `pnpm studio:preview`.
Both use the configured Sanity project and dataset and never write documents.
They have different jobs:

| Address                 | Purpose                                                                                                                                                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `http://localhost:3334` | Studio preview. Reads drafts by default, follows Studio's perspective selection, and shows edit overlays. Saved redirects are bypassed, including when the selected perspective is Published. |
| `http://localhost:3335` | Published website. Reads published settings and content, follows saved redirects, and has no edit overlays. Links make normal HTTP requests.                                                  |

Keep Studio pointed at port 3334. Open port 3335 in another browser tab to test
what happens to an old URL after publishing a page URL, folder name, or
collection-prefix change. Changing a preview query parameter or sending a cookie
cannot switch the published listener into preview mode.

## Check a saved redirect

Publish a reviewed URL change in Studio using the existing test content, then
visit its old path on port 3335. The server should respond with the saved 301 or
302 status and the new path in its `Location` header. For example, if your test
redirect moves `/old` to `/new`:

```sh
curl -I http://localhost:3335/old
```

Use the actual source path from your test. This guide does not create a redirect
at `/old`. A GET request follows the same rule as HEAD. Incoming query parameters
are dropped from the destination. Redirect responses use `Cache-Control:
no-store` so a test browser is not instructed to retain a permanent redirect.
Previously cached redirects from another server configuration may still exist.

Visit that same path on port 3334 to confirm the preview can stay there without
being redirected. A missing preview page may show “No fixture page at this URL”;
preview bypass does not recreate content at its old address.

## How requests are handled

`preview-http.ts` uses the kit's existing `resolveRedirectRequest` and
`redirectResponse` helpers before serving each published page. These read the
complete bounded published redirect inventory, validate it, and return the HTTP
response. A missing rule continues to the fixture page. Invalid or unavailable
redirect data returns a generic 503; it never silently becomes an empty rule list.
Assets and the internal `/fixture-data` endpoint are outside the redirect lookup.
The published data endpoint always reads the published perspective.

The fixture intentionally does not cache redirect rules. Each eligible request
reads again, so a published edit or retirement becomes visible after Sanity makes
it available. A consuming application can supply its own cache through the kit's
existing adapter contract; this fixture installs no cache infrastructure.

This request check does not load a complete inventory of website pages or prove
that a destination exists. It explicitly uses `destinations: 'unverified'`.
Publication checks provide the separate URL-conflict checks. The website's link
list still displays at most 50 entries; that limit does not truncate redirect
lookup.

## Scope and limits

These are development-only loopback servers with Host and Origin checks. Port
3334 uses the server's viewer token to read drafts; it does **not** implement an
authenticated preview session. Do not deploy either server or expose it through
a public tunnel. Production applications must establish preview access through
their own trusted session handling, not through a URL parameter.

The published listener proves ordinary HTTP delivery, not React Router client
navigation. Its links deliberately reload the document. React Router consumers
use the separate framework adapter to cover their data requests.

`tests/studio/fixture-http-redirects.test.ts` exercises real temporary loopback
HTTP servers with mocked Sanity reads. It checks response status and headers,
preview bypass, published perspective enforcement, refreshed rules, errors, and
reserved endpoints. These automated tests do not replace live checks against the
test dataset, and starting the fixture does not seed or publish anything.
