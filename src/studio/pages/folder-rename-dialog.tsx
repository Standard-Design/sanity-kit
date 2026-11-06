/**
 * Review a folder's URL impact before sending the guarded rename. The controller
 * owns permissions, fresh evidence and atomic writes; this dialog owns explicit
 * editor consent and keeps an uncertain outcome separate from a retryable check.
 * See docs/folders.md for the URL-only publication and recovery rules.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
	Box,
	Button,
	Card,
	Checkbox,
	Dialog,
	Flex,
	Spinner,
	Stack,
	Text,
	TextInput,
} from '@sanity/ui'
import { CheckmarkCircleIcon } from '@sanity/icons/CheckmarkCircle'
import type {
	createFolderRenameController,
	FolderRenameReview,
	FolderRenameReviewResult,
	FolderRenameWriteResult,
} from '../folders/rename-write.js'

function explanation(reason: string) {
	if (reason === 'review-stale' || reason === 'conflict')
		return 'Pages, folders, or redirects changed after this review. Review the latest URLs before applying the rename.'
	if (reason === 'conflicting-draft-url')
		return 'An affected page already has a different URL planned in its draft. Resolve that draft URL first so this rename does not overwrite planned work.'
	if (reason === 'release-version')
		return 'An affected page or redirect has a Content Release version. This rename workflow cannot yet coordinate release URLs. Finish the planned release and review again, or keep the current folder name for now.'
	if (reason === 'url-collision' || reason === 'destination-folder-exists')
		return 'The new location is already used by another page or folder. Choose a different name, or resolve that existing location before reviewing again.'
	if (reason === 'collection-boundary')
		return 'This change would move into or across a collection location. Collection prefixes are managed separately. Choose another folder name or update the collection settings through their own workflow.'
	if (reason === 'reserved-path')
		return 'The app reserves the proposed URL. Choose a different name, or ask a developer to review the reserved routes.'
	if (reason === 'invalid-folder' || reason === 'unchanged-name')
		return 'Enter a different valid folder name using one URL segment, without slashes, spaces, a query, or a fragment.'
	if (reason === 'folder-not-found')
		return 'This folder is no longer in the saved folder list. Close this dialog, sync folders from the Pages menu if needed, and select the current folder.'
	if (reason === 'redirect-conflict')
		return 'The rename conflicts with an existing redirect or its unpublished changes. Review the affected redirect before trying again. No URLs have changed.'
	if (reason.includes('access') || reason === 'permission-denied')
		return 'We could not confirm permission to read or change everything this rename affects. Ask someone who manages project permissions to review the requirements below. No rename was sent.'
	if (reason === 'protected-url')
		return 'An affected document or URL field is read-only. Review its schema settings before trying again.'
	if (reason.includes('limit') || reason === 'request-size-limit')
		return 'This rename affects more data than the supported single-save limit. No partial changes were made. Ask a developer to review the affected pages and redirects and arrange a larger move.'
	if (reason.startsWith('recovery-'))
		return 'Recovery information could not be read or safely saved in this browser tab. A rename cannot start without it. Check browser storage access; if a previous save may be pending, ask a developer to verify it before clearing any recovery data.'
	if (reason === 'request-rejected')
		return 'Sanity rejected the save, so the rename was not applied. Review the latest data and try again. If it continues, ask a developer to check the request.'
	if (reason === 'configuration')
		return 'This Studio is not configured to rename these folders safely. Ask a developer to check the routing and write-permission integration.'
	if (reason.includes('invalid') || reason.includes('incomplete'))
		return 'Some folder, page, or redirect data could not be checked safely. Review the saved data with a developer or Studio administrator before trying again.'
	return 'We could not finish checking the rename. Check your connection and review again. No new rename was sent.'
}

/** Compact review row: normal source label, then removed/added URL values. */
function UrlChange({
	label,
	before,
	after,
	redirect = false,
}: {
	label: string
	before: string
	after: string
	/** Redirects keep their source; only their destination changes. */
	redirect?: boolean
}) {
	return (
		<Card border radius={2} style={{ overflow: 'hidden' }}>
			<Card muted padding={3}>
				<Stack gap={2}>
					{redirect && (
						<Text size={0} muted>
							Redirect from
						</Text>
					)}
					<Text size={1} weight="medium" style={{ overflowWrap: 'anywhere' }}>
						{label}
					</Text>
				</Stack>
			</Card>
			<Stack padding={3} gap={3}>
				{redirect && (
					<Text size={0} muted>
						Destination
					</Text>
				)}
				<Card tone="critical" style={{ background: 'transparent' }}>
					<Text size={1} style={{ overflowWrap: 'anywhere' }}>
						{redirect && <span aria-hidden="true">→ </span>}
						<span
							aria-label={redirect ? 'Previous destination' : 'Previous URL'}
							style={{ textDecoration: 'line-through' }}
						>
							{before}
						</span>
					</Text>
				</Card>
				<Card tone="positive" style={{ background: 'transparent' }}>
					<Text size={1} weight="medium" style={{ overflowWrap: 'anywhere' }}>
						{redirect && <span aria-hidden="true">→ </span>}
						<span aria-label={redirect ? 'New destination' : 'New URL'}>
							{after}
						</span>
					</Text>
				</Card>
			</Stack>
		</Card>
	)
}

type Result =
	| Exclude<FolderRenameReviewResult, { status: 'ready' }>
	| FolderRenameWriteResult
interface FolderRenameDialogProps {
	pathname?: string
	controller: ReturnType<typeof createFolderRenameController>
	onClose: () => void
	onSettled: () => void
}

/**
 * Each controller/target owns one mounted review session. Replacing a schema,
 * client or permission source must discard the old review and busy state, even
 * when the visible pathname is unchanged. The controller's durable pending
 * receipt survives this UI remount and is read again by the new session.
 */
export function FolderRenameDialog(props: FolderRenameDialogProps) {
	const { controller, pathname } = props
	const sessionKey = useMemo(() => crypto.randomUUID(), [controller, pathname])
	return <FolderRenameDialogSession key={sessionKey} {...props} />
}

function FolderRenameDialogSession({
	pathname,
	controller,
	onClose,
	onSettled,
}: FolderRenameDialogProps) {
	const [name, setName] = useState(pathname?.split('/').at(-1) ?? '')
	const [redirects, setRedirects] = useState(true)
	const [review, setReview] = useState<FolderRenameReview>()
	const [initialRecovery] = useState(() => {
		try {
			return { pending: controller.getPending(), invalid: false }
		} catch {
			return { pending: null, invalid: true }
		}
	})
	const [result, setResult] = useState<Result | undefined>(
		initialRecovery.invalid
			? { status: 'blocked', reason: 'recovery-invalid' }
			: undefined,
	)
	const [busy, setBusy] = useState<'review' | 'apply' | 'reconcile'>()
	const [pending, setPending] = useState(initialRecovery.pending)
	const epoch = useRef(0)
	const request = useRef<AbortController | undefined>(undefined)
	const inFlight = useRef(false)
	const mounted = useRef(true)
	useEffect(() => {
		mounted.current = true
		return () => {
			mounted.current = false
			epoch.current++
			request.current?.abort()
		}
	}, [controller])
	const unknown = result?.status === 'unknown' || !!pending
	const done = result?.status === 'renamed'
	const blocked = result?.status === 'blocked' ? result : undefined
	const reason =
		blocked?.reason ??
		(result?.status === 'rejected' ? result.reason : undefined)
	function invalidate() {
		epoch.current++
		request.current?.abort()
		setReview(undefined)
		setResult(undefined)
	}
	async function check() {
		if (inFlight.current || !pathname || unknown) return
		const version = ++epoch.current
		const abort = new AbortController()
		request.current = abort
		inFlight.current = true
		setBusy('review')
		setReview(undefined)
		setResult(undefined)
		try {
			const next = await controller.review(
				{ pathname, newName: name, createRedirects: redirects },
				abort.signal,
			)
			if (!mounted.current || epoch.current !== version) return
			if (next.status === 'ready') setReview(next.review)
			else setResult(next)
		} catch {
			if (mounted.current && epoch.current === version)
				setResult({ status: 'blocked', reason: 'request-failed' })
		} finally {
			inFlight.current = false
			if (mounted.current && epoch.current === version) setBusy(undefined)
		}
	}
	async function save(reconcile = false) {
		if (inFlight.current || (!reconcile && !review)) return
		const version = ++epoch.current
		const accepted = review
		inFlight.current = true
		setBusy(reconcile ? 'reconcile' : 'apply')
		try {
			const next = reconcile
				? await controller.reconcile()
				: await controller.apply(accepted!, {
						isCurrent: () => mounted.current && epoch.current === version,
					})
			if (!mounted.current || epoch.current !== version) return
			setResult(next)
			if (next.status === 'renamed' || next.status === 'rejected') {
				setPending(null)
				setReview(undefined)
				onSettled()
			} else if (next.status === 'unknown') {
				setPending(controller.getPending())
				setReview(undefined)
			} else setReview(undefined)
		} catch {
			if (mounted.current && epoch.current === version) {
				// A thrown apply is not evidence that the write failed. Recovery storage is
				// saved before dispatch; never offer another write while it is present.
				try {
					const value = controller.getPending()
					setPending(value)
					setResult(
						value
							? { status: 'unknown', operationId: value.operationId }
							: { status: 'blocked', reason: 'request-failed' },
					)
				} catch {
					setResult({ status: 'blocked', reason: 'recovery-invalid' })
				}
			}
		} finally {
			inFlight.current = false
			if (mounted.current && epoch.current === version) setBusy(undefined)
		}
	}
	const plan = review?.plan
	const liveCount =
		plan?.pageChanges.filter((change) => change.version === 'published')
			.length ?? 0
	return (
		<Dialog
			id="pages-folder-rename"
			header={unknown ? 'Check folder rename' : 'Rename folder'}
			width={2}
			{...(!busy ? { onClose, onClickOutside: onClose } : {})}
			footer={
				<Flex justify="flex-end" gap={2} padding={3}>
					<Button
						mode="bleed"
						text={done || unknown ? 'Close' : 'Cancel'}
						disabled={!!busy}
						onClick={onClose}
					/>
					{!done &&
						(unknown ? (
							<Button
								text="Check rename status"
								disabled={!!busy}
								onClick={() => void save(true)}
							/>
						) : review ? (
							<Button
								text="Apply URL changes"
								tone="primary"
								disabled={!!busy}
								onClick={() => void save()}
							/>
						) : (
							<Button
								text="Review URL changes"
								disabled={!!busy || !pathname || !name.trim()}
								onClick={() => void check()}
							/>
						))}
				</Flex>
			}
		>
			<Stack padding={4} gap={4}>
				{unknown && (
					<Card tone="caution" padding={3} radius={2} role="alert">
						<Stack gap={3}>
							<Text size={1} weight="semibold">
								Rename status is unconfirmed
							</Text>
							<Text size={1}>
								We do not yet know whether this folder and its URLs changed.
								Check the saved result before trying another rename. Checking
								does not repeat the save.
							</Text>
							{pending && (
								<Text size={1} style={{ overflowWrap: 'anywhere' }}>
									{pending.oldPathname} → {pending.newPathname}
								</Text>
							)}
							<Text size={1}>
								You can close this dialog and check again from the Pages menu.
								If the result stays unconfirmed, ask a developer or Studio
								administrator to verify the saved operation.
							</Text>
						</Stack>
					</Card>
				)}
				{reason && (
					<Card
						tone={
							reason === 'review-stale' || reason === 'conflict'
								? 'caution'
								: 'critical'
						}
						padding={3}
						radius={2}
						role="alert"
					>
						<Stack gap={3}>
							<Text size={1} weight="semibold">
								{reason === 'review-stale' || reason === 'conflict'
									? 'Review out of date'
									: 'Folder could not be renamed'}
							</Text>
							<Text size={1}>{explanation(reason)}</Text>
							{blocked?.planFailure?.pathname && (
								<Text
									size={1}
									weight="medium"
									style={{ overflowWrap: 'anywhere' }}
								>
									{blocked.planFailure.pathname}
								</Text>
							)}
							{blocked?.accessIssues?.map((issue) => (
								<Text key={issue.key} size={1}>
									{issue.label} (
									{issue.status === 'missing' ? 'not granted' : 'unverified'})
								</Text>
							))}
						</Stack>
					</Card>
				)}
				{busy && (
					<Flex
						align="center"
						justify="center"
						gap={3}
						padding={3}
						role="status"
					>
						<Spinner muted />
						<Text size={1}>
							{busy === 'review'
								? 'Checking folder URLs…'
								: busy === 'apply'
									? 'Saving URL changes…'
									: 'Checking rename result…'}
						</Text>
					</Flex>
				)}
				{done ? (
					<Flex justify="center" align="center" gap={3} role="status">
						<Card tone="positive" style={{ background: 'transparent' }}>
							<Text size={3}>
								<CheckmarkCircleIcon aria-hidden />
							</Text>
						</Card>
						<Text size={2} weight="semibold">
							Folder renamed
						</Text>
					</Flex>
				) : (
					!unknown && (
						<>
							<Card border muted padding={3} radius={2}>
								<Text
									size={2}
									weight="semibold"
									style={{ overflowWrap: 'anywhere' }}
								>
									{pathname}
								</Text>
							</Card>
							<Stack gap={3}>
								<Text
									as="label"
									htmlFor="folder-rename-name"
									size={1}
									weight="medium"
								>
									New folder name
								</Text>
								<TextInput
									id="folder-rename-name"
									value={name}
									readOnly={!!busy}
									onChange={(event) => {
										invalidate()
										setName(event.currentTarget.value)
									}}
								/>
							</Stack>
							<Text size={1} muted>
								Rename this folder and update the URLs beneath it. Its parent
								folder stays the same.
							</Text>
							<Flex align="center" gap={3}>
								<Checkbox
									id="folder-rename-redirects"
									checked={redirects}
									disabled={!!busy}
									onChange={(event) => {
										invalidate()
										setRedirects(event.currentTarget.checked)
									}}
								/>
								<Box flex={1}>
									<Text as="label" htmlFor="folder-rename-redirects" size={1}>
										Create redirects from old URLs
									</Text>
								</Box>
							</Flex>
							{!redirects && (
								<Text size={1} muted>
									Old page URLs will stop working unless another app rule
									handles them. Existing redirects to these pages still follow
									the new URLs.
								</Text>
							)}
							{plan && (
								<>
									<UrlChange
										label="Folder location"
										before={plan.oldPathname}
										after={plan.newPathname}
									/>
									<Card
										tone={liveCount ? 'caution' : 'transparent'}
										padding={3}
										radius={2}
									>
										<Text size={1}>
											{liveCount
												? `${liveCount} published page${liveCount === 1 ? '' : 's'} will use the new URLs immediately. Only URL fields change; unrelated draft edits stay unpublished.`
												: 'No published page URLs will change. Draft pages remain unpublished.'}
										</Text>
									</Card>
									{plan.pageChanges.length > 0 && (
										<Stack gap={3}>
											<Text size={1} weight="semibold">
												Affected page URLs
											</Text>
											{plan.pageChanges.map((change) => (
												<UrlChange
													key={change.id}
													label={
														change.version === 'published'
															? 'Published page'
															: 'Draft page'
													}
													before={change.oldPathname}
													after={change.newPathname}
												/>
											))}
										</Stack>
									)}
									{plan.folderChanges.length > 1 && (
										<Stack gap={3}>
											<Text size={1} weight="semibold">
												Nested folders
											</Text>
											{plan.folderChanges
												.filter(
													(change) => change.oldPathname !== plan.oldPathname,
												)
												.map((change) => (
													<UrlChange
														key={change.key}
														label="Folder"
														before={change.oldPathname}
														after={change.newPathname}
													/>
												))}
										</Stack>
									)}
									{plan.redirects.creates.length > 0 && (
										<Stack gap={3}>
											<Text size={1} weight="semibold">
												New redirects
											</Text>
											{plan.redirects.creates.map((change) => (
												<Card key={change.source} border padding={3} radius={2}>
													<Text size={1} style={{ overflowWrap: 'anywhere' }}>
														{change.source} → {change.destination}
													</Text>
												</Card>
											))}
										</Stack>
									)}
									{plan.redirects.updates.length > 0 && (
										<Stack gap={3}>
											<Text size={1} weight="semibold">
												Existing redirects
											</Text>
											<Text size={1} muted>
												These redirects will point directly to the new URLs,
												even when creating new redirects is turned off.
											</Text>
											{plan.redirects.updates.map((change) => (
												<UrlChange
													key={change.id}
													redirect
													label={change.source}
													before={change.oldDestination}
													after={change.newDestination}
												/>
											))}
										</Stack>
									)}
								</>
							)}
						</>
					)
				)}
			</Stack>
		</Dialog>
	)
}
