# Documentation

These repository guides cover the implemented checkout and the published
`@standard-design/sanity-kit@0.1.0-alpha.5`. Each newer subsystem identifies its
checkout-only APIs. Alpha.5 does not include Pages, URL fields, collection routing,
or redirect APIs; the package version in this repository is not proof that those
features have been released.

Start with the [README quick start](../README.md#quick-start) and
[entry-point map](../README.md#package-entry-points-and-subsystem-guides).
For published releases, read the [release status](prerelease.md#release-status),
[scope migration](prerelease.md#upgrading-from-alpha3), and
[changelog](../CHANGELOG.md). Alpha.4 consumers should follow the
[client compatibility checklist](prerelease.md#upgrading-from-alpha4);
alpha.2 consumers also need the [API upgrade checklist](prerelease.md#upgrading-from-alpha2).
Historical tarballs, bundled guides, and checksums are unchanged.

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

## Checkout-only Pages and routing integrations

These APIs have public package entry points in local builds, but are not in
npm alpha.5. Consumers keep their own Studio, website routes, and infrastructure.

| Guide                                                     | What it explains                                                                                                       |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [Pages](pages.md)                                         | Native Presentation navigation, page/template creation, collection actions, saved folders, and reviewed folder changes |
| [Shared URL resolution](url.md)                           | Resolve `{pathname, prefix, slug}` without loading Studio                                                              |
| [Collection routing API](collection-routing-api.md)       | Resolve supplied settings with `/url`, or read them using `/url/settings`                                              |
| [URL field](url-field.md)                                 | Install folder or text controls, generation, uniqueness, draft autosave, and checked publishing with or without Pages  |
| [Folders](folders.md)                                     | Persistent folder records, synchronization, creation, empty-only removal, rename, and recovery                         |
| [Folder imports](folder-import.md)                        | Explicitly synchronize folders after external imports without installing Studio                                        |
| [Collection routing settings](collection-routing.md)      | Stored settings, default/locked values, perspective-aware routes, and collection display names                         |
| [Settings publishing](collection-settings-publication.md) | Automatic checked publishing, first saves, unchanged prefixes, reviewed moves, and native action checks                |
| [Collection URL review](collection-prefix-dialog.md)      | Changes and redirect choices in the review dialog, waiting, stale reviews, and uncertain results                       |
| [Redirects](redirects.md)                                 | Studio management, ordinary HTTP handling, React Router middleware, and consumer-owned caching                         |

Install the Studio field and checked workspace wrappers from `/studio`; their
internal planners, writers, actions, and dialogs remain private. The settings
wrapper installs checked Publish automatically; native permissions and action
availability still decide whether an editor can publish.
The [guarded writer](collection-prefix-publication.md) and
[native permission adapter](collection-prefix-write-access.md) guides explain the
implementation behind that installer, not additional public APIs.

Installed-tarball checks cover public imports, native Studio configuration with
Pages and standalone Structure, ordinary HTTP responses, and React Router
transport. The proof Studio has separate live acceptance records. Neither proves
a deployed application's credentials, custom roles, cache backend, or recovery
behavior. See the [remaining release checklist](pages-release-plan.md).

## Design decisions and remaining proposals

- [Pages contracts and proposals](pages-design-proposals.md): approved folder,
  bulk-change, and field/helper behavior, alongside the remaining implementation
  proposals. Approval status is explicit; the guides distinguish the initial URL
  helpers from deferred workflows.
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
the documented subsystem guides are included by the current package build.
An older published artifact contains the guides from its own revision.
