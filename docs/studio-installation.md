# Install Pages in your Studio

Start with an existing Sanity Studio and a website you can run locally or
preview online. This guide adds the Pages navigator and URL field. You can
then add editable collection settings or redirect management. Your Studio
keeps its schemas, tools, and sign-in, and your website keeps its routes.

## 1. Add SanityKit to your Studio

Use Node.js 24 or newer. Check the exact `sanity` peer of the SanityKit version
you plan to install. The example below uses the tested **Sanity 6.24.0** setup.
For published alpha.9, use its [Sanity 6.17.0 setup](https://github.com/Standard-Design/sanity-kit/blob/v0.1.0-alpha.9/docs/pages.md#dependencies-and-package-isolation).

Add SanityKit in your Studio package.

```sh
pnpm add -E @standard-design/sanity-kit@0.1.0-alpha.10
```

With npm, replace `pnpm add -E` with `npm install --save-exact`. For a reviewed
tarball, use its path in place of the package name and version.

Studio already depends on Sanity UI, Sanity Icons, and the other shared Studio
libraries. Keep the dependencies your Studio imports directly. SanityKit can
use the compatible copies Studio already installs, including GROQ 6.24.0.
SanityKit supports `groq` versions `^5.1.0` and `^6.24.0`. If your Studio code
imports `groq` directly or your package manager cannot resolve a supported
copy, add `groq@6.24.0` to the install command. A compatible GROQ 5 dependency
works too.

SanityKit declares `@sanity/client` as a regular peer. Declare it directly if
your application imports it or you need to pin a specific version.

SanityKit and Studio need to resolve the same copies of the translation
libraries for the native redirect delete warning. If your pnpm lockfile
resolves separate copies, merge these versions into the existing
`overrides` in `pnpm-workspace.yaml` for Studio 6.24.0.

```yaml
overrides:
  i18next: 26.7.2
  react-i18next: 17.1.13
```

If your package manager isolates peer dependencies and reports a missing
package, add the compatible peer to the Studio package. The
[Studio dependency reference](pages.md#dependencies-and-package-isolation)
lists the supported ranges.

## 2. Register pages and add the URL field

Use one route registration for the Studio tool, the URL field, and checked
publishing. In this example `page` is the schema name, `pathname` is the URL
field, and `pathname.current` stores the full path, such as `/about/team`.
Use your existing schema and field names. The custom URL field uses a Sanity
slug object. If your existing paths are stored as strings, Pages can browse
them. Migrate the values to slug objects before switching to the URL field.

```ts
import { defineConfig, defineType, type SingleWorkspace } from 'sanity'
import { structureTool } from 'sanity/structure'
import {
	defineSanityUrlField,
	pagesTool,
	withUrlPublication,
} from '@standard-design/sanity-kit/studio'
import type { PagesRouteConfig } from '@standard-design/sanity-kit/url'

const routes: PagesRouteConfig = {
	pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
}

const page = defineType({
	name: 'page',
	type: 'document',
	fields: [
		{ name: 'title', type: 'string' },
		defineSanityUrlField({
			name: 'pathname',
			title: 'URL',
			routes,
			options: { source: 'title' },
		}),
	],
})

const workspace: SingleWorkspace = {
	projectId: 'your-project-id',
	dataset: 'production',
	schema: { types: [page] },
	plugins: [
		structureTool(),
		pagesTool({ ...routes, previewUrl: 'http://localhost:3000' }),
	],
}

export default defineConfig(withUrlPublication(workspace, { routes }))
```

Merge these additions into your existing `sanity.config.ts`. Use your website's
address for `previewUrl`. Pages installs Sanity's Presentation tool under the
name `pages`, so replace any Presentation tool with that same name. Apply
`withUrlPublication` after defining your tools and document actions so its
Publish checks run on the final workspace.

For draft access and click-to-edit overlays, connect your frontend to
[Sanity Visual Editing](https://www.sanity.io/docs/visual-editing/configuring-the-presentation-tool).
The kit also has a [React Router preview guide](visual-editing.md).

Start the website and Studio, then click **Pages** and open a document with a
URL. Confirm that the page opens in the preview and the document opens beside
it. With draft preview connected, save a test URL change and check that the
preview follows it.

The URL field and `withUrlPublication` also work in Structure on their own.
[URL field options](url-field.md) cover plain-text input, read-only fields, and
folder selection. [Pages configuration](pages.md) covers creation templates and
collections with fixed prefixes.

## 3. Add editable collection settings (optional)

Use settings when editors should be able to change a collection's name or its
item URL prefix. A post in this example stores `first-post` in `slug.current`.
The settings document supplies `/journal`, so the website can resolve
`/journal/first-post`. The Journal index is a separate page at `/journal` and
keeps its own URL when the item prefix changes.

Replace the basic `routes` declaration with the registration below.

```ts
import type { CollectionRoutingConfig } from '@standard-design/sanity-kit/url'
import { withCollectionRoutingSettings } from '@standard-design/sanity-kit/studio'

const journal = {
	name: 'journal',
	title: 'Journal',
	itemsTitle: 'Posts',
	index: { schemaType: 'page', pathname: '/journal' },
	routePrefix: '/journal',
	items: [{ schemaType: 'post', slugField: 'slug.current' }],
} satisfies NonNullable<PagesRouteConfig['collections']>[number]

const routes: PagesRouteConfig = {
	pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
	collections: [journal],
}

const collectionRouting: CollectionRoutingConfig = {
	...routes,
	collections: [
		{
			...journal,
			settingsDocumentId: 'journal-settings',
			displayName: { mode: 'default', value: journal.title },
			routePrefix: { mode: 'default', value: journal.routePrefix },
		},
	],
}
```

Add `collectionRouting` to the page URL field and to the `pagesTool` options.
Add your `post` schema to the workspace. Its URL field uses the same
`routes` and `collectionRouting`, with `name: 'slug'`. Apply the settings
wrapper outside `withUrlPublication`.

```ts
export default defineConfig(
	withCollectionRoutingSettings(
		withUrlPublication(workspace, { routes, collectionRouting }),
		{ routes: collectionRouting },
	),
)
```

Open **Settings** from the Journal collection menu in Pages and publish the
initial settings. `mode: 'default'` provides the starting value in Studio.
Use `mode: 'locked'` for a name or prefix that code should control.
The website needs published settings to serve public collection URLs and
draft settings to preview prefix changes. Share the registration with the
[website's collection settings loader](collection-routing-api.md#load-the-published-url-context).
See [collection settings](collection-settings-publication.md#installing-the-integration)
for placement in Structure and publishing behavior.

## 4. Add redirect management (optional)

Checked URL publishing can save a redirect when an editor changes a live URL.
Enable `redirectManagement: 'publish'` on `withUrlPublication` to also let
editors create, publish, and retire redirect rules in Studio.

```ts
withUrlPublication(workspace, { routes, redirectManagement: 'publish' })
```

If you set up collection settings, keep `collectionRouting` in those options
and keep the outer settings wrapper. Add `redirectManagementItem(S)` from
`@standard-design/sanity-kit/studio` to your Structure list. The example
below replaces a plain `structureTool()`.

```ts
structureTool({
	structure: (S) =>
		S.list()
			.title('Content')
			.items([
				...S.documentTypeListItems().filter(
					(item) => item.getId() !== 'sanityKitRedirect',
				),
				redirectManagementItem(S),
			]),
})
```

Redirects take effect on your website once its request handler looks up the
published rules. Connect either the [plain HTTP helper](redirects.md#handling-a-website-request)
or the [React Router middleware](redirects.md#react-router-request-integration).
Publish a test rule and request its old URL on the website to check the status
and destination. Preview requests bypass the site's redirect rules when the
app identifies them as authorized previews.
