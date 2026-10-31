# Documentation

These guides explain `@standard-design/sanity-kit` version `0.1.0-alpha.5`,
published on npm and GitHub. Alpha.5 raises the client 8 minimum to `8.6.1`
and bundles the documentation improvements without changing runtime APIs or behavior.
For a short introduction, start with the [README quick start](../README.md#quick-start)
and [entry-point map](../README.md#package-entry-points-and-subsystem-guides). Read the
[scope migration](prerelease.md#upgrading-from-alpha3) and
[changelog](../CHANGELOG.md) before adopting alpha.5. Consumers already on alpha.4
should follow the [client compatibility checklist](prerelease.md#upgrading-from-alpha4).
Consumers still on alpha.2 must also follow the
[API upgrade checklist](prerelease.md#upgrading-from-alpha2).

Alpha.5 includes the navigation and status corrections made after alpha.4.
The repository also corrects alpha.5's preparation-time publication wording;
published tarballs and their bundled documentation remain unchanged. See
[release status](prerelease.md#release-status) for the npm tag caveat.

## Choose a starting point

For a full React Router integration, read core, server, routing, and loaders in
that order. Then add images, links, Visual Editing, and sitemaps as needed. You
can use the framework-independent helpers without adopting the router adapter.

| Subsystem                                | What you will learn                                                   |
| ---------------------------------------- | --------------------------------------------------------------------- |
| [Core](core.md)                          | Configure Sanity and validate data without losing preview metadata    |
| [Image tools](image.md)                  | Prepare source data and build Sanity image URLs                       |
| [React images](image-react.md)           | Share a responsive image component and choose layout/loading settings |
| [Links](link.md)                         | Project, resolve, and render internal and external links              |
| [React Router](react-router.md)          | Dispatch document types to page components and metadata               |
| [Server clients and sessions](server.md) | Keep secrets server-side and enable or disable preview                |
| [Loaders](loaders.md)                    | Fetch pages, validate drafts and published data, and cache safely     |
| [Visual Editing](visual-editing.md)      | Mount overlays only in preview and provide an exit control            |
| [Zod validation](validation-zod.md)      | Connect schemas to the common decoder contract                        |
| [Sitemaps](sitemaps.md)                  | Produce validated, published-only XML responses                       |

## In-development Studio integration

[Pages](pages.md) explains the plugin foundation, how it works with
native Presentation, and the approved navigator and URL-field designs. It is
separate from the released subsystems above: local builds now include `/studio`,
but the current npm release does not. Consumers keep their own Studio installation.
The guide distinguishes the working navigator and routing foundation from
planned URL editing, folder actions, and other features.

[Shared URL resolution](url.md) describes the local-build `/url` entry point:
derive `{pathname, prefix, slug}` from the same registration without loading
Studio. Fixed-prefix resolution is implemented; the input field remains future
work. This entry is not in the current npm release.
Its guide also covers approved private candidate cleanup and slug generation,
plus the approved internal conflict-checking/native `isUnique` adapter.
These layers do not yet add Studio controls or document writes.
The [Studio generation bridge](url.md#studio-generation-context-internal) is now
approved: native source/context options, explicit candidate preparation, and
discarding stale asynchronous results.

[Folders](folders.md) explains the approved private registry planner: saved
folder records, explicit adoption from existing URLs, and empty-only removal.
The planner returns proposed changes; persistence and editor controls are still
separate work.

[Collection routing settings](collection-routing.md) covers the approved private
prefix resolver. It selects published or draft settings and produces the
same route configuration the existing URL helpers already use. A private loader
is now under review: it reads the configured settings IDs and checks the response
before resolving routes. Studio controls remain later work.

[Redirects](redirects.md) covers approved private snapshot validation and lookup.
The broader [redirect design](redirects-design.md) still describes future
loading, caching, HTTP handling, editor controls, and publication coordination.

## Design decisions and remaining proposals

- [Pages contracts and proposals](pages-design-proposals.md): approved folder,
  bulk-change, and field/helper behavior, alongside the remaining implementation
  proposals. Approval status is explicit; the guides distinguish the initial URL
  helper from future editing and persistence workflows.
- [Redirect subsystem](redirects-design.md): proposed Sanity-managed rules,
  Studio workflows, URL-change integration, frontend resolution, and optional
  consumer-owned caching. Includes safety policies and implementation gates;
  none of the illustrated redirect APIs exist in the released package.

## Shared terms

- **Factory:** a function that accepts configuration and returns ready-to-use
  helpers or components. Create shared image, link, and route factories once
  in application modules, not during React rendering.
- **Decoder:** an object with a `decode(unknown)` method that either returns a
  typed value or a list of validation issues. It may also transform values.
- **Raw data:** the original query result, before decoder transforms or defaults.
- **Stega:** invisible metadata Sanity can encode in strings to connect rendered
  text to its editable source. Keep it in preview render strings; remove it for
  comparisons, navigation, and metadata where appropriate.
- **Clean shadow:** a separate Stega-clean value used for strict validation. It
  does not replace or mutate the original render data.
- **Perspective:** which Sanity content view to fetch, such as published content,
  drafts, or a release stack. Preview session context carries this selection.
- **Registry:** the application's list of document types and their handlers.
  Browser routes and server loaders must agree on these types.
- **Cache adapter:** an application function that retrieves or stores data using
  a key supplied by the kit. The kit does not supply a storage backend.

## Examples and ownership

Examples use application-owned names such as `articleQuery`, `articleSchema`,
`sanityRoutes`, `storage`, and `env`. They are not exports from the kit. Define
or import them in your application. Names beginning with `Route` refer to React
Router's generated route-module types. File locations in examples are suggested
application organization, not files generated by the package.

Every guide states its import boundary. Server clients and credentials must not
be imported into browser-reachable modules. Browser bundle checks protect the
package's own exports, not arbitrary application import graphs.

## Release and maintenance references

- [Prerelease integration](prerelease.md): installation, dependencies, testing,
  artifact preparation, and application acceptance checks.
- [Extraction provenance](extraction-provenance.md): extraction boundaries and
  the focused attribution audit.
- [Third-party notices](../THIRD_PARTY_NOTICES.md): copied/adapted code credits
  and the recorded MIT interpretation, with upstream confirmation a follow-up.
- [Package overview](../README.md): quick start, entry points, and development commands.
- [Changelog](../CHANGELOG.md): version history and compatibility changes.

Source and test paths mentioned in these guides refer to the matching repository
revision. They are not shipped in the compiled tarball. Public declarations and
all these guides are shipped with the package.
