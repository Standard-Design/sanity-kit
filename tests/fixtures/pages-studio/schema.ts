import { DocumentIcon } from '@sanity/icons/Document'
import { defineField, defineType, type SchemaTypeDefinition } from 'sanity'
import { defineSanityUrlField } from '../../../src/studio/url/field.js'
import { proofRoutes } from './routes.js'

/** Fixture-owned types: no app schema is injected or changed by the future plugin. */
export const schemaTypes: SchemaTypeDefinition[] = [
	'kitProofPage',
	'kitProofPost',
	'kitProofLanding',
].map((name) =>
	defineType({
		name,
		title:
			name === 'kitProofPost'
				? 'Proof post'
				: name === 'kitProofLanding'
					? 'Proof alternate path'
					: 'Proof page',
		type: 'document',
		icon: DocumentIcon,
		fields: [
			defineField({
				name: 'title',
				type: 'string',
				validation: (rule) => rule.required(),
			}),
			name === 'kitProofLanding'
				? defineField({
						name: 'route',
						type: 'string',
						description:
							'Full path; proves that pathname.current is not required.',
					})
				: defineSanityUrlField({
						routes: proofRoutes,
						name: 'pathname',
						title: 'URL',
						options: { source: 'title' },
						description: 'Choose a folder and final segment.',
					}),
			defineField({ name: 'body', type: 'text' }),
			defineField({
				name: 'shared',
				type: 'reference',
				to: [{ type: 'kitProofShared' }],
			}),
		],
		preview: {
			select: {
				title: 'title',
				subtitle: name === 'kitProofLanding' ? 'route' : 'pathname.current',
			},
		},
	}),
)

schemaTypes.push(
	defineType({
		name: 'kitProofShared',
		title: 'Proof shared content',
		type: 'document',
		icon: DocumentIcon,
		fields: [
			defineField({ name: 'title', type: 'string' }),
			defineField({ name: 'body', type: 'text' }),
		],
	}),
)
