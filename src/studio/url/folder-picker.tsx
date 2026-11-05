/**
 * The URL field's folder controls. Selection changes a proposed URL; creation
 * asks the caller to save organizational metadata before selecting that folder.
 * Network access, permissions, and page patches belong to the field controller.
 */
import { AddIcon } from '@sanity/icons/Add'
import { TooltipButton } from '../pages/tooltip.js'
import { ChevronDownIcon } from '@sanity/icons/ChevronDown'
import { FolderIcon } from '@sanity/icons/Folder'
import {
	Box,
	Button,
	Card,
	Dialog,
	Flex,
	Stack,
	Text,
	TextInput,
	useClickOutsideEvent,
} from '@sanity/ui'
import { Popover } from '@sanity/ui/popover'
import {
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from 'react'
import FocusLockModule from 'react-focus-lock'
import { pagePathname } from '../../url/registry.js'

const FocusLock = FocusLockModule.default ?? FocusLockModule

export interface FolderPickerProps {
	value: string
	folders: readonly { pathname: string }[]
	readOnly?: boolean
	loading?: boolean
	error?: string
	onRetry?: () => void
	onChange: (pathname: string) => void
	onCreate: (
		pathname: string,
	) => Promise<{ ok: true } | { ok: false; message: string }>
}

function folderName(pathname: string) {
	if (pathname === '/') return 'Site root'
	const name = pathname.split('/').at(-1) ?? pathname
	return name.charAt(0).toUpperCase() + name.slice(1)
}

function folderPaths(folders: FolderPickerProps['folders'], value: string) {
	const paths = new Set(['/'])
	// Keep the current location reachable even before its registry read finishes.
	// Ancestors are display choices, not proof that folder records were saved.
	for (const path of [...folders.map((folder) => folder.pathname), value]) {
		if (!pagePathname(path) || (path !== '/' && /\/\/|\/$/u.test(path)))
			continue
		const segments = path.split('/').filter(Boolean)
		segments.forEach((_, index) => {
			paths.add(`/${segments.slice(0, index + 1).join('/')}`)
		})
	}
	return [...paths].sort()
}

function destination(parent: string, relative: string): string | undefined {
	// Folder names are URL segments, not titles. Repair separators only; do not
	// lowercase, slugify, decode, trim whitespace, or reinterpret another host.
	if (!relative || relative.startsWith('/')) return undefined
	const path = `${parent === '/' ? '' : parent}/${relative}`
	if (!pagePathname(path)) return undefined
	return path.replace(/\/{2,}/gu, '/').replace(/\/$/u, '')
}

interface FolderOptionsProps {
	label: string
	value: string
	paths: readonly string[]
	open: boolean
	onClose: () => void
	onSelect: (path: string) => void
	trigger: ReactNode
	triggerRef: React.RefObject<HTMLButtonElement | null>
	headerAction?: ReactNode
	footer?: ReactNode
}

/** Both pickers share names, indentation, dismissal, and keyboard containment. */
function FolderOptions(props: FolderOptionsProps) {
	const panel = useRef<HTMLDivElement>(null)
	useClickOutsideEvent(props.open ? props.onClose : false, () => [
		props.triggerRef.current,
		panel.current,
	])
	return (
		<Popover
			open={props.open}
			placement="bottom-start"
			// A parent picker is portaled outside its dialog. Measure available
			// space against the viewport, not the dialog's short content area.
			floatingBoundary={
				props.triggerRef.current?.ownerDocument.documentElement ?? null
			}
			referenceBoundary={
				props.triggerRef.current?.ownerDocument.documentElement ?? null
			}
			fallbackPlacements={['top-start', 'bottom-start']}
			placementStrategy="autoPlacement"
			portal
			modal
			constrainSize
			content={
				props.open ? (
					<FocusLock
						returnFocus
						lockProps={{
							style: { display: 'flex', flexDirection: 'column', minHeight: 0 },
						}}
					>
						<Box
							ref={panel}
							role="dialog"
							aria-label={props.label}
							aria-modal="true"
							padding={1}
							style={{
								minHeight: 0,
								width: 'max-content',
								minWidth: 'min(240px, 80vw)',
								maxWidth: 'min(400px, 90vw)',
								maxHeight: 'min(400px, calc(100dvh - 48px))',
								overflowY: 'auto',
							}}
							onKeyDown={(event) => {
								if (event.key !== 'Escape') return
								event.preventDefault()
								event.stopPropagation()
								props.onClose()
							}}
						>
							<Flex padding={2} gap={3} align="center" justify="space-between">
								<Text size={1} weight="medium">
									{props.label}
								</Text>
								{props.headerAction}
							</Flex>
							<Stack gap={1}>
								{props.paths.map((path) => (
									<Card
										as="button"
										radius={2}
										__unstable_focusRing
										key={path}
										type="button"
										padding={2}
										selected={path === props.value}
										aria-pressed={path === props.value}
										aria-label={`${props.label === 'Parent folders' ? 'Nest inside' : 'Select folder'} ${path}`}
										style={{
											textAlign: 'left',
											paddingLeft:
												8 +
												Math.min(path.split('/').filter(Boolean).length, 8) *
													16,
										}}
										onClick={() => props.onSelect(path)}
									>
										<Text size={1}>{folderName(path)}</Text>
									</Card>
								))}
							</Stack>
							{props.footer}
						</Box>
					</FocusLock>
				) : null
			}
		>
			<Box>{props.trigger}</Box>
		</Popover>
	)
}

export function FolderPicker({
	value,
	folders,
	readOnly = false,
	loading = false,
	error,
	onRetry,
	onChange,
	onCreate,
}: FolderPickerProps) {
	const trigger = useRef<HTMLButtonElement>(null)
	const [open, setOpen] = useState(false)
	const [creating, setCreating] = useState(false)
	const latest = useRef({ readOnly })
	latest.current.readOnly = readOnly
	useEffect(() => {
		if (readOnly) {
			setOpen(false)
			setCreating(false)
		}
	}, [readOnly])
	const paths = useMemo(() => folderPaths(folders, value), [folders, value])
	return (
		<>
			<FolderOptions
				label="Choose folder"
				value={value}
				paths={paths}
				open={open && !readOnly}
				triggerRef={trigger}
				onClose={() => setOpen(false)}
				onSelect={(selected) => {
					if (latest.current.readOnly) return
					onChange(selected)
					setOpen(false)
				}}
				trigger={
					<Button
						ref={trigger}
						width="fill"
						type="button"
						mode="ghost"
						fontSize={1}
						padding={3}
						aria-label={`Change folder: ${value}`}
						aria-haspopup="dialog"
						aria-expanded={open && !readOnly}
						disabled={readOnly}
						onClick={() => setOpen((current) => !current)}
					>
						<Flex align="center" gap={3}>
							<Text size={1}>
								<FolderIcon />
							</Text>
							<Box flex={1} style={{ minWidth: 0 }}>
								<Text size={1} align="left" textOverflow="ellipsis">
									{value === '/' ? '/' : `${value}/`}
								</Text>
							</Box>
							<Text size={1}>
								<ChevronDownIcon />
							</Text>
						</Flex>
					</Button>
				}
				headerAction={
					<TooltipButton
						type="button"
						mode="bleed"
						aria-label="New subfolder"
						tooltip="New subfolder"
						icon={AddIcon}
						fontSize={1}
						padding={2}
						disabled={loading || Boolean(error)}
						onClick={() => {
							setOpen(false)
							setCreating(true)
						}}
					/>
				}
				footer={
					(loading || error) && (
						<Stack gap={3} paddingTop={3}>
							{loading && (
								<Text size={1} muted role="status">
									Loading folders…
								</Text>
							)}
							{error && (
								<Card padding={3} tone="caution">
									<Stack gap={3}>
										<Text size={1} role="alert">
											{error}
										</Text>
										{onRetry && (
											<Button
												type="button"
												mode="ghost"
												text="Retry loading folders"
												onClick={onRetry}
											/>
										)}
									</Stack>
								</Card>
							)}
						</Stack>
					)
				}
			/>
			{creating && !readOnly && (
				<NewFolderDialog
					folders={paths.map((pathname) => ({ pathname }))}
					readOnly={readOnly}
					loading={loading}
					{...(error ? { error } : {})}
					{...(onRetry ? { onRetry } : {})}
					onCreate={onCreate}
					submitLabel="Create and use folder"
					onCreated={(pathname) => {
						if (latest.current.readOnly) return
						onChange(pathname)
						setCreating(false)
						trigger.current?.focus()
					}}
					onClose={() => {
						setCreating(false)
						trigger.current?.focus()
					}}
				/>
			)}
		</>
	)
}

/**
 * Shared creation dialog for the URL field and Pages navigator. It only collects
 * a folder destination; the caller owns access checks, persistence, and recovery.
 * Mount a new dialog for each action so each starts with its supplied parent.
 */
export interface NewFolderDialogProps {
	folders: FolderPickerProps['folders']
	initialParent?: string
	/** Contextual folder actions keep their chosen parent fixed. */
	parentLocked?: boolean
	readOnly?: boolean
	loading?: boolean
	error?: string
	onRetry?: () => void
	onCreate: FolderPickerProps['onCreate']
	onCreated: (pathname: string) => void
	onClose: () => void
	submitLabel?: string
}

export function NewFolderDialog({
	folders,
	initialParent = '/',
	parentLocked = false,
	readOnly = false,
	loading = false,
	error,
	onRetry,
	onCreate,
	onCreated,
	onClose,
	submitLabel = 'Create folder',
}: NewFolderDialogProps) {
	const id = useId()
	const parentTrigger = useRef<HTMLButtonElement>(null)
	const [parentOpen, setParentOpen] = useState(false)
	const [parent, setParent] = useState(initialParent)
	const [relative, setRelative] = useState('')
	const [busy, setBusy] = useState(false)
	const [failure, setFailure] = useState<string>()
	const requestEpoch = useRef(0)
	const inFlight = useRef(false)
	const latest = useRef({ readOnly, mounted: true })
	latest.current.readOnly = readOnly
	useEffect(() => {
		latest.current.mounted = true
		return () => {
			latest.current.mounted = false
			requestEpoch.current += 1
		}
	}, [])
	useEffect(() => {
		if (readOnly) {
			requestEpoch.current += 1
			setParentOpen(false)
		}
	}, [readOnly])
	const paths = useMemo(
		() => folderPaths(folders, initialParent),
		[folders, initialParent],
	)
	const path = destination(parent, relative)
	const validation =
		relative && !path
			? 'Use URL segments separated by /. Do not start with / or use spaces, dot segments, queries, or hashes.'
			: path && paths.includes(path)
				? 'That folder already exists. Choose a different name or parent folder.'
				: undefined
	function closeModal() {
		if (busy) return
		setParentOpen(false)
		onClose()
	}
	async function create() {
		if (
			readOnly ||
			latest.current.readOnly ||
			inFlight.current ||
			loading ||
			error ||
			!path ||
			validation
		)
			return
		const request = ++requestEpoch.current
		inFlight.current = true
		setBusy(true)
		setFailure(undefined)
		try {
			const result = await onCreate(path)
			if (
				!latest.current.mounted ||
				latest.current.readOnly ||
				request !== requestEpoch.current
			)
				return
			if (!result.ok) {
				setFailure(result.message)
				return
			}
			onCreated(path)
			setParentOpen(false)
		} catch {
			if (
				latest.current.mounted &&
				!latest.current.readOnly &&
				request === requestEpoch.current
			)
				setFailure(
					'The folder could not be saved. Check the folder list before trying again.',
				)
		} finally {
			inFlight.current = false
			if (latest.current.mounted) setBusy(false)
		}
	}
	if (readOnly) return null
	return (
		<Dialog
			id={`${id}-create-folder`}
			header={
				parentLocked
					? `New subfolder inside ${folderName(parent)}`
					: 'New subfolder'
			}
			width={1}
			onClose={() => {
				if (parentOpen) setParentOpen(false)
				else closeModal()
			}}
			footer={
				<Flex padding={3} gap={2} justify="flex-end">
					<Button
						type="button"
						mode="bleed"
						text="Cancel"
						onClick={closeModal}
						disabled={busy}
					/>
					<Button
						type="button"
						tone="primary"
						text={busy ? 'Creating folder…' : submitLabel}
						disabled={
							busy ||
							readOnly ||
							loading ||
							Boolean(error) ||
							!path ||
							Boolean(validation)
						}
						onClick={() => {
							void create()
						}}
					/>
				</Flex>
			}
		>
			<Stack gap={4} padding={4}>
				<Stack gap={3}>
					<Text as="label" htmlFor={`${id}-name`} size={1} weight="medium">
						Folder name or path
					</Text>
					<Text id={`${id}-hint`} size={1} muted>
						Use / to add several nested folders.
					</Text>
					<TextInput
						id={`${id}-name`}
						autoFocus
						value={relative}
						placeholder="team or company/team"
						spellCheck={false}
						disabled={busy}
						aria-describedby={`${id}-hint`}
						onChange={(event) => {
							setRelative(event.currentTarget.value)
							setFailure(undefined)
						}}
						onKeyDown={(event) => {
							if (event.key === 'Enter') {
								event.preventDefault()
								void create()
							}
						}}
					/>
				</Stack>
				<Stack gap={3}>
					{!parentLocked && (
						<Text size={1} weight="medium">
							Nest inside
						</Text>
					)}
					{parentLocked ? (
						<Card border radius={2} padding={3}>
							<Flex gap={3} align="center">
								<Text size={2} muted>
									<FolderIcon />
								</Text>
								<Stack gap={3} flex={1} style={{ minWidth: 0 }}>
									<Text size={1} muted>
										Nest inside
									</Text>
									<Text
										size={1}
										weight="medium"
										style={{ overflowWrap: 'anywhere' }}
									>
										{parent}
									</Text>
								</Stack>
							</Flex>
						</Card>
					) : (
						<FolderOptions
							label="Parent folders"
							value={parent}
							paths={paths}
							open={parentOpen}
							triggerRef={parentTrigger}
							onClose={() => setParentOpen(false)}
							onSelect={(selected) => {
								setParent(selected)
								setParentOpen(false)
								setFailure(undefined)
							}}
							trigger={
								<Button
									ref={parentTrigger}
									width="fill"
									justify="space-between"
									textAlign="left"
									type="button"
									mode="ghost"
									text={folderName(parent)}
									aria-label={`Nest inside: ${parent}`}
									aria-haspopup="dialog"
									aria-expanded={parentOpen}
									iconRight={ChevronDownIcon}
									disabled={busy}
									onClick={() => setParentOpen((current) => !current)}
								/>
							}
						/>
					)}
				</Stack>
				<Stack gap={3}>
					<Text size={1} muted>
						New folder path
					</Text>
					<Text size={1} style={{ overflowWrap: 'anywhere' }}>
						<output aria-live="polite">{path ?? parent}</output>
					</Text>
				</Stack>
				{loading && (
					<Text size={1} muted role="status">
						Loading folders…
					</Text>
				)}
				{error && (
					<Card padding={3} tone="caution">
						<Stack gap={3}>
							<Text size={1} role="alert">
								{error}
							</Text>
							{onRetry && (
								<Button
									mode="ghost"
									text="Retry loading folders"
									onClick={onRetry}
								/>
							)}
						</Stack>
					</Card>
				)}
				{(failure || validation) && (
					<Text size={1} role="alert">
						{failure || validation}
					</Text>
				)}
			</Stack>
		</Dialog>
	)
}
