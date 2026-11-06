import { createClient } from '@sanity/client'
import { createSchema, type useClient } from 'sanity'
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { createFolderRenameAuthorizer } from '../../src/studio/folders/rename-access.js'
import type { FolderRenameWriteTarget } from '../../src/studio/folders/rename-write.js'

type Options = Parameters<typeof createFolderRenameAuthorizer>[0]
type ResultStream = ReturnType<
	Options['grantsStore']['checkDocumentPermission']
>
const user = {
	id: 'editor',
	name: 'Editor',
	roles: [],
} as unknown as Options['currentUser']
const original = () => ({
	_id: 'page',
	_type: 'page',
	_rev: 'rev1',
	title: 'Full document',
	protected: false,
	pathname: { _type: 'slug', current: '/about/team' },
})
const update: FolderRenameWriteTarget = {
	id: 'page',
	schemaType: 'page',
	operation: 'update',
	revision: 'rev1',
	fields: ['pathname.current'],
}
function setup(
	options: {
		documentRule?: unknown
		fieldRule?: unknown
		leafRule?: unknown
	} = {},
) {
	const data = original()
	const schema = createSchema({
		name: 'access',
		types: [
			{
				name: 'page',
				type: 'document',
				readOnly: options.documentRule,
				fields: [
					{
						name: 'pathname',
						type: 'object',
						readOnly: options.fieldRule,
						fields: [
							{ name: 'current', type: 'string', readOnly: options.leafRule },
						],
					},
				],
			},
			{
				name: 'sanityKitRedirect',
				type: 'document',
				fields: [
					{ name: 'source', type: 'string' },
					{ name: 'destination', type: 'string' },
					{ name: 'enabled', type: 'boolean' },
					{ name: 'status', type: 'number' },
					{ name: 'origin', type: 'string', readOnly: true },
				],
			},
		],
	})
	const request = vi.fn((): Promise<unknown> =>
		Promise.resolve({ documents: [data] }),
	)
	const source = { config: () => ({ dataset: 'test' }), request }
	const unsubscribe = vi.fn()
	const grant = vi.fn<(permission: string, document: unknown) => ResultStream>(
		() =>
			({
				subscribe(observer: {
					next: (result: { granted: boolean; reason: string }) => void
				}) {
					observer.next({ granted: true, reason: 'Matching grant' })
					return { unsubscribe }
				},
			}) as unknown as ResultStream,
	)
	const optionsForAdapter = {
		client: { withConfig: vi.fn(() => source) },
		schema,
		currentUser: user,
		grantsStore: { checkDocumentPermission: grant },
	}
	return {
		data,
		schema,
		request,
		source,
		unsubscribe,
		grant,
		options: optionsForAdapter,
		authorize: createFolderRenameAuthorizer(optionsForAdapter),
	}
}

afterEach(() => vi.useRealTimers())

describe('folder rename Studio authorization', () => {
	it('accepts the public Studio and Sanity clients', () => {
		expectTypeOf<ReturnType<typeof useClient>>().toMatchTypeOf<
			Options['client']
		>()
		expectTypeOf<ReturnType<typeof createClient>>().toMatchTypeOf<
			Options['client']
		>()
	})
	it('loads full reviewed documents and asks native grants about the exact lower-level mutation', async () => {
		const io = setup()
		expect(await io.authorize({ targets: [update] })).toEqual({ ok: true })
		expect(io.request).toHaveBeenCalledWith(
			expect.objectContaining({
				url: '/data/doc/test/page',
				maxRetries: 0,
				fetch: { cache: 'no-store', next: undefined },
			}),
		)
		expect(io.grant).toHaveBeenCalledWith('update', io.data)
		expect(io.unsubscribe).toHaveBeenCalledOnce()
	})
	it.each(['documentRule', 'fieldRule', 'leafRule'] as const)(
		'respects %s readOnly',
		async (place) => {
			const io = setup({ [place]: true })
			expect(await io.authorize({ targets: [update] })).toMatchObject({
				ok: false,
				reason: 'protected',
				documentId: 'page',
			})
			expect(io.grant).not.toHaveBeenCalled()
		},
	)
	it('evaluates conditional rules with full document, parent, value, path and current user', async () => {
		const rule = vi.fn(
			({
				document,
				parent,
				value,
				path,
				currentUser,
			}: {
				document: ReturnType<typeof original>
				parent: unknown
				value: { current: string }
				path: unknown
				currentUser: unknown
			}) => {
				expect(document.title).toBe('Full document')
				expect(parent).toBe(document)
				expect(value.current).toBe('/about/team')
				expect(path).toEqual(['pathname'])
				expect(currentUser).toBe(user)
				return document.protected
			},
		)
		const io = setup({ fieldRule: rule })
		expect(await io.authorize({ targets: [update] })).toEqual({ ok: true })
		io.data.protected = true
		expect(await io.authorize({ targets: [update] })).toMatchObject({
			reason: 'protected',
		})
		expect(rule).toHaveBeenCalledTimes(2)
	})
	it.each([
		() => Promise.resolve(false),
		() => {
			throw new Error('cannot evaluate')
		},
		() => 'false',
	])(
		'does not turn an unsupported conditional rule into write access',
		async (rule) => {
			const io = setup({ fieldRule: rule })
			expect(await io.authorize({ targets: [update] })).toMatchObject({
				ok: false,
				reason: 'unverified',
			})
			expect(io.grant).not.toHaveBeenCalled()
		},
	)
	it.each(['missing', 'revision', 'type', 'extra'] as const)(
		'refuses %s document evidence',
		async (mode) => {
			const io = setup()
			if (mode === 'missing') io.request.mockResolvedValue({ documents: [] })
			if (mode === 'revision') io.data._rev = 'new-rev'
			if (mode === 'type') io.data._type = 'other'
			if (mode === 'extra')
				io.request.mockResolvedValue({
					documents: [io.data, { _id: 'unrequested' }],
				})
			expect(await io.authorize({ targets: [update] })).toMatchObject({
				reason: 'unverified',
			})
			expect(io.grant).not.toHaveBeenCalled()
		},
	)
	it('reports denied and unavailable native grants separately', async () => {
		const io = setup()
		io.grant.mockReturnValue({
			subscribe: (observer: { next: (value: unknown) => void }) => {
				observer.next({ granted: false, reason: 'No matching grant' })
				return { unsubscribe: io.unsubscribe }
			},
		} as unknown as ResultStream)
		expect(await io.authorize({ targets: [update] })).toMatchObject({
			reason: 'missing',
			documentId: 'page',
		})
		io.grant.mockImplementation(() => {
			throw new Error('offline')
		})
		expect(await io.authorize({ targets: [update] })).toMatchObject({
			reason: 'unverified',
			documentId: 'page',
		})
	})
	it('cancels a pending grants check and unsubscribes', async () => {
		const io = setup()
		let subscribed!: () => void
		const waiting = new Promise<void>((resolve) => {
			subscribed = resolve
		})
		io.grant.mockReturnValue({
			subscribe: () => {
				subscribed()
				return { unsubscribe: io.unsubscribe }
			},
		} as unknown as ResultStream)
		const abort = new AbortController()
		const result = io.authorize({ targets: [update], signal: abort.signal })
		await waiting
		abort.abort()
		expect(await result).toMatchObject({ reason: 'unverified' })
		expect(io.unsubscribe).toHaveBeenCalledOnce()
	})
	it('bounds a grants subscription that never responds', async () => {
		vi.useFakeTimers()
		const io = setup()
		io.grant.mockReturnValue({
			subscribe: () => ({ unsubscribe: io.unsubscribe }),
		} as unknown as ResultStream)
		const result = io.authorize({ targets: [update] })
		await vi.advanceTimersByTimeAsync(10_000)
		expect(await result).toMatchObject({ reason: 'unverified' })
		expect(io.unsubscribe).toHaveBeenCalledOnce()
	})
	it('allows known internal registry/receipt operations but still checks their grants', async () => {
		const io = setup()
		io.request.mockResolvedValue({
			documents: [
				{
					_id: 'sanityKit.folders',
					_type: 'sanityKitFolderRegistry',
					_rev: 'r',
					schemaVersion: 1,
					folders: [{ _key: 'a', pathname: '/about' }],
				},
			],
		})
		const operationId = '12345678-1234-1234-1234-123456789012'
		const attributes = {
			_id: `sanityKit.folderRename.${operationId}`,
			_type: 'sanityKitFolderRename',
			operationId,
			oldPathname: '/about',
			newPathname: '/company',
			createRedirects: true,
			evidence: '{}',
		}
		const targets: FolderRenameWriteTarget[] = [
			{
				id: 'sanityKit.folders',
				schemaType: 'sanityKitFolderRegistry',
				revision: 'r',
				operation: 'update',
				fields: ['folders[_key=="a"].pathname'],
			},
			{
				id: attributes._id,
				schemaType: attributes._type,
				operation: 'create',
				fields: Object.keys(attributes),
				attributes,
			},
		]
		expect(await io.authorize({ targets })).toEqual({ ok: true })
		expect(io.grant.mock.calls.map(([operation]) => operation)).toEqual([
			'update',
			'create',
		])
		expect(
			await io.authorize({
				targets: [{ ...targets[0]!, fields: ['schemaVersion'] }],
			}),
		).toMatchObject({ reason: 'unverified' })
	})
	it('honors an explicitly registered readOnly schema for internal records', async () => {
		const io = setup()
		const schema = createSchema({
			name: 'protected-internal',
			types: [
				{
					name: 'sanityKitFolderRegistry',
					type: 'document',
					readOnly: true,
					fields: [
						{
							name: 'folders',
							type: 'array',
							of: [
								{
									type: 'object',
									fields: [{ name: 'pathname', type: 'string' }],
								},
							],
						},
					],
				},
			],
		})
		io.request.mockResolvedValue({
			documents: [
				{
					_id: 'sanityKit.folders',
					_type: 'sanityKitFolderRegistry',
					_rev: 'r',
				},
			],
		})
		const authorize = createFolderRenameAuthorizer({ ...io.options, schema })
		expect(
			await authorize({
				targets: [
					{
						id: 'sanityKit.folders',
						schemaType: 'sanityKitFolderRegistry',
						revision: 'r',
						operation: 'update',
						fields: ['folders[_key=="a"].pathname'],
					},
				],
			}),
		).toMatchObject({ reason: 'protected' })
	})
	it('checks generated redirect create permission while allowing immutable origin initialization', async () => {
		const io = setup()
		const attributes = {
			_id: 'opaque',
			_type: 'sanityKitRedirect',
			source: '/about',
			destination: '/company',
			status: 301,
			enabled: true,
			origin: 'generated',
		}
		expect(
			await io.authorize({
				targets: [
					{
						id: attributes._id,
						schemaType: attributes._type,
						operation: 'create',
						fields: Object.keys(attributes),
						attributes,
					},
				],
			}),
		).toEqual({ ok: true })
		expect(io.grant).toHaveBeenCalledWith('create', attributes)
		expect(io.request).not.toHaveBeenCalled()
	})
	it('requires an actual schema for content and never skips arbitrary unknown types', async () => {
		const io = setup()
		io.data._type = 'unknown'
		expect(
			await io.authorize({ targets: [{ ...update, schemaType: 'unknown' }] }),
		).toMatchObject({ reason: 'unverified' })
	})
})
