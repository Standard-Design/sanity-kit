/**
 * The first editor-facing URL field. Edits save after a short pause:
 * edit.ts checks access, versions, conflicts, and folder persistence before this
 * component emits a native patch. See docs/url-field.md for the workflow.
 */
import {
	Box,
	Button,
	Card,
	Flex,
	Grid,
	Stack,
	Text,
	TextInput,
} from '@sanity/ui'
import { keyframes, styled } from 'styled-components'
import { CopyIcon } from '@sanity/icons/Copy'
import { SyncIcon } from '@sanity/icons/Sync'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
	set,
	setIfMissing,
	useClient,
	useCurrentUser,
	useFormValue,
	useSchema,
	useWorkspace,
	type SanityDocument,
	type SlugInputProps,
} from 'sanity'
import { createUrlAuthoring } from '../../url/authoring.js'
import {
	createPagesRegistry,
	type PagesRouteConfig,
} from '../../url/registry.js'
import { createUrlGeneration } from './generate.js'
import { createUrlEditController } from './edit.js'
import { FolderPicker } from './folder-picker.js'
import { useUrlAutosave } from './autosave.js'
import { useUrlFieldError } from './validation.js'

// Studio's document-saving indicator uses the sync symbol with a one-second
// eased rotation. Use the public icon rather than importing its private status
// component. A direct SVG fits TextInput's icon slot without nested Text metrics.
const saveRotation = keyframes`
	to { transform: rotate(360deg); }
`
const SavingIcon = styled(SyncIcon)`
	transform-origin: center;
	visibility: hidden;
	&[data-saving='true'] {
		visibility: visible;
		animation: ${saveRotation} 1s ease-in-out infinite;
	}
	@media (prefers-reduced-motion: reduce) {
		&[data-saving='true'] {
			animation: none;
		}
	}
`

// Respond to the document pane's available width, which can be narrow even
// in a wide Studio window with navigator and preview panes open.
const UrlField = styled(Stack)`
	container: sanity-kit-url-field / inline-size;
	min-width: 0;
`
const InputRow = styled(Grid)<{ $fullPath: boolean }>`
	align-items: center;
	grid-template-columns: ${({ $fullPath }) => ($fullPath ? 'minmax(0, 1fr) auto' : 'auto minmax(0, 1fr) auto')};
	@container sanity-kit-url-field (max-width: 480px) {
		grid-template-columns: minmax(0, 1fr) auto;
		[data-url-folder] {
			grid-column: 1 / -1;
		}
	}
`

// Keep the message associated with the input for assistive technology. Visual
// feedback belongs to Sanity's field-label tooltip, not an extra row below.
const AccessibleError = styled.span`
	position: absolute;
	width: 1px;
	height: 1px;
	padding: 0;
	margin: -1px;
	overflow: hidden;
	clip-path: inset(50%);
	white-space: nowrap;
`

// Both labels occupy the same grid cell, so feedback never changes the button
// width. Each is centered over the other and reduced-motion settings are honored.
const CopyLabel = styled.span`
	display: inline-grid;
	place-items: center;
	> span {
		grid-area: 1 / 1;
		transition: opacity 160ms ease;
	}
	@media (prefers-reduced-motion: reduce) {
		> span {
			transition: none;
		}
	}
`

function CopyUrlButton({
	pathname,
	onFailure,
}: {
	pathname: string | undefined
	onFailure: () => void
}) {
	const [copied, setCopied] = useState(false)
	const attempt = useRef(0)
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
	useEffect(() => {
		setCopied(false)
		return () => {
			attempt.current += 1
			clearTimeout(timer.current)
		}
	}, [pathname])
	return (
		<Button
			aria-label="Copy URL"
			text={
				<CopyLabel aria-live="polite">
					<span aria-hidden={copied} style={{ opacity: copied ? 0 : 1 }}>
						Copy URL
					</span>
					<span aria-hidden={!copied} style={{ opacity: copied ? 1 : 0 }}>
						Copied!
					</span>
				</CopyLabel>
			}
			icon={CopyIcon}
			mode="bleed"
			fontSize={1}
			padding={2}
			disabled={!pathname}
			style={{ flexShrink: 0 }}
			onClick={() => {
				if (!pathname) return
				const current = ++attempt.current
				void navigator.clipboard
					.writeText(pathname)
					.then(() => {
						if (current !== attempt.current) return
						setCopied(true)
						clearTimeout(timer.current)
						timer.current = setTimeout(() => setCopied(false), 2500)
					})
					.catch(() => {
						if (current === attempt.current) onFailure()
					})
			}}
		/>
	)
}

/** Kept private while the fixed-prefix, draft-only field is accepted in Studio. */
export interface SanityUrlInputProps extends SlugInputProps {
	routes: PagesRouteConfig
}

function message(reason: string): string {
	if (reason.includes('published'))
		return 'This page is published. Changing its URL needs the reviewed URL-change workflow, which is not available yet.'
	if (reason.includes('release'))
		return 'This document has a release version. URL changes are not available here yet.'
	if (reason === 'url-in-use')
		return 'Another document already uses this URL. Choose a different URL.'
	if (reason === 'folder-outcome-unknown')
		return 'The folder save could not be confirmed. Try again to check its status; another save is blocked until it is confirmed.'
	if (reason.includes('access') || reason.includes('permission'))
		return 'URL editing requires access to all relevant document versions and folder metadata.'
	if (reason === 'missing-source')
		return 'Add a title or name before generating a slug.'
	if (reason === 'read-only') return 'This URL is read-only.'
	if (reason === 'missing-slug') return 'Enter a final URL segment.'
	if (reason === 'locked-prefix')
		return 'This collection uses a fixed URL prefix.'
	if (
		reason === 'invalid-value' ||
		reason === 'invalid-slug' ||
		reason === 'invalid-prefix'
	)
		return 'Enter a valid URL segment. Spaces, dots-only segments, query strings, and encoded slashes are not allowed.'
	return `The URL could not be prepared (${reason}). Reload and try again.`
}

// Validation problems need an edit, not another identical request. Keep retry
// for temporary reads/writes and for reconciling an uncertain folder save.
function canRetrySave(reason: string): boolean {
	return [
		'request-failed',
		'access-unavailable',
		'conflicts-request-failed',
		'conflicts-invalid-response',
		'folders-request-failed',
		'folders-invalid-response',
		'folders-conflict',
		'folder-outcome-unknown',
		'busy',
	].includes(reason)
}

export function SanityUrlInput(props: SanityUrlInputProps) {
	const { routes, value, schemaType, path, readOnly, onChange, elementProps } =
		props
	const errorId = useId()
	const document = useFormValue([]) as SanityDocument
	const client = useClient({ apiVersion: '2026-10-01' })
	const workspace = useWorkspace()
	const schema = useSchema()
	const currentUser = useCurrentUser()
	const documentSchema = schema.get(document?._type)
	const liveEdit =
		!!documentSchema &&
		'liveEdit' in documentSchema &&
		documentSchema.liveEdit === true
	const registry = useMemo(() => createPagesRegistry(routes), [routes])
	const authoring = useMemo(() => createUrlAuthoring(routes), [routes])
	const generation = useMemo(() => createUrlGeneration(routes), [routes])
	const editor = useMemo(
		() => createUrlEditController(routes, client),
		[routes, client],
	)
	const registered = registry.types.find(
		(type) => type.schemaType === document?._type,
	)
	const expected = registered?.pathField.split('.')
	const validField =
		expected?.at(-1) === 'current' &&
		expected.length === path.length + 1 &&
		path.every((part, index) => part === expected[index])
	const stored = value?.current
	const initial = authoring.prepareStored(document?._type, stored)
	const initialPrefix = initial.ok
		? initial.value.url.prefix
		: (registered?.routePrefix ?? '/')
	const initialSlug = initial.ok
		? initial.value.url.slug
		: registered?.pathMode === 'slug'
			? (stored ?? '')
			: ''
	const [prefix, setPrefix] = useState(initialPrefix)
	const [slug, setSlug] = useState(initialSlug)
	const [fullPath, setFullPath] = useState<string | undefined>(
		stored && !initial.ok && registered?.pathMode !== 'slug'
			? stored
			: undefined,
	)
	const [loaded, setLoaded] =
		useState<Awaited<ReturnType<typeof editor.load>>>()
	const [refresh, setRefresh] = useState(0)
	const [busy, setBusy] = useState(false)
	const [touched, setTouched] = useState(false)
	const [notice, setNotice] = useState<string>()
	const operation = useRef(0)
	const editSequence = useRef(0)
	const submitted = useRef(new Map<string, number>())
	const lastSubmitted = useRef<string | undefined>(undefined)
	const previousIdentity = useRef(document?._id)
	const latest = useRef({
		document,
		readOnly,
		stored,
		validField,
		liveEdit,
		staticReadOnly: schemaType.readOnly === true,
	})
	latest.current = {
		document,
		readOnly,
		stored,
		validField,
		liveEdit,
		staticReadOnly: schemaType.readOnly === true,
	}
	const disabled =
		liveEdit ||
		!!readOnly ||
		schemaType.readOnly === true ||
		!validField ||
		loaded?.status !== 'loaded' ||
		!loaded.editable
	const candidate =
		fullPath === undefined
			? slug === '' && stored !== '/'
				? { ok: false as const, reason: 'missing-slug' as const }
				: authoring.prepareParts(document?._type, { prefix, slug })
			: authoring.prepareStored(document?._type, fullPath)
	const dirty =
		touched &&
		(candidate.ok
			? candidate.value.storedValue !== stored
			: prefix !== initialPrefix ||
				slug !== initialSlug ||
				fullPath !== undefined)
	const resolvedPath =
		candidate.ok && (touched || !!stored)
			? candidate.value.url.pathname
			: initial.ok
				? initial.value.url.pathname
				: undefined

	// A remote URL edit resets the local proposal. Any document/context change
	// invalidates pending async work, including pending slug generation.
	useEffect(() => {
		const sameDocument = previousIdentity.current === document?._id
		previousIdentity.current = document?._id
		const echoedEdit =
			stored === undefined ? undefined : submitted.current.get(stored)
		if (stored !== undefined) submitted.current.delete(stored)
		if (!sameDocument) submitted.current.clear()
		lastSubmitted.current = undefined
		// Native form patches may echo back after the editor has already typed
		// something newer. Acknowledge that save without replacing newer local text.
		if (
			sameDocument &&
			echoedEdit !== undefined &&
			echoedEdit !== editSequence.current
		)
			return
		setTouched(false)
		setPrefix(initialPrefix)
		setSlug(initialSlug)
		setFullPath(
			stored && !initial.ok && registered?.pathMode !== 'slug'
				? stored
				: undefined,
		)
	}, [
		stored,
		document?._id,
		initialPrefix,
		initialSlug,
		initial.ok,
		registered?.pathMode,
	])
	useEffect(() => {
		operation.current += 1
		generation.invalidate()
		editor.invalidate()
		setBusy(false)
		return () => {
			operation.current += 1
			generation.invalidate()
			editor.invalidate()
		}
	}, [document, readOnly, schemaType, validField, liveEdit, generation, editor])
	useEffect(() => {
		const abort = new AbortController()
		setLoaded(undefined)
		void editor
			.load(latest.current.document, abort.signal)
			.then((result) => {
				if (!abort.signal.aborted) setLoaded(result)
			})
			.catch(() => {
				if (!abort.signal.aborted) {
					setLoaded({ status: 'blocked', reason: 'folders-request-failed' })
					setNotice('Folder information could not be loaded. Try reloading it.')
				}
			})
		return () => abort.abort()
	}, [editor, document?._id, document?._type, refresh])

	function changed() {
		editSequence.current += 1
		operation.current += 1
		generation.invalidate()
		editor.invalidate()
		setNotice(undefined)
		setBusy(false)
	}
	function current(epoch: number, before: SanityDocument) {
		return (
			operation.current === epoch &&
			latest.current.document === before &&
			!latest.current.readOnly &&
			!latest.current.liveEdit &&
			latest.current.validField &&
			!latest.current.staticReadOnly
		)
	}
	async function generate() {
		if (disabled || busy) return
		changed()
		const epoch = operation.current
		const before = document
		setBusy(true)
		try {
			const result = await generation.generate({
				document: before,
				schemaType,
				path,
				prefix,
				readOnly: false,
				context: {
					projectId: workspace.projectId,
					dataset: workspace.dataset,
					schema,
					currentUser,
					getClient: workspace.getClient,
				},
			})
			if (!current(epoch, before)) return
			if (!result.ok) setNotice(message(result.reason))
			else {
				setTouched(true)
				setSlug(result.value.url.slug)
				setFullPath(undefined)
			}
		} finally {
			if (operation.current === epoch) setBusy(false)
		}
	}
	const autosave = useUrlAutosave({
		editor,
		document,
		storedValue: candidate.ok ? candidate.value.storedValue : undefined,
		enabled:
			!disabled &&
			dirty &&
			candidate.ok &&
			candidate.value.storedValue !== lastSubmitted.current,
		paused: busy,
		onReady: (ready) => {
			if (
				latest.current.readOnly ||
				latest.current.staticReadOnly ||
				latest.current.liveEdit ||
				!latest.current.validField
			)
				return
			submitted.current.set(ready.storedValue, editSequence.current)
			lastSubmitted.current = ready.storedValue
			// Patch only current; Studio owns optimistic draft state and autosave.
			onChange([
				setIfMissing({ _type: schemaType.name }),
				set(ready.storedValue, ['current']),
			])
		},
	})
	const saving =
		!disabled &&
		(autosave.status === 'waiting' || autosave.status === 'checking')
	const errorReason = disabled
		? undefined
		: dirty && !candidate.ok
			? candidate.reason
			: autosave.status === 'error'
				? (autosave.reason ?? 'request-failed')
				: undefined
	const errorMessage = errorReason ? message(errorReason) : undefined
	useUrlFieldError(errorMessage)
	// Use the same TextInput validity API as Sanity's own slug/string inputs.
	// Local proposals have not been patched, so their errors belong here rather
	// than in the document's persisted schema-validation results.
	const validationMessage =
		errorMessage ||
		props.validation?.find((item) => item.level === 'error')?.message
	const describedBy =
		[elementProps['aria-describedby'], errorMessage && errorId]
			.filter(Boolean)
			.join(' ') || undefined
	// Reserve the trailing icon space even when idle so save feedback never shifts the
	// field or the content below it. Errors still receive their own explanation.
	const saveIndicator = (
		<SavingIcon
			data-saving={saving}
			role={saving ? 'status' : undefined}
			aria-label={saving ? 'Saving URL' : undefined}
			aria-hidden={!saving}
		/>
	)

	async function createFolder(pathname: string) {
		if (disabled || busy)
			return {
				ok: false as const,
				message: 'This URL cannot be edited right now.',
			}
		changed()
		const epoch = operation.current
		const before = document
		setBusy(true)
		try {
			// Let a canceled autosave finish acknowledging any folder write before
			// starting another mutation through the same controller.
			await autosave.waitForIdle()
			if (!current(epoch, before))
				return {
					ok: false as const,
					message: 'The document changed. Try again.',
				}
			const result = await editor.createFolder({
				document: before,
				pathname,
				readOnly: false,
			})
			if (!current(epoch, before))
				return {
					ok: false as const,
					message: 'The document changed. Reload folders before continuing.',
				}
			if (result.status !== 'saved')
				return { ok: false as const, message: message(result.reason) }
			setLoaded((previous) =>
				previous?.status === 'loaded'
					? { ...previous, folders: [...previous.folders, { pathname }] }
					: previous,
			)
			return { ok: true as const }
		} catch {
			return { ok: false as const, message: 'The folder could not be saved.' }
		} finally {
			if (operation.current === epoch) setBusy(false)
		}
	}

	return (
		<UrlField gap={3}>
			<InputRow gap={2} $fullPath={fullPath !== undefined}>
				{fullPath !== undefined ? (
					<TextInput
						{...elementProps}
						aria-label="Full pathname"
						iconRight={saveIndicator}
						aria-busy={saving}
						customValidity={validationMessage ?? ''}
						aria-invalid={!!validationMessage}
						aria-describedby={describedBy}
						value={fullPath}
						readOnly={disabled || busy}
						onChange={(event) => {
							changed()
							setTouched(true)
							setFullPath(event.currentTarget.value)
						}}
					/>
				) : (
					<>
						<Box data-url-folder style={{ minWidth: 0 }}>
							{registered?.collection ? (
								<Box padding={2}>
									<Text size={1}>{prefix === '/' ? '/' : `${prefix}/`}</Text>
								</Box>
							) : (
								<FolderPicker
									key={document?._id}
									value={prefix}
									folders={loaded?.status === 'loaded' ? loaded.folders : []}
									readOnly={disabled}
									loading={!loaded}
									onRetry={() => setRefresh((count) => count + 1)}
									onChange={(next) => {
										changed()
										setTouched(true)
										setPrefix(next)
									}}
									onCreate={createFolder}
								/>
							)}
						</Box>
						<Box style={{ minWidth: 0 }}>
							<TextInput
								{...elementProps}
								aria-label="URL slug"
								iconRight={saveIndicator}
								aria-busy={saving}
								customValidity={validationMessage ?? ''}
								aria-invalid={!!validationMessage}
								aria-describedby={describedBy}
								value={slug}
								readOnly={disabled || busy}
								onChange={(event) => {
									changed()
									setTouched(true)
									setSlug(event.currentTarget.value)
								}}
							/>
						</Box>
					</>
				)}
				<Button
					text="Generate"
					style={{ flexShrink: 0 }}
					mode="ghost"
					disabled={
						disabled ||
						busy ||
						fullPath !== undefined ||
						!schemaType.options?.source
					}
					onClick={() => void generate()}
				/>
			</InputRow>
			<Flex gap={2} align="flex-start" justify="space-between">
				<Box flex={1} paddingTop={1} style={{ minWidth: 0 }}>
					{resolvedPath && (
						<Text size={1} muted style={{ overflowWrap: 'anywhere' }}>
							{resolvedPath}
						</Text>
					)}
				</Box>
				<CopyUrlButton
					pathname={resolvedPath}
					onFailure={() => setNotice('The URL could not be copied.')}
				/>
			</Flex>
			{errorMessage && (
				<>
					<AccessibleError role="alert" id={errorId}>
						{errorMessage}
					</AccessibleError>
					{errorReason && canRetrySave(errorReason) && (
						<Button
							text="Retry saving URL"
							mode="ghost"
							onClick={autosave.retry}
						/>
					)}
				</>
			)}
			{!disabled &&
				prefix === '/' &&
				slug === '' &&
				fullPath === undefined &&
				stored !== '/' && (
					<Button
						text="Use as homepage"
						mode="ghost"
						disabled={busy}
						onClick={() => {
							changed()
							setTouched(true)
							setFullPath('/')
						}}
					/>
				)}

			{!validField && (
				<Text size={1} role="alert">
					This input must use the registered slug field.
				</Text>
			)}
			{liveEdit && (
				<Text size={1}>
					This field currently supports draft-based documents only. Live-edit
					URLs need the reviewed URL-change workflow.
				</Text>
			)}
			{loaded?.status === 'blocked' ||
			(loaded?.status === 'loaded' && !loaded.editable) ? (
				<Stack gap={2}>
					<Text size={1}>{message(loaded.reason ?? 'unavailable')}</Text>
					<Button
						text="Reload URL information"
						mode="ghost"
						onClick={() => setRefresh((count) => count + 1)}
					/>
				</Stack>
			) : null}
			{notice && (
				<Card padding={3} tone="transparent">
					<Text size={1} role="status">
						{notice}
					</Text>
				</Card>
			)}
		</UrlField>
	)
}
