/**
 * Choose among the consumer's registered native templates, in the header picker
 * or a native folder submenu. Both share the same checks. Sanity resolves initial
 * values, assigns document IDs, and creates the draft after the native intent.
 */
import {
	Component,
	useEffect,
	useMemo,
	useId,
	createElement,
	useRef,
	useState,
	type ReactNode,
} from 'react'
import {
	Box,
	Button,
	Card,
	Flex,
	Spinner,
	Stack,
	Text,
	TextInput,
	useClickOutsideEvent,
} from '@sanity/ui'
import { MenuGroup, MenuItem } from '@sanity/ui/menu'
import { Popover } from '@sanity/ui/popover'
import FocusLockModule from 'react-focus-lock'
import { PagesTooltip } from './tooltip.js'
import { DocumentIcon } from '@sanity/icons/Document'
import { SearchIcon } from '@sanity/icons/Search'

const FocusLock = FocusLockModule.default ?? FocusLockModule
import { useRouter } from 'sanity/router'
import { usePerspective } from 'sanity'
import type { PagesRuntime } from './runtime.js'
import {
	usePageCreationOptions,
	type PageCreationOption,
} from './creation-options.js'

/** Native permission reads can throw; keep a failed check out of the tool boundary. */
class CreationCheckBoundary extends Component<
	{ children: ReactNode; onRetry?: () => void; fallback?: ReactNode },
	{ failed: boolean }
> {
	override state = { failed: false }
	static getDerivedStateFromError() {
		return { failed: true }
	}
	override render() {
		if (!this.state.failed) return this.props.children
		if (this.props.fallback) return this.props.fallback
		return (
			<Card tone="caution" padding={3} radius={2}>
				<Stack gap={3}>
					<Text size={1} weight="medium">
						Page creation could not be checked
					</Text>
					<Text size={1}>
						We could not confirm which pages you can create. Retry the check to
						continue.
					</Text>
					<Button mode="ghost" text="Retry" onClick={this.props.onRetry} />
				</Stack>
			</Card>
		)
	}
}

function CreationChoices({
	runtime,
	onClose,
	context,
	autoOpenSingle = true,
}: {
	runtime: PagesRuntime
	autoOpenSingle?: boolean
	onClose: () => void
	context?: { mode: 'page' | 'index'; pathname: string } | undefined
}) {
	const contextual = useMemo(
		() => (context ? { ...context, registry: runtime.registry } : undefined),
		[context, runtime.registry],
	)
	const { options, loading, configurationErrors } = usePageCreationOptions(
		runtime.createChoices,
		contextual,
	)
	const router = useRouter()
	const navigated = useRef(false)
	const [failedChoice, setFailedChoice] = useState<string>()
	const eligible = options.filter((option) => option.granted)
	// Contextual creation skips invalid or out-of-scope templates independently.
	// Keep the general Pages creator's existing configuration check unchanged.
	const configurationBlocked =
		configurationErrors.length > 0 && (!context || !eligible.length)
	const [query, setQuery] = useState('')
	const list = useRef<HTMLDivElement>(null)
	const filtered = options.filter((option) =>
		option.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
	)
	function open(option: PageCreationOption) {
		if (loading || configurationBlocked || !option.granted || navigated.current)
			return
		navigated.current = true
		try {
			const intent = {
				type: option.schemaType,
				template: option.templateId,
				presentation: runtime.name,
			}
			router.navigateIntent(
				'create',
				option.parameters ? [intent, option.parameters] : intent,
			)
			onClose()
		} catch {
			navigated.current = false
			setFailedChoice(option.id)
		}
	}
	// Wait for current permission results before taking the single-choice shortcut.
	useEffect(() => {
		if (
			autoOpenSingle &&
			!failedChoice &&
			!loading &&
			!configurationBlocked &&
			eligible.length === 1
		)
			open(eligible[0]!)
	})
	if (configurationBlocked)
		return (
			<Card tone="critical" padding={3} radius={2}>
				<Stack gap={3}>
					<Text size={1} weight="medium">
						Page creation needs configuration
					</Text>
					{configurationErrors.map((message) => (
						<Text key={message} size={1}>
							{message}
						</Text>
					))}
					<Text size={1}>
						Ask a developer to update the Pages creation settings.
					</Text>
				</Stack>
			</Card>
		)
	if (loading)
		return (
			<Flex align="center" justify="center" gap={3} padding={4}>
				<Spinner muted />
				<Text size={1} muted>
					Checking available page types…
				</Text>
			</Flex>
		)
	if (!eligible.length)
		return (
			<Box padding={3}>
				<Stack gap={3}>
					<Text size={1}>
						{context && !options.length
							? 'No page types configured here use the SanityKit URL field. Ask a developer to register a page template with that field.'
							: options.some((option) => option.reason)
								? 'These templates cannot initialize a page in this folder.'
								: 'Your current access does not allow creating any of the page types available here.'}
					</Text>
					{options
						.filter((option) => option.reason)
						.map((option) => (
							<Text key={option.id} size={1}>
								{option.title}: {option.reason}
							</Text>
						))}
				</Stack>
			</Box>
		)

	if (failedChoice)
		return (
			<Card tone="caution" padding={3} radius={2}>
				<Stack gap={3}>
					<Text size={1}>
						The new page could not be opened. Retry to open the editor.
					</Text>
					<Button
						mode="ghost"
						text="Retry"
						disabled={!eligible.some((option) => option.id === failedChoice)}
						onClick={() => {
							const option = eligible.find((item) => item.id === failedChoice)
							if (option) open(option)
						}}
					/>
				</Stack>
			</Card>
		)
	if (autoOpenSingle && eligible.length === 1)
		return (
			<Text size={1} muted>
				Opening a new page…
			</Text>
		)
	return (
		<Flex direction="column" style={{ minHeight: 0 }}>
			<Card borderBottom padding={1}>
				<TextInput
					autoFocus={autoOpenSingle}
					aria-label="Search page types"
					placeholder="Search page types"
					icon={SearchIcon}
					border={false}
					__unstable_disableFocusRing
					fontSize={1}
					radius={1}
					value={query}
					onChange={(event) => setQuery(event.currentTarget.value)}
					onKeyDown={(event) => {
						if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
							event.preventDefault()
							const buttons = list.current?.querySelectorAll<HTMLButtonElement>(
								'button:not(:disabled)',
							)
							buttons?.[
								event.key === 'ArrowDown' ? 0 : buttons.length - 1
							]?.focus()
						}
					}}
				/>
			</Card>
			<Box
				ref={list}
				padding={1}
				style={{ overflowY: 'auto', maxHeight: 338, minHeight: 0 }}
				onKeyDown={(event) => {
					if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
					event.preventDefault()
					event.stopPropagation()
					const buttons = [
						...list.current!.querySelectorAll<HTMLButtonElement>(
							'button:not(:disabled)',
						),
					]
					const index = buttons.indexOf(
						document.activeElement as HTMLButtonElement,
					)
					buttons[
						(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) %
							buttons.length
					]?.focus()
				}}
			>
				{filtered.map((option) => {
					const Icon = option.icon ?? DocumentIcon
					return (
						<PagesTooltip
							key={option.id}
							content={
								option.reason ??
								'Your current access does not allow creating this page type.'
							}
							disabled={option.granted}
						>
							<div>
								{!autoOpenSingle ? (
									<MenuItem
										icon={Icon}
										text={option.title}
										disabled={!option.granted}
										onClickCapture={(event) => {
											// Keep a failed handoff visible for retry. A successful handoff closes
											// the menu through onClose, instead of the automatic MenuItem dismissal.
											event.stopPropagation()
											open(option)
										}}
									/>
								) : (
									<Card
										as="button"
										type="button"
										disabled={!option.granted}
										padding={3}
										marginBottom={1}
										radius={2}
										style={{ width: '100%', textAlign: 'left' }}
										__unstable_focusRing
										onClick={() => open(option)}
									>
										<Flex align="center" gap={3}>
											<Text size={1}>{createElement(Icon)}</Text>
											<Text size={1}>{option.title}</Text>
										</Flex>
									</Card>
								)}
							</div>
						</PagesTooltip>
					)
				})}
				{!filtered.length && (
					<Flex
						align="center"
						justify="center"
						padding={4}
						style={{ minHeight: 100 }}
					>
						<Text size={1} muted align="center">
							No page types found.
						</Text>
					</Flex>
				)}
			</Box>
		</Flex>
	)
}

/** Shared checks for the header picker and native folder submenus. */
export function PageCreationContent({
	runtime,
	context,
	onCreated,
	autoOpenSingle = true,
}: {
	runtime: PagesRuntime
	context?: { mode: 'page' | 'index'; pathname: string } | undefined
	onCreated: () => void
	autoOpenSingle?: boolean
}) {
	const [attempt, setAttempt] = useState(0)
	const { selectedReleaseId, selectedVariantNames } = usePerspective()
	const scopedVersion = Boolean(
		selectedReleaseId || selectedVariantNames?.length,
	)
	return (
		<>
			{scopedVersion ? (
				<Card tone="caution" padding={3} radius={2}>
					<Stack gap={3}>
						<Text size={1} weight="medium">
							Switch to Drafts to create a page
						</Text>
						<Text size={1}>
							Pages creates ordinary drafts. Creating pages inside a release or
							variant is not supported here yet.
						</Text>
					</Stack>
				</Card>
			) : (
				<CreationCheckBoundary
					key={attempt}
					onRetry={() => setAttempt((value) => value + 1)}
				>
					<CreationChoices
						autoOpenSingle={autoOpenSingle}
						runtime={runtime}
						onClose={onCreated}
						context={context}
					/>
				</CreationCheckBoundary>
			)}
		</>
	)
}

type FolderCreationActionProps = {
	runtime: PagesRuntime
	context: { mode: 'page' | 'index'; pathname: string }
	disabled: boolean
	onSingle: () => void
	onCreated: () => void
}

/** Resolve permissions before choosing a direct action or a native submenu. */
export function FolderPageCreationAction(props: FolderCreationActionProps) {
	return (
		<CreationCheckBoundary fallback={<FolderTemplateSubmenu {...props} />}>
			<ResolvedFolderCreationAction {...props} />
		</CreationCheckBoundary>
	)
}

function ResolvedFolderCreationAction(props: FolderCreationActionProps) {
	const context = useMemo(
		() => ({ ...props.context, registry: props.runtime.registry }),
		[props.context, props.runtime.registry],
	)
	const { options, loading } = usePageCreationOptions(
		props.runtime.createChoices,
		context,
	)
	const title =
		props.context.mode === 'page' ? 'Create page' : 'Create index page'
	if (loading || options.filter((option) => option.granted).length === 1)
		return (
			<MenuItem
				text={title}
				icon={DocumentIcon}
				disabled={props.disabled || loading}
				onClick={props.onSingle}
			/>
		)
	return <FolderTemplateSubmenu {...props} />
}

/** Hovering a submenu only reveals choices; it never starts document creation. */
function FolderTemplateSubmenu({
	runtime,
	context,
	disabled,
	onCreated,
}: FolderCreationActionProps) {
	return (
		<MenuGroup
			role="menuitem"
			aria-haspopup="menu"
			text={context.mode === 'page' ? 'Create page' : 'Create index page'}
			icon={DocumentIcon}
			disabled={disabled}
			popover={{
				placement: 'right-start',
				fallbackPlacements: ['left-start'],
				portal: false,
				constrainSize: true,
				referenceBoundary: document.documentElement,
				floatingBoundary: document.documentElement,
			}}
		>
			<Box
				style={{
					width: 'max-content',
					minWidth: 'min(220px, 85vw)',
					maxWidth: 'min(320px, 85vw)',
					maxHeight: 'calc(100dvh - 32px)',
					overflowY: 'auto',
				}}
			>
				<PageCreationContent
					runtime={runtime}
					context={context}
					autoOpenSingle={false}
					onCreated={onCreated}
				/>
			</Box>
		</MenuGroup>
	)
}

/** Match the native creator's compact search popover, anchored to the local +. */
export function PageCreateDialog({
	runtime,
	anchor,
	onClose,
	onCreated,
	context,
}: {
	runtime: PagesRuntime
	anchor: HTMLButtonElement
	onClose: () => void
	onCreated: () => void
	context?: { mode: 'page' | 'index'; pathname: string } | undefined
}) {
	const id = useId()
	const panel = useRef<HTMLDivElement>(null)
	function close() {
		onClose()
		// Restore focus after the popover has released its focus lock.
		requestAnimationFrame(() => {
			if (anchor.isConnected) anchor.focus()
		})
	}
	useClickOutsideEvent(close, () => [anchor, panel.current])
	return (
		<Popover
			open
			portal
			modal
			constrainSize
			radius={3}
			placement="bottom-start"
			referenceElement={anchor}
			referenceBoundary={document.documentElement}
			floatingBoundary={document.documentElement}
			content={
				<FocusLock
					returnFocus={false}
					onActivation={() => {
						if (!panel.current?.querySelector('input, button:not(:disabled)'))
							panel.current?.focus()
					}}
					lockProps={{
						style: { display: 'flex', flexDirection: 'column', minHeight: 0 },
					}}
				>
					<Box
						ref={panel}
						id={`${id}-create-page`}
						role="dialog"
						aria-label="Create page"
						aria-modal="true"
						tabIndex={-1}
						style={{
							width: 'min(320px, 90vw)',
							maxHeight: 'calc(100dvh - 32px)',
							minHeight: 0,
							overflowY: 'auto',
							outline: 'none',
						}}
						onKeyDown={(event) => {
							if (event.key === 'Escape' || event.key === 'Tab') {
								event.preventDefault()
								event.stopPropagation()
								close()
							}
						}}
					>
						<PageCreationContent
							runtime={runtime}
							context={context}
							onCreated={onCreated}
						/>
					</Box>
				</FocusLock>
			}
		/>
	)
}
