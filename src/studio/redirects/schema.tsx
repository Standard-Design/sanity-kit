/**
 * Native redirect draft form. The stored shape is shared with the published
 * loader; a draft never becomes a live rule just because these fields change.
 * The workspace publication wrapper owns schema registration and action guards.
 * See docs/redirects.md for the distinction between draft editing and publishing.
 */
import { LinkIcon } from '@sanity/icons/Link'
import { Card, Stack, Text } from '@sanity/ui'
import { defineField, defineType, type ObjectInputProps } from 'sanity'
import type { StructureBuilder } from 'sanity/structure'
import { compileRedirectSnapshot } from '../../redirect/snapshot.js'
import { pagePathname } from '../../url/registry.js'
import { isReservedPath } from '../../url/reservations.js'

export const REDIRECT_SCHEMA_TYPE = 'sanityKitRedirect'
export const REDIRECT_MANUAL_TEMPLATE = 'sanityKitRedirect-manual'
export interface RedirectDraftSchemaOptions {
	readonly editableDrafts?: boolean
	readonly reservedPaths?: readonly string[]
	readonly reservedPathPrefixes?: readonly string[]
}

/** Immediate local feedback, not a claim about ownership or the complete graph. */
export function validateRedirectPath(
	value: unknown,
	field: 'source' | 'destination',
	options: RedirectDraftSchemaOptions = {},
): true | string {
	if (typeof value !== 'string' || !value)
		return `Enter the ${field === 'source' ? 'old' : 'destination'} URL path, beginning with /.`
	if (
		pagePathname(value) !== value ||
		(value !== '/' && (value.endsWith('/') || value.includes('//')))
	)
		return 'Use a path beginning with /, without an external address, query string, repeated slash, or trailing slash.'
	if (
		field === 'source' &&
		isReservedPath(value, options.reservedPaths, options.reservedPathPrefixes)
	)
		return 'This URL is reserved by the app. Choose a different old URL.'
	return true
}

export function RedirectDraftInput(props: ObjectInputProps) {
	const id: unknown = props.value?._id
	const release = typeof id === 'string' && id.startsWith('versions.')
	return (
		<Stack gap={4}>
			<Card padding={3} radius={2} tone="caution">
				<Stack gap={3}>
					<Text size={1} weight="semibold">
						{release ? 'Release redirects are read-only' : 'Draft editing only'}
					</Text>
					<Text size={1}>
						{release
							? 'Editing redirects in releases is not supported yet. Open the ordinary draft to prepare changes.'
							: 'You can prepare changes here. Publishing or retiring redirects is not available yet. Any published version stays active while you edit its draft.'}
					</Text>
				</Stack>
			</Card>
			{props.renderDefault(props)}
		</Stack>
	)
}

/** Default remains inspect-only. Draft mode must be paired with final action guards. */
export function createRedirectSchema(options: RedirectDraftSchemaOptions = {}) {
	const policy = {
		reservedPaths: [...(options.reservedPaths ?? [])],
		reservedPathPrefixes: [...(options.reservedPathPrefixes ?? [])],
	}
	compileRedirectSnapshot(
		{ perspective: 'published', complete: true, records: [] },
		{ ...policy, destinations: 'unverified' },
	)
	// Preserve the existing inspect-only schema until management is opted in.
	if (!options.editableDrafts)
		return defineType({
			name: REDIRECT_SCHEMA_TYPE,
			title: 'Redirect',
			type: 'document',
			readOnly: true,
			fields: [
				defineField({ name: 'source', title: 'From', type: 'string' }),
				defineField({ name: 'destination', title: 'To', type: 'string' }),
				defineField({ name: 'status', type: 'number' }),
				defineField({ name: 'enabled', type: 'boolean' }),
				defineField({ name: 'origin', type: 'string' }),
			],
			preview: { select: { title: 'source', subtitle: 'destination' } },
		})
	return defineType({
		name: REDIRECT_SCHEMA_TYPE,
		title: 'Redirect',
		type: 'document',
		icon: LinkIcon,
		readOnly: options.editableDrafts
			? ({ document }) => document?._id?.startsWith('versions.') === true
			: true,
		...(options.editableDrafts
			? { components: { input: RedirectDraftInput } }
			: {}),
		initialValue: { status: 301, enabled: true, origin: 'manual' },
		validation: (rule) =>
			rule.custom((value) =>
				value?.source && value.source === value.destination
					? {
							message:
								'Choose a different destination. A redirect cannot send visitors back to the same URL.',
							paths: [['destination']],
						}
					: true,
			),
		fields: [
			defineField({
				name: 'source',
				title: 'Old URL',
				type: 'string',
				description:
					'The old path visitors will request, such as /previous-name.',
				validation: (rule) =>
					rule
						.required()
						.custom((value) => validateRedirectPath(value, 'source', policy)),
			}),
			defineField({
				name: 'destination',
				title: 'Destination URL',
				type: 'string',
				description:
					'The current path on this website, such as /new-name. External addresses are not supported.',
				validation: (rule) =>
					rule
						.required()
						.custom((value) =>
							validateRedirectPath(value, 'destination', policy),
						),
			}),
			defineField({
				name: 'status',
				title: 'Redirect type',
				type: 'number',
				options: {
					list: [
						{ title: 'Permanent (301)', value: 301 },
						{ title: 'Temporary (302)', value: 302 },
					],
					layout: 'radio',
				},
				validation: (rule) =>
					rule
						.required()
						.custom((value) =>
							value === 301 || value === 302
								? true
								: 'Choose a permanent (301) or temporary (302) redirect.',
						),
			}),
			defineField({
				name: 'enabled',
				title: 'Enabled',
				type: 'boolean',
				description:
					'Turning this off prepares a retired redirect. The live rule changes only when the draft is published.',
				validation: (rule) => rule.required(),
			}),
			defineField({
				name: 'origin',
				title: 'Created by',
				type: 'string',
				readOnly: true,
				description:
					'Recorded when the redirect is created. Editing a generated redirect keeps its original provenance.',
			}),
		],
		orderings: [
			{
				title: 'Old URL',
				name: 'source',
				by: [{ field: 'source', direction: 'asc' }],
			},
			{
				title: 'Last edited',
				name: 'updatedAt',
				by: [{ field: '_updatedAt', direction: 'desc' }],
			},
		],
		preview: {
			select: {
				source: 'source',
				destination: 'destination',
				status: 'status',
				enabled: 'enabled',
				origin: 'origin',
			},
			prepare: ({ source, destination, status, enabled, origin }) => ({
				title: typeof source === 'string' && source ? source : 'New redirect',
				subtitle: [
					typeof destination === 'string' && destination
						? destination
						: 'No destination yet',
					status === 301
						? 'Permanent'
						: status === 302
							? 'Temporary'
							: 'Type not set',
					enabled === true
						? 'Enabled'
						: enabled === false
							? 'Disabled'
							: 'State not set',
					origin === 'manual'
						? 'Manual'
						: typeof origin === 'string' && origin
							? 'Generated'
							: 'Origin not recorded',
				].join(' · '),
			}),
		},
	})
}

/** Native searchable list and editor; Sanity owns IDs, permissions and creation UI. */
export function redirectManagementItem(S: StructureBuilder) {
	return S.documentTypeListItem(REDIRECT_SCHEMA_TYPE)
		.title('Redirects')
		.icon(LinkIcon)
		.child(S.documentTypeList(REDIRECT_SCHEMA_TYPE).title('Redirects'))
}
