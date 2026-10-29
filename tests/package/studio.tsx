/** Compiles and bundles from an installed tarball, never from source aliases. */
import { defineConfig, defineType, defineField } from 'sanity'
import {
	pagesTool,
	type PagesToolOptions,
} from '@standard-design/sanity-kit/studio'

const options = {
	name: 'pages',
	title: 'Pages',
	previewUrl: 'http://localhost:3000',
	pages: [{ schemaType: 'page', pathnameField: 'pathname.current' }],
	collections: [
		{
			name: 'journal',
			title: 'Journal',
			overview: { schemaType: 'page', pathname: '/journal' },
			routePrefix: '/journal',
			items: [{ schemaType: 'post', pathnameField: 'pathname.current' }],
		},
	],
	excludePaths: ['/'],
	create: { schemaType: 'page', templateId: 'page' },
} satisfies PagesToolOptions

export default defineConfig({
	projectId: 'testproject',
	dataset: 'test',
	schema: {
		types: ['page', 'post'].map((name) =>
			defineType({
				name,
				type: 'document',
				fields: [
					defineField({ name: 'title', type: 'string' }),
					defineField({ name: 'pathname', type: 'slug' }),
				],
			}),
		),
	},
	plugins: [pagesTool(options)],
})

// @ts-expect-error Pages owns the native component slots to preserve tool state.
const unsupported: PagesToolOptions = { ...options, components: {} }
void unsupported
