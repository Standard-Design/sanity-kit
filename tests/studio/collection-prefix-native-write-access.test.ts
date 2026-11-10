import { createClient } from '@sanity/client'
import { createSchema, type useClient } from 'sanity'
import { of, Observable, throwError } from 'rxjs'
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { createNativeCollectionPrefixWriteAccess } from '../../src/studio/collections/prefix-native-write-access.js'
import { prefixChangesAreProtected } from '../../src/studio/collections/prefix-write-schema.js'
import { configuration } from './collection-prefix-fixtures.js'
import type {
	CollectionPrefixWriteAccessRequest,
	CollectionPrefixWriteTarget,
} from '../../src/studio/collections/prefix-write.js'

type Options = Parameters<typeof createNativeCollectionPrefixWriteAccess>[0]
type Row = Record<string, unknown>
const receiptId =
	'sanityKit.collectionPrefixPublication.aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const settings = () => ({
	_id: 'journal-settings',
	_type: 'sanityKitCollectionRoute',
	_rev: 'settings-old',
	collection: 'journal',
	displayName: 'Journal',
	prefix: { _type: 'slug', current: '/journal' },
	details: { _type: 'details', note: 'Keep', secret: 'Locked' },
})
const settingsTarget = (): CollectionPrefixWriteTarget => ({
	key: 'settings:journal-settings',
	kind: 'publish-settings',
	published: settings(),
	draft: {
		...settings(),
		_id: 'drafts.journal-settings',
		_rev: 'settings-new',
		prefix: { _type: 'slug', current: '/blog' },
	},
})
const redirect = () => ({
	_id: 'alias',
	_type: 'sanityKitRedirect',
	_rev: 'alias-rev',
	source: '/older',
	destination: '/journal/first',
	status: 301,
	enabled: true,
	origin: 'page-url-change',
	note: 'Keep this extra field',
})
const aliasTarget: CollectionPrefixWriteTarget = {
	key: 'retarget:alias',
	kind: 'retarget-redirect',
	publishedId: 'alias',
	publishedRevision: 'alias-rev',
	draftId: 'drafts.alias',
	destination: '/blog/first',
}
const newRedirect: CollectionPrefixWriteTarget = {
	key: 'create:new-rule',
	kind: 'create-and-publish',
	publishedId: 'new-rule',
	draft: {
		_id: 'drafts.new-rule',
		_type: 'sanityKitRedirect',
		source: '/journal/first',
		destination: '/blog/first',
		status: 301,
		enabled: true,
		origin: 'url-change',
	},
}
const receipt: CollectionPrefixWriteTarget = {
	key: `create:${receiptId}`,
	kind: 'create-and-publish',
	publishedId: receiptId,
	draft: {
		_id: `drafts.${receiptId}`,
		_type: 'sanityKitCollectionPrefixPublication',
		operationId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
		oldPrefix: '/journal',
		newPrefix: '/blog',
		createRedirects: true,
		evidence: '{}',
	},
}

function setup(
	options: {
		documentReadOnly?: unknown
		prefixReadOnly?: unknown
		nestedReadOnly?: unknown
		validate?: (value: unknown) => unknown
	} = {},
) {
	const client = createClient({
		projectId: 'testproject',
		dataset: 'development',
		apiVersion: '2026-10-01',
		useCdn: false,
	})
	vi.spyOn(client, 'withConfig').mockReturnValue(client)
	const rows = [redirect()]
	const request = vi
		.spyOn(client, 'request')
		.mockImplementation((request) =>
			Promise.resolve(
				request.url?.endsWith('/acl')
					? [{ filter: 'true', permissions: ['read'] }]
					: { documents: rows },
			),
		)
	const schema = createSchema({
		name: 'test',
		types: [
			{
				name: 'sanityKitCollectionRoute',
				type: 'document',
				readOnly: options.documentReadOnly,
				fields: [
					{ name: 'collection', type: 'string', readOnly: true },
					{
						name: 'displayName',
						type: 'string',
						validation: (rule: {
							custom: (fn: (value: unknown) => unknown) => unknown
						}) => rule.custom(options.validate ?? (() => true)),
					},
					{
						name: 'prefix',
						type: 'slug',
						readOnly: options.prefixReadOnly,
						options: { isUnique: () => true },
					},
					{
						name: 'details',
						type: 'object',
						fields: [
							{ name: 'note', type: 'string' },
							{
								name: 'secret',
								type: 'string',
								readOnly: options.nestedReadOnly ?? true,
							},
						],
					},
				],
			},
			{
				name: 'sanityKitRedirect',
				type: 'document',
				fields: [
					{ name: 'source', type: 'string' },
					{
						name: 'destination',
						type: 'string',
						validation: (rule: {
							custom: (fn: (value: unknown) => unknown) => unknown
						}) =>
							rule.custom((value) =>
								typeof value === 'string' && value.startsWith('/')
									? true
									: 'Use an absolute path',
							),
					},
					{ name: 'status', type: 'number' },
					{ name: 'enabled', type: 'boolean' },
					{ name: 'origin', type: 'string', readOnly: true },
					{ name: 'note', type: 'string' },
				],
			},
		],
	})
	const grant = vi.fn<Options['grantsStore']['checkDocumentPermission']>(() =>
		of({ granted: true, reason: 'Matching grant' }),
	)
	const workspace: Options['workspace'] = {
		schema,
		// Studio currently brings a different compatible @sanity/client version.
		getClient: () =>
			client as unknown as ReturnType<Options['workspace']['getClient']>,
		i18n: {
			currentLocale: { id: 'en-US' },
			loadNamespaces: () => Promise.resolve(),
			t: ((key: string) => key) as Options['workspace']['i18n']['t'],
		},
	}
	const config: Options = {
		client,
		workspace,
		currentUser: {
			id: 'editor',
			name: 'Editor',
			roles: [],
		} as unknown as Options['currentUser'],
		grantsStore: { checkDocumentPermission: grant },
	}
	const authorize = createNativeCollectionPrefixWriteAccess(config)
	const input = (
		targets: readonly CollectionPrefixWriteTarget[] = [
			settingsTarget(),
			aliasTarget,
			newRedirect,
			receipt,
		],
	): CollectionPrefixWriteAccessRequest => ({
		projectId: 'testproject',
		dataset: 'development',
		receiptReadId: receiptId,
		targets,
	})
	return { config, client, schema, rows, request, grant, authorize, input }
}

afterEach(() => {
	vi.useRealTimers()
	vi.restoreAllMocks()
})

describe('collection-prefix native write authorization', () => {
	it('allows first settings Publish to retain seeded read-only fields and checks the actual published copy', async () => {
		const t = setup({ prefixReadOnly: true })
		const draft = {
			...settings(),
			_id: 'drafts.journal-settings',
			_createdAt: 'created',
			_updatedAt: 'updated',
		}
		const target: CollectionPrefixWriteTarget = {
			key: 'first',
			kind: 'publish-initial-settings',
			publishedId: 'journal-settings',
			draft,
			configuration,
		}
		const result = await t.authorize(t.input([target]))
		expect(result.targets).toEqual([{ key: 'first', status: 'granted' }])
		expect(t.grant.mock.calls.map(([operation]) => operation)).toEqual([
			'update',
			'create',
		])
		expect(t.grant.mock.calls[1]?.[1]).toEqual({
			...settings(),
			_id: 'journal-settings',
			_createdAt: 'created',
			_rev: undefined,
		})
	})
	it('still enforces root read-only and schema validation for the initial settings draft', async () => {
		const target: CollectionPrefixWriteTarget = {
			key: 'first',
			kind: 'publish-initial-settings',
			publishedId: 'journal-settings',
			draft: { ...settings(), _id: 'drafts.journal-settings' },
			configuration,
		}
		for (const t of [
			setup({ documentReadOnly: true }),
			setup({ validate: () => 'Fix the name' }),
		]) {
			expect((await t.authorize(t.input([target]))).targets[0]?.status).toBe(
				'protected',
			)
			expect(t.grant).not.toHaveBeenCalled()
		}
	})
	it.each(['collection', 'documentId', 'revision'] as const)(
		'rejects invalid first settings %s evidence',
		async (field) => {
			const t = setup()
			const draft: Row = { ...settings(), _id: 'drafts.journal-settings' }
			if (field === 'collection') draft.collection = 'wrong'
			if (field === 'documentId') draft._id = 'drafts.wrong'
			if (field === 'revision') delete draft._rev
			const target: CollectionPrefixWriteTarget = {
				key: 'first',
				kind: 'publish-initial-settings',
				publishedId: 'journal-settings',
				draft,
				configuration,
			}
			expect((await t.authorize(t.input([target]))).targets[0]?.status).toBe(
				'unverified',
			)
			expect(t.grant).not.toHaveBeenCalled()
		},
	)
	it.each(['displayName', 'prefix'] as const)(
		'does not publish a conflicting code-locked %s on initial settings',
		async (field) => {
			const t = setup()
			const config = {
				...configuration,
				collections: configuration.collections!.map((entry) => ({
					...entry,
					displayName: { mode: 'locked' as const, value: 'Locked name' },
					routePrefix: { mode: 'locked' as const, value: '/locked' },
				})),
			}
			const draft = {
				...settings(),
				_id: 'drafts.journal-settings',
				displayName: field === 'displayName' ? 'Wrong' : 'Locked name',
				prefix: {
					_type: 'slug',
					current: field === 'prefix' ? '/wrong' : '/locked',
				},
			}
			const target: CollectionPrefixWriteTarget = {
				key: 'first',
				kind: 'publish-initial-settings',
				publishedId: 'journal-settings',
				draft,
				configuration: config,
			}
			expect((await t.authorize(t.input([target]))).targets[0]?.status).toBe(
				'protected',
			)
		},
	)
	it('reports missing initial settings creation permission without relying on role names', async () => {
		const t = setup()
		t.grant.mockImplementation((operation) =>
			of({ granted: operation !== 'create', reason: 'Custom grant' }),
		)
		const target: CollectionPrefixWriteTarget = {
			key: 'first',
			kind: 'publish-initial-settings',
			publishedId: 'journal-settings',
			draft: { ...settings(), _id: 'drafts.journal-settings' },
			configuration,
		}
		expect((await t.authorize(t.input([target]))).targets[0]?.status).toBe(
			'missing',
		)
	})
	it('checks only the created published receipt identity for the initial strict-create transaction', async () => {
		const t = setup()
		const id =
			'sanityKit.collectionSettingsPublication.aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
		const row = {
			_id: id,
			_type: 'sanityKitCollectionSettingsPublication',
			operationId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
			documentId: 'journal-settings',
			collection: 'journal',
			draftRevision: 'initial-rev',
			publishedRevision: null,
			prefix: '/journal',
			activatesUrls: true,
			evidence: '{}',
		}
		t.request.mockImplementation(() =>
			Promise.resolve([{ filter: `_id == "${id}"`, permissions: ['read'] }]),
		)
		const result = await t.authorize({
			...t.input([
				{ key: 'receipt', kind: 'create-settings-receipt', published: row },
			]),
			receiptReadId: id,
		})
		expect(result).toEqual({
			receiptRead: 'granted',
			targets: [{ key: 'receipt', status: 'granted' }],
		})
		expect(t.grant.mock.calls).toEqual([['create', row]])
	})
	it('authorizes metadata-only settings receipts using the ordinary create/publish grant sequence', async () => {
		const t = setup()
		const id =
			'sanityKit.collectionSettingsPublication.aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
		const draft = {
			_id: `drafts.${id}`,
			_type: 'sanityKitCollectionSettingsPublication',
			operationId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
			documentId: 'journal-settings',
			collection: 'journal',
			draftRevision: 'draft-rev',
			publishedRevision: 'live-rev',
			prefix: '/journal',
			activatesUrls: false,
			evidence: '{}',
		}
		expect(
			await t.authorize({
				...t.input([
					{
						key: 'receipt',
						kind: 'create-and-publish',
						publishedId: id,
						draft,
					},
				]),
				receiptReadId: id,
			}),
		).toEqual({
			receiptRead: 'granted',
			targets: [{ key: 'receipt', status: 'granted' }],
		})
		expect(t.grant.mock.calls.map(([operation]) => operation)).toEqual([
			'create',
			'update',
			'create',
		])
	})
	it.each(['extra-field', 'wrong-identity', 'invalid-prefix'] as const)(
		'refuses a malformed internal settings receipt: %s',
		async (issue) => {
			const t = setup()
			const id =
				'sanityKit.collectionSettingsPublication.aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
			const row: Row = {
				_id: id,
				_type: 'sanityKitCollectionSettingsPublication',
				operationId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
				documentId: 'journal-settings',
				collection: 'journal',
				draftRevision: 'draft',
				publishedRevision: null,
				prefix: '/journal',
				activatesUrls: true,
				evidence: '{}',
			}
			if (issue === 'extra-field') row.extra = 'not allowed'
			if (issue === 'wrong-identity') row._id = 'another-id'
			if (issue === 'invalid-prefix') row.prefix = '/journal/'
			const result = await t.authorize({
				...t.input([
					{ key: 'receipt', kind: 'create-settings-receipt', published: row },
				]),
				receiptReadId: id,
			})
			expect(result.targets[0]?.status).toBe('unverified')
			expect(t.grant).not.toHaveBeenCalled()
		},
	)
	it('accepts Studio clients and authorizes actual create/update permissions without role names', async () => {
		expectTypeOf<ReturnType<typeof useClient>>().toMatchTypeOf<
			Options['client']
		>()
		const t = setup()
		expect(await t.authorize(t.input())).toEqual({
			receiptRead: 'granted',
			targets: t.input().targets.map(({ key }) => ({ key, status: 'granted' })),
		})
		expect(
			t.grant.mock.calls.map(([operation, document]) => [
				operation,
				document?._id,
			]),
		).toEqual([
			['update', 'journal-settings'],
			['update', 'drafts.journal-settings'],
			['create', 'journal-settings'],
			['create', 'drafts.alias'],
			['update', 'alias'],
			['update', 'drafts.alias'],
			['update', 'drafts.alias'],
			['create', 'alias'],
			['create', 'drafts.new-rule'],
			['update', 'drafts.new-rule'],
			['create', 'new-rule'],
			['create', `drafts.${receiptId}`],
			['update', `drafts.${receiptId}`],
			['create', receiptId],
		])
	})
	it('loads the complete redirect at its reviewed revision and keeps extra fields in permission checks', async () => {
		const t = setup()
		expect((await t.authorize(t.input([aliasTarget]))).targets[0]?.status).toBe(
			'granted',
		)
		expect(t.request).toHaveBeenCalledWith(
			expect.objectContaining({
				url: '/data/doc/development/alias,drafts.alias',
				maxRetries: 0,
				fetch: { cache: 'no-store', next: undefined },
			}),
		)
		const final = t.grant.mock.calls.at(-1)?.[1]
		expect(final).toMatchObject({
			_id: 'alias',
			destination: '/blog/first',
			note: 'Keep this extra field',
		})
		expect(final).not.toHaveProperty('_rev')
	})
	it('preserves native published-permission context metadata for the settings draft', async () => {
		const t = setup()
		const target = settingsTarget()
		if (target.kind !== 'publish-settings') throw new Error('Bad fixture')
		await t.authorize(t.input([target]))
		expect(t.grant.mock.calls.at(-1)).toEqual([
			'create',
			{ ...target.draft, _id: 'journal-settings' },
		])
	})
	it.each(['stale', 'draft', 'missing'] as const)(
		'refuses %s redirect evidence',
		async (mode) => {
			const t = setup()
			if (mode === 'stale') t.rows[0]!._rev = 'new-revision'
			if (mode === 'draft') t.rows.push({ ...redirect(), _id: 'drafts.alias' })
			if (mode === 'missing') t.rows.splice(0)
			expect(
				(await t.authorize(t.input([aliasTarget]))).targets[0]?.status,
			).toBe('unverified')
			expect(t.grant).not.toHaveBeenCalled()
		},
	)
	it.each(['before', 'after'] as const)(
		'honors document locks evaluated against the %s settings context',
		async (context) => {
			const t = setup({
				documentReadOnly: ({ document }: { document: Row }) =>
					(document.prefix as Row)?.current ===
					(context === 'before' ? '/journal' : '/blog'),
			})
			expect(
				(await t.authorize(t.input([settingsTarget()]))).targets[0]?.status,
			).toBe('protected')
		},
	)
	it('allows unchanged read-only identifiers and checks removed nested fields', async () => {
		const t = setup()
		expect(
			(await t.authorize(t.input([settingsTarget()]))).targets[0]?.status,
		).toBe('granted')
		const change = settingsTarget()
		if (change.kind !== 'publish-settings') throw new Error('Bad fixture')
		const deleted = {
			...change,
			draft: { ...change.draft, details: { _type: 'details', note: 'Keep' } },
		}
		expect((await t.authorize(t.input([deleted]))).targets[0]?.status).toBe(
			'protected',
		)
	})
	it('checks conditional nested rules using the full document, parent, value, and path', async () => {
		const rule = vi.fn(({ value }: { value: unknown }) => value === 'Locked')
		const t = setup({ nestedReadOnly: rule })
		const change = settingsTarget()
		if (change.kind !== 'publish-settings') throw new Error('Bad fixture')
		const updated = {
			...change,
			draft: {
				...change.draft,
				details: { _type: 'details', note: 'Keep', secret: 'Changed' },
			},
		}
		expect((await t.authorize(t.input([updated]))).targets[0]?.status).toBe(
			'protected',
		)
		expect(rule).toHaveBeenCalledWith(
			expect.objectContaining({
				document: change.published,
				parent: change.published.details,
				value: 'Locked',
				path: ['details', 'secret'],
				currentUser: t.config.currentUser,
			}),
		)
	})
	it.each([true, () => true])(
		'honors static and conditional prefix readOnly',
		async (prefixReadOnly) => {
			const t = setup({ prefixReadOnly })
			expect(
				(await t.authorize(t.input([settingsTarget()]))).targets[0]?.status,
			).toBe('protected')
		},
	)
	it('does not interpret async or throwing readOnly callbacks as permission', async () => {
		for (const prefixReadOnly of [
			() => Promise.resolve(false),
			() => {
				throw new Error('Failed')
			},
		]) {
			const t = setup({ prefixReadOnly })
			expect(
				(await t.authorize(t.input([settingsTarget()]))).targets[0]?.status,
			).toBe('unverified')
		}
	})
	it('uses native custom validators on the full settings draft', async () => {
		const validate = vi.fn(() => 'Choose a valid display name')
		const t = setup({ validate })
		expect(
			(await t.authorize(t.input([settingsTarget()]))).targets[0]?.status,
		).toBe('protected')
		expect(validate).toHaveBeenCalledWith(
			'Journal',
			expect.objectContaining({
				document: expect.objectContaining({
					_id: 'drafts.journal-settings',
				}) as unknown,
			}),
		)
		expect(t.grant).not.toHaveBeenCalled()
	})
	it('validates generated redirects while allowing initialization of immutable origin', async () => {
		const t = setup()
		expect((await t.authorize(t.input([newRedirect]))).targets[0]?.status).toBe(
			'granted',
		)
		if (newRedirect.kind !== 'create-and-publish')
			throw new Error('Bad fixture')
		expect(
			(
				await t.authorize(
					t.input([
						{
							...newRedirect,
							draft: { ...newRedirect.draft, destination: 'invalid' },
						},
					]),
				)
			).targets[0]?.status,
		).toBe('protected')
	})
	it.each(['create-draft', 'edit-draft', 'publish', 'remove-draft'] as const)(
		'blocks missing %s permission',
		async (caseName) => {
			const t = setup()
			t.grant.mockImplementation((operation, doc) =>
				of({
					reason: 'Scoped grant',
					granted: !(
						(caseName === 'create-draft' &&
							operation === 'create' &&
							doc?._id === 'drafts.alias') ||
						(caseName === 'edit-draft' &&
							operation === 'update' &&
							doc?._id === 'drafts.alias' &&
							doc.destination === '/journal/first') ||
						(caseName === 'publish' &&
							operation === 'create' &&
							doc?._id === 'alias') ||
						(caseName === 'remove-draft' &&
							operation === 'update' &&
							doc?._id === 'drafts.alias' &&
							doc.destination === '/blog/first')
					),
				}),
			)
			expect(
				(await t.authorize(t.input([aliasTarget]))).targets[0]?.status,
			).toBe('missing')
		},
	)
	it('does not authorize when the exact receipt read scope is missing', async () => {
		const t = setup()
		t.request.mockResolvedValue([
			{ filter: '_type == "sanityKitRedirect"', permissions: ['read'] },
		])
		const answer = await t.authorize(t.input())
		expect(answer.receiptRead).not.toBe('granted')
		expect(answer.targets.every(({ status }) => status === 'unverified')).toBe(
			true,
		)
		expect(t.grant).not.toHaveBeenCalled()
	})
	it('limits the schema-free receipt exception to the exact internal record shape', async () => {
		const t = setup()
		if (receipt.kind !== 'create-and-publish') throw new Error('Bad fixture')
		for (const draft of [
			{ ...receipt.draft, extra: true },
			{ ...receipt.draft, operationId: 'different' },
			{ ...receipt.draft, newPrefix: '/journal' },
		]) {
			expect(
				(await t.authorize(t.input([{ ...receipt, draft }]))).targets[0]
					?.status,
			).toBe('unverified')
		}
	})
	it('requires matching client scope, a user, and unique target keys', async () => {
		const t = setup()
		for (const input of [
			{ ...t.input(), dataset: 'other' },
			{ ...t.input(), projectId: 'other' },
			t.input([aliasTarget, aliasTarget]),
		])
			expect(
				(await t.authorize(input)).targets.every(
					({ status }) => status === 'unverified',
				),
			).toBe(true)
		const anonymous = createNativeCollectionPrefixWriteAccess({
			...t.config,
			currentUser: null,
		})
		expect(
			(await anonymous(t.input())).targets.every(
				({ status }) => status === 'unverified',
			),
		).toBe(true)
		expect(t.request).not.toHaveBeenCalled()
	})
	it('cancels hanging native permission streams and does not keep review waiting forever', async () => {
		vi.useFakeTimers()
		const t = setup()
		const teardown = vi.fn()
		t.grant.mockReturnValue(new Observable(() => teardown))
		const result = t.authorize(t.input([receipt]))
		await vi.advanceTimersByTimeAsync(10_000)
		expect((await result).targets[0]?.status).toBe('unverified')
		expect(t.grant).toHaveBeenCalledOnce()
		expect(teardown).toHaveBeenCalledOnce()
	})
	it.each(['projectId', 'dataset'] as const)(
		'refuses a workspace validation client with a different %s',
		async (scopeKey) => {
			const t = setup()
			const wrongClient = createClient({
				projectId: 'testproject',
				dataset: 'development',
				apiVersion: '2026-10-01',
				useCdn: false,
				[scopeKey]: 'other',
			})
			vi.spyOn(t.config.workspace, 'getClient').mockReturnValue(
				wrongClient as unknown as ReturnType<Options['workspace']['getClient']>,
			)
			expect(
				(await t.authorize(t.input([settingsTarget()]))).targets[0]?.status,
			).toBe('unverified')
			expect(t.grant).not.toHaveBeenCalled()
		},
	)
	it('handles failed permission streams and cancellation without granting access', async () => {
		const t = setup()
		t.grant.mockReturnValue(throwError(() => new Error('Disconnected')))
		expect((await t.authorize(t.input([receipt]))).targets[0]?.status).toBe(
			'unverified',
		)
		const controller = new AbortController()
		controller.abort()
		expect(
			(
				await t.authorize({ ...t.input(), signal: controller.signal })
			).targets.every(({ status }) => status === 'unverified'),
		).toBe(true)
	})
	it('bounds a custom validator that never completes', async () => {
		vi.useFakeTimers()
		const t = setup({ validate: () => new Promise(() => undefined) })
		const answer = t.authorize(t.input([settingsTarget()]))
		await vi.advanceTimersByTimeAsync(10_000)
		expect((await answer).targets[0]?.status).toBe('unverified')
	})
	it('does not authorize validation exceptions as ordinary validation success', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined)
		const t = setup({
			validate: () => {
				throw new Error('Validation service unavailable')
			},
		})
		expect(
			(await t.authorize(t.input([settingsTarget()]))).targets[0]?.status,
		).toBe('unverified')
	})
})

describe('settings changed-field protection', () => {
	function protection(readOnly = false) {
		const t = setup()
		const schema = createSchema({
			name: 'extended-settings',
			types: [
				{
					name: 'settings',
					type: 'document',
					fields: [
						{
							name: 'reference',
							type: 'reference',
							to: [{ type: 'settings' }],
							readOnly,
						},
						{
							name: 'items',
							type: 'array',
							of: [
								{
									name: 'entry',
									type: 'object',
									readOnly,
									fields: [{ name: 'text', type: 'string' }],
								},
							],
						},
					],
				},
			],
		})
		const before = {
			_id: 'settings',
			_type: 'settings',
			reference: { _type: 'reference', _ref: 'old' },
			items: [
				{ _key: 'one', _type: 'entry', text: 'One' },
				{ _key: 'two', _type: 'entry', text: 'Two' },
			],
		}
		return {
			before,
			check: (after: Row) =>
				prefixChangesAreProtected({
					schema,
					currentUser: t.config.currentUser,
					before,
					after,
				}),
		}
	}
	it('supports native reference controls and honors their readOnly setting', () => {
		for (const readOnly of [false, true]) {
			const t = protection(readOnly)
			expect(
				t.check({
					...t.before,
					reference: { _type: 'reference', _ref: 'new' },
				}),
			).toBe(readOnly)
		}
	})
	it('allows ordinary keyed reorder but respects readOnly members when moved', () => {
		for (const readOnly of [false, true]) {
			const t = protection(readOnly)
			expect(
				t.check({ ...t.before, items: [...t.before.items].reverse() }),
			).toBe(readOnly)
		}
	})
	it('does not let missing schema for changed fields silently pass', () => {
		const t = protection()
		expect(() => t.check({ ...t.before, unsupported: 'new value' })).toThrow(
			'Unknown changed field schema',
		)
	})
	it('uses the native null parent for document-level readOnly callbacks', async () => {
		const rule = vi.fn(({ parent }: { parent: unknown }) => parent !== null)
		const t = setup({ documentReadOnly: rule })
		expect(
			(await t.authorize(t.input([settingsTarget()]))).targets[0]?.status,
		).toBe('granted')
		expect(rule).toHaveBeenCalledWith(
			expect.objectContaining({ parent: null, path: [] }),
		)
	})
})
