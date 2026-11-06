/**
 * Extend the Studio's own Publish action. Ordinary publishing keeps its native
 * behavior. A changed live URL is reviewed here and sent to the publication
 * controller, which commits the page and optional redirect together.
 */
import {
	Box,
	Button,
	Card,
	Checkbox,
	Flex,
	Spinner,
	Stack,
	Text,
} from '@sanity/ui'
import { useToast } from '@sanity/ui/toast'
import { DocumentIcon } from '@sanity/icons/Document'
import { TransferIcon } from '@sanity/icons/Transfer'
import { PageStatus } from '../pages/document-status.js'
import type { UrlPublicationLimit } from './publication-limits.js'
import {
	PublicationLimitNotice,
	isRedirectDataError,
	redirectDataExplanation,
	redirectDataTitle,
} from './publication-limit-notice.js'
import type { UrlAccessIssue } from './access.js'
import { UrlAccessNotice } from './access-notice.js'
import { IntentLink, StateLink } from 'sanity/router'
import { usePresentationParams } from 'sanity/presentation'
import {
	useEffect,
	useMemo,
	useRef,
	useState,
	type ComponentProps,
} from 'react'
import {
	getPublishedId,
	useClient,
	useSyncState,
	useValidationStatus,
	type DocumentActionComponent,
} from 'sanity'
import {
	createPagesRegistry,
	type PagesRouteConfig,
} from '../../url/registry.js'
import { createSanityUrlResolver } from '../../url/resolve.js'
import {
	createUrlPublicationController,
	type UrlPublicationReview,
	type UrlPublicationConflict,
} from './publication.js'
import {
	getUrlPublicationBlocked,
	useUrlPublicationBlocked,
} from './publication-state.js'

/** Highlight the URL text with Studio tones, without filling the entire row. */
export function RedirectDestination({
	value,
	previous = false,
	label,
}: {
	readonly value: string
	readonly previous?: boolean
	/** Other redirect fields reuse the same review treatment with their own name. */
	readonly label?: string
}) {
	return (
		<Text size={1} style={{ overflowWrap: 'anywhere' }}>
			<Card
				as={previous ? 'del' : 'ins'}
				role="group"
				aria-label={
					label ?? (previous ? 'Previous destination' : 'New destination')
				}
				tone={previous ? 'critical' : 'positive'}
				radius={1}
				style={{
					display: 'inline',
					padding: '1px 3px',
					boxDecorationBreak: 'clone',
					WebkitBoxDecorationBreak: 'clone',
					textDecoration: previous ? 'line-through' : 'none',
				}}
			>
				{value}
			</Card>
		</Text>
	)
}

/** Keep document links inside Presentation when the review was opened there. */
function ConflictRecordLink({
	documentId,
	schemaType,
	perspective,
	...anchorProps
}: Omit<ComponentProps<'a'>, 'href'> & {
	documentId: string
	schemaType: string
	perspective: string
}) {
	const presentation = usePresentationParams(false)
	if (presentation) {
		// Preserve the website preview and viewport, but not the previous document's
		// field, inspector, template, or reference parameters.
		return (
			<StateLink
				{...anchorProps}
				state={{
					id: documentId,
					type: schemaType,
					_searchParams: Object.entries({
						...(presentation.preview ? { preview: presentation.preview } : {}),
						...(presentation.viewport
							? { viewport: presentation.viewport }
							: {}),
						...(presentation.perspective
							? { perspective: presentation.perspective }
							: {}),
						...(perspective !== 'drafts' && perspective !== 'published'
							? { version: perspective }
							: {}),
					}),
				}}
			/>
		)
	}
	return (
		<IntentLink
			{...anchorProps}
			intent="edit"
			params={{ id: documentId, type: schemaType, mode: 'structure' }}
			searchParams={
				perspective === 'drafts' ? [] : [['perspective', perspective]]
			}
		/>
	)
}

/** Use the same native row and version status for one conflict or several redirects. */
export function ConflictRecord({
	conflict,
	onOpen,
}: {
	readonly conflict: UrlPublicationConflict
	readonly onOpen: () => void
}) {
	const id = conflict?.documentId
	const perspective = id?.startsWith('versions.')
		? id.split('.')[1]!
		: id?.startsWith('drafts.')
			? 'drafts'
			: 'published'
	const version =
		perspective === 'published'
			? 'Published'
			: perspective === 'drafts'
				? 'Draft'
				: `Release: ${perspective}`
	// Share the navigator's row treatment and actual document-version status.
	// Redirects show the complete rule; the entire row opens its native editor.
	const recordContent =
		conflict && conflict.kind !== 'reserved' ? (
			<Flex align="center" gap={3} flex={1}>
				<Text size={1}>
					{conflict.kind === 'redirect' ? <TransferIcon /> : <DocumentIcon />}
				</Text>
				<Box flex={1} style={{ minWidth: 0 }}>
					<Stack gap={2}>
						<Text size={1} weight="medium" textOverflow="ellipsis">
							{conflict.kind === 'redirect'
								? conflict.pathname
								: conflict.title || 'Page title unavailable'}
						</Text>
						<Text size={1} muted style={{ overflowWrap: 'anywhere' }}>
							{conflict.kind === 'redirect'
								? `→ ${conflict.destination || 'Destination unavailable'}`
								: conflict.pathname}
						</Text>
					</Stack>
				</Box>
				{id && <PageStatus id={getPublishedId(id)} />}
			</Flex>
		) : null
	return id && conflict.schemaType ? (
		<Card
			as={ConflictRecordLink}
			documentId={getPublishedId(id)}
			schemaType={conflict.schemaType}
			perspective={perspective}
			// Custom link components need this for Card's native hover/focus styles.
			data-as="a"
			onClick={onOpen}
			__unstable_focusRing
			radius={2}
			tone="inherit"
			padding={2}
			aria-label={
				conflict.kind === 'redirect'
					? `Open redirect: ${conflict.pathname} → ${conflict.destination || 'Destination unavailable'} · ${version}`
					: `Open page: ${conflict.title || 'Page title unavailable'} · ${conflict.pathname} · ${version}`
			}
			style={{
				display: 'flex',
				alignItems: 'center',
				width: '100%',
				minHeight: 49,
				textAlign: 'left',
				textDecoration: 'none',
			}}
		>
			{recordContent}
		</Card>
	) : (
		<Box padding={2}>{recordContent}</Box>
	)
}

/** Keep record defects actionable without making a failed read look like bad content. */
function InvalidRedirectNotice({
	issue,
	conflict,
	onOpen,
}: {
	readonly issue?: string
	readonly conflict?: UrlPublicationConflict
	readonly onOpen: () => void
}) {
	const graph = issue === 'redirect-chain' || issue === 'redirect-cycle'
	const rowsLabel =
		issue === 'duplicate-source'
			? 'Redirects using this URL'
			: graph
				? 'Connected redirects'
				: 'Affected redirect'
	return (
		<Card tone="critical" padding={4} radius={2} role="alert">
			<Stack gap={4}>
				<Text size={2} weight="semibold">
					{redirectDataTitle(issue)}
				</Text>
				<Text size={1}>
					This issue must be resolved before SanityKit can finish checking this
					URL change.
				</Text>
				{conflict && (
					<Card tone="default" border radius={2}>
						<Stack gap={3} padding={3}>
							<Text size={0} muted>
								Affected URL
							</Text>
							<Text
								size={2}
								weight="semibold"
								style={{ overflowWrap: 'anywhere' }}
							>
								{conflict.pathname}
							</Text>
						</Stack>
						{!!conflict.fieldIssues?.length && (
							<Card borderTop padding={3}>
								<Stack gap={4}>
									{conflict.fieldIssues.map((problem, index) => (
										<Stack key={`${problem.field}-${index}`} gap={3}>
											<Text size={1} weight="semibold">
												{problem.field}
											</Text>
											<Text size={1} muted style={{ overflowWrap: 'anywhere' }}>
												Current value: {problem.value}
											</Text>
											<Text size={1}>{problem.message}</Text>
										</Stack>
									))}
								</Stack>
							</Card>
						)}
						<Card borderTop padding={2}>
							<Box padding={1} marginBottom={2}>
								<Text size={0} muted>
									{rowsLabel}
								</Text>
							</Box>
							<Box style={{ maxHeight: 320, overflowY: 'auto' }}>
								<Stack gap={1}>
									<ConflictRecord conflict={conflict} onOpen={onOpen} />
									{conflict.relatedRedirects?.map((redirect) => (
										<ConflictRecord
											key={redirect.documentId}
											conflict={{
												...redirect,
												kind: 'redirect',
												schemaType: 'sanityKitRedirect',
											}}
											onOpen={onOpen}
										/>
									))}
								</Stack>
							</Box>
						</Card>
						{conflict.finalDestination && (
							<Stack gap={3} padding={3}>
								<Text size={0} muted>
									Final destination
								</Text>
								<Text size={1} style={{ overflowWrap: 'anywhere' }}>
									{conflict.finalDestination}
								</Text>
							</Stack>
						)}
						{!!conflict.relatedPages?.length && (
							<Card borderTop padding={2}>
								<Box padding={1} marginBottom={2}>
									<Text size={0} muted>
										{conflict.relatedPages.length === 1
											? 'Page using this URL'
											: 'Pages using this URL'}
									</Text>
								</Box>
								<Stack gap={1}>
									{conflict.relatedPages.map((page) => (
										<ConflictRecord
											key={page.documentId}
											conflict={{ ...page, kind: 'page' }}
											onOpen={onOpen}
										/>
									))}
								</Stack>
							</Card>
						)}
					</Card>
				)}
				<Text size={1}>{redirectDataExplanation(issue)}</Text>
			</Stack>
		</Card>
	)
}

/** Show the actual blocking record instead of asking editors to find it themselves. */
function PublicationError({
	limit,
	redirectIssue,
	message,
	reason,
	conflict,
	accessIssues,
	onOpen,
	onRetry,
	retryDisabled = false,
}: {
	readonly limit?: UrlPublicationLimit
	readonly redirectIssue?: string
	readonly message: string
	readonly reason?: string
	readonly conflict?: UrlPublicationConflict
	readonly accessIssues?: readonly UrlAccessIssue[]
	readonly onOpen: () => void
	readonly onRetry?: () => void
	readonly retryDisabled?: boolean
}) {
	if (limit) return <PublicationLimitNotice limit={limit} />
	if (isRedirectDataError(reason))
		return (
			<InvalidRedirectNotice
				{...(redirectIssue ? { issue: redirectIssue } : {})}
				{...(conflict ? { conflict } : {})}
				onOpen={onOpen}
			/>
		)
	if (accessIssues?.length)
		return <UrlAccessNotice issues={accessIssues} operation="publish" />
	if (reason === 'release-version')
		return (
			<Card tone="critical" padding={4} radius={2} role="alert">
				<Stack gap={4}>
					<Text size={2} weight="semibold">
						This URL change is blocked because the page belongs to a release
					</Text>
					<Text size={1}>
						This page also has a version in a Content Release. Changing its URL
						here could conflict with that version when the release is published.
						SanityKit does not yet handle these release conflicts.
					</Text>
					<Text size={1}>
						To publish other edits now, keep the current live URL. To change the
						URL, finish the planned release first and try again once this page
						no longer has a release version.
					</Text>
					<Text size={1}>
						If the page no longer needs to be in the release, you can remove it
						from that release. Keep any planned work you still need; removing it
						is not required just to continue editing.
					</Text>
				</Stack>
			</Card>
		)

	const pendingRedirect = reason === 'pending-redirect-change'
	return (
		<Card tone="critical" padding={4} radius={2} role="alert">
			<Stack gap={4}>
				<Text size={2} weight="semibold">
					{pendingRedirect
						? 'Unpublished redirect changes conflict with this URL'
						: conflict?.kind === 'page'
							? 'URL already in use'
							: conflict?.kind === 'redirect'
								? 'This URL is used by a redirect'
								: conflict?.kind === 'reserved'
									? 'URL reserved by the application'
									: onRetry
										? 'Review could not be loaded'
										: 'This page cannot be published yet'}
				</Text>
				{conflict ? (
					<>
						{conflict.kind === 'page' && (
							<Text size={1}>
								Another page already uses the URL you want to publish. Each page
								needs its own URL so visitors reach the right content. This page
								cannot be published at that address until the conflict is
								resolved.
							</Text>
						)}
						{reason === 'target-is-redirect' && (
							<Text size={1}>
								The new URL already has a redirect that sends visitors to
								another address. This page cannot use that URL while the
								redirect is active.
							</Text>
						)}
						{pendingRedirect && (
							<Text size={1}>
								A redirect connected to this URL change has unpublished edits.
								Publishing this page now could conflict with those edits, so the
								redirect needs to be reviewed first.
							</Text>
						)}
						{/* Separate the URL and its owner from the explanation and next step. */}
						<Card tone="default" border radius={2}>
							<Stack gap={3} padding={3}>
								<Text size={0} muted>
									{pendingRedirect ? 'Affected URL' : 'Conflicting URL'}
								</Text>
								<Text
									size={2}
									weight="semibold"
									style={{ overflowWrap: 'anywhere' }}
								>
									{conflict.pathname}
								</Text>
							</Stack>
							{conflict.kind !== 'reserved' && (
								<Card borderTop padding={2}>
									<Box padding={1} marginBottom={2}>
										<Text size={0} muted>
											{pendingRedirect
												? 'Redirect with unpublished changes'
												: conflict.kind === 'redirect'
													? conflict.relatedRedirects?.length
														? 'Redirects using this URL'
														: 'Redirect using this URL'
													: 'Page using this URL'}
										</Text>
									</Box>
									<Stack gap={1}>
										<ConflictRecord conflict={conflict} onOpen={onOpen} />
										{conflict.relatedRedirects?.map((redirect) => (
											<ConflictRecord
												key={redirect.documentId}
												conflict={{
													...redirect,
													kind: 'redirect',
													schemaType: 'sanityKitRedirect',
												}}
												onOpen={onOpen}
											/>
										))}
									</Stack>
								</Card>
							)}
						</Card>
						{conflict.kind === 'page' && (
							<Text size={1}>
								Choose a different URL, or change the URL of the page above to
								make this one available.
							</Text>
						)}
						{conflict.kind === 'redirect' && <Text size={1}>{message}</Text>}
						{conflict.kind === 'reserved' && (
							<Text size={1}>
								Choose a different URL, or ask a developer to change the
								application’s routing configuration.
							</Text>
						)}
					</>
				) : (
					<Text size={1}>{message}</Text>
				)}
				{onRetry && (
					<Box>
						<Button
							text="Retry"
							mode="ghost"
							onClick={onRetry}
							disabled={retryDisabled}
						/>
					</Box>
				)}
			</Stack>
		</Card>
	)
}

/** Keep failure wording editorial; detailed result codes stay in the controller. */
function failureMessage(reason: string): string {
	if (reason.includes('permission') || reason.includes('access'))
		return 'We could not verify the access needed for this URL change. Check your connection and try again. If this continues, contact someone who manages project permissions to check your access.'
	if (reason === 'release-version')
		return 'SanityKit does not yet handle URL changes for pages with release versions.'
	if (reason.includes('conflict') || reason.includes('occupied'))
		return 'This URL conflicts with another page or redirect. Choose a different URL or resolve the conflict first.'
	if (reason === 'pending-redirect-change')
		return 'Publish or discard the redirect’s pending changes, then try publishing this page again.'
	if (reason.includes('limit') || reason === 'too-many-redirect-updates')
		return 'This URL change exceeds the limits for publishing this page. Review the affected redirects or ask a developer to expand the workflow.'
	if (reason === 'target-is-redirect')
		return 'Retire the conflicting redirect or choose another URL.'
	if (
		reason.includes('changed') ||
		reason.includes('stale') ||
		reason.includes('revision')
	)
		return 'The document or routing information changed. Close this dialog and publish again to review the latest version.'
	return 'The URL change could not be prepared or published. Close this dialog and try again after checking your connection.'
}

export function createUrlPublishAction(
	NativeAction: DocumentActionComponent,
	routes: PagesRouteConfig,
	options: { readonly reservedPaths?: readonly string[] } = {},
): DocumentActionComponent {
	const registry = createPagesRegistry(routes)
	const resolve = createSanityUrlResolver(routes)
	const PublishAction: DocumentActionComponent = (props) => {
		// Calling the supplied action preserves native permission, lock, validation,
		// perspective, and shortcut behavior. It is the supported Studio extension
		// pattern; never import Sanity's private PublishAction implementation.
		const native = NativeAction(props)
		const toast = useToast()
		const client = useClient({ apiVersion: '2026-10-01' })
		const controller = useMemo(
			() => createUrlPublicationController(routes, client, options),
			[client, props.id],
		)
		const scope = {
			projectId: client.config().projectId ?? '',
			dataset: client.config().dataset ?? '',
			documentId: props.id,
		}
		const localPending = useUrlPublicationBlocked(scope)
		const sync = useSyncState(props.id, props.type)
		const validation = useValidationStatus(
			props.draft?._id ?? props.id,
			props.type,
			true,
		)
		const registered = registry.types.some(
			(type) => type.schemaType === props.type,
		)
		const oldUrl = props.published ? resolve(props.published) : undefined
		const newUrl = props.draft ? resolve(props.draft) : undefined
		const changed =
			registered &&
			!!props.published &&
			!!props.draft &&
			oldUrl?.ok === true &&
			newUrl?.ok === true &&
			oldUrl.value.pathname !== newUrl.value.pathname
		const invalid =
			registered &&
			!!props.published &&
			!!props.draft &&
			(oldUrl?.ok !== true || newUrl?.ok !== true)
		const unsupported =
			changed && !!(props.liveEdit || props.release || props.version)
		const ready =
			!!native &&
			!native.disabled &&
			!native.dialog &&
			!localPending &&
			!sync.isSyncing &&
			!validation.isValidating &&
			validation.revision === props.draft?._rev &&
			!validation.validation.some((marker) => marker.level === 'error') &&
			!unsupported &&
			!invalid
		const [review, setReview] = useState<UrlPublicationReview | null>(null)
		const [createRedirect, setCreateRedirect] = useState(true)
		const [checkingResult, setCheckingResult] = useState(false)
		const [dismissed, setDismissed] = useState(false)
		const [phase, setPhase] = useState<
			'idle' | 'reviewing' | 'publishing' | 'unknown'
		>('idle')
		const [error, setError] = useState<string>()
		const [errorReason, setErrorReason] = useState<string>()
		const [limit, setLimit] = useState<UrlPublicationLimit>()
		const [redirectIssue, setRedirectIssue] = useState<string>()
		const [reviewFailed, setReviewFailed] = useState(false)
		const [conflict, setConflict] = useState<UrlPublicationConflict>()
		const [accessIssues, setAccessIssues] =
			useState<readonly UrlAccessIssue[]>()
		const state = {
			props,
			native,
			ready,
			scope,
			changed,
			controller,
			phase,
			review,
			error,
			errorReason,
			limit,
			reviewFailed,
			accessIssues,
			invalid,
			unsupported,
			oldPathname: oldUrl?.ok ? oldUrl.value.pathname : undefined,
			newPathname: newUrl?.ok ? newUrl.value.pathname : undefined,
		}
		const current = useRef(state)
		current.current = state
		const alive = useRef(true)
		const inFlight = useRef(false)
		const abort = useRef<AbortController | undefined>(undefined)
		useEffect(() => {
			alive.current = true
			inFlight.current = false
			setCheckingResult(false)
			restorePending(true)
			return () => {
				alive.current = false
				abort.current?.abort()
			}
		}, [controller])
		const canReport = () =>
			alive.current && current.current.controller === controller
		const isCurrent = (value: UrlPublicationReview) => {
			const state = current.current
			return (
				canReport() &&
				state.ready &&
				state.changed &&
				state.review === value &&
				state.oldPathname === value.oldPathname &&
				state.newPathname === value.newPathname &&
				!getUrlPublicationBlocked(state.scope) &&
				state.props.id === value.documentId &&
				state.props.draft?._rev === value.draftRevision &&
				state.props.published?._rev === value.publishedRevision
			)
		}
		// A damaged recovery record must never silently turn into a fresh Publish.
		function restorePending(hide: boolean): boolean {
			try {
				const pending = controller.getPending(current.current.props.id)
				if (!hide && !pending) return false
				setReviewFailed(false)
				setAccessIssues(undefined)
				setReview(pending)
				if (pending) setCreateRedirect(pending.createRedirect)
				setError(
					pending
						? 'We could not confirm whether this page was published. Check its status before trying to publish again.'
						: undefined,
				)
				setDismissed(hide && !!pending)
				setPhase(pending ? 'unknown' : 'idle')
				return !!pending
			} catch {
				setAccessIssues(undefined)
				setReviewFailed(false)
				setReview(null)
				setError(
					'The saved information about the last attempt to publish this page could not be read. Verify whether the page and its redirects were updated before trying again. Ask a developer or Studio administrator for help if needed.',
				)
				setDismissed(hide)
				setPhase('unknown')
				return true
			}
		}
		function confirmed(value: UrlPublicationReview | null) {
			toast.push({
				status: 'success',
				title: 'Page published',
				description: value
					? `Published at ${value.newPathname}. The reviewed redirect changes have been applied.`
					: 'The page is published and its reviewed redirect changes are confirmed.',
				duration: 9000,
				closable: true,
			})
			setReview(null)
			setError(undefined)
			setConflict(undefined)
			setErrorReason(undefined)
			setLimit(undefined)
			setRedirectIssue(undefined)
			setAccessIssues(undefined)
			setPhase('idle')
			setDismissed(false)
			current.current.props.onComplete()
		}
		const close = () => {
			if (current.current.phase === 'publishing') return
			if (current.current.phase === 'unknown') {
				setDismissed(true)
				return
			}
			abort.current?.abort()
			setReviewFailed(false)
			setReview(null)
			setError(undefined)
			setConflict(undefined)
			setErrorReason(undefined)
			setLimit(undefined)
			setRedirectIssue(undefined)
			setAccessIssues(undefined)
			setPhase('idle')
		}
		// Retry is limited to failed read-only checks; it cannot retry a publication.
		async function begin(retry = false) {
			const state = current.current
			if (
				!canReport() ||
				!state.ready ||
				!state.changed ||
				state.phase !== 'idle' ||
				inFlight.current ||
				state.review ||
				(state.error && !(retry && state.reviewFailed)) ||
				(retry && !state.reviewFailed)
			)
				return
			const draftRevision = state.props.draft?._rev
			const publishedRevision = state.props.published?._rev
			if (!draftRevision || !publishedRevision) return
			abort.current?.abort()
			const request = new AbortController()
			abort.current = request
			inFlight.current = true
			setDismissed(false)
			setPhase('reviewing')
			setReviewFailed(false)
			setError(undefined)
			setConflict(undefined)
			setErrorReason(undefined)
			setLimit(undefined)
			setRedirectIssue(undefined)
			setAccessIssues(undefined)
			setCreateRedirect(true)
			try {
				const result = await controller.review(
					{ documentId: state.props.id, draftRevision, publishedRevision },
					request.signal,
				)
				if (!canReport() || request.signal.aborted) return
				if (result.status === 'ready') setReview(result.review)
				else {
					const failed = result.reason === 'request-failed'
					setReviewFailed(failed)
					setError(
						failed
							? 'The URL change could not be checked. Check your connection and retry.'
							: failureMessage(result.reason),
					)
					setConflict(result.conflict)
					setErrorReason(result.reason)
					setLimit(result.limit)
					setRedirectIssue(result.redirectIssue)
					setAccessIssues(result.accessIssues)
				}
			} catch {
				if (canReport() && !request.signal.aborted) {
					setReviewFailed(true)
					setError(
						'The URL change could not be checked. Check your connection and retry.',
					)
				}
			} finally {
				if (canReport()) {
					inFlight.current = false
					if (!request.signal.aborted) setPhase('idle')
				}
			}
		}
		async function publish() {
			if (
				!review ||
				!isCurrent(review) ||
				current.current.accessIssues?.length ||
				current.current.limit ||
				isRedirectDataError(current.current.errorReason) ||
				current.current.phase !== 'idle' ||
				inFlight.current
			)
				return
			inFlight.current = true
			setPhase('publishing')
			setError(undefined)
			setConflict(undefined)
			setErrorReason(undefined)
			setLimit(undefined)
			setRedirectIssue(undefined)
			setAccessIssues(undefined)
			try {
				const result = await controller.publish(review, {
					createRedirect,
					isCurrent: () => isCurrent(review),
				})
				if (!canReport()) return
				if (result.status === 'published') {
					confirmed(review)
				} else if (result.status === 'unknown') {
					setPhase('unknown')
					setError(
						'The connection ended before we received confirmation. Check publish status before trying again.',
					)
				} else {
					setError(failureMessage(result.reason))
					setConflict(result.conflict)
					setErrorReason(result.reason)
					setLimit(result.limit)
					setRedirectIssue(result.redirectIssue)
					setAccessIssues(result.accessIssues)
					setPhase('idle')
				}
			} catch {
				if (canReport()) {
					setPhase('unknown')
					setError(
						'We could not confirm whether this page was published. Check its status before trying to publish again.',
					)
				}
			} finally {
				if (canReport()) inFlight.current = false
			}
		}
		async function reconcile() {
			if (current.current.phase !== 'unknown' || inFlight.current) return
			inFlight.current = true
			setCheckingResult(true)
			try {
				const result = await controller.reconcile(props.id)
				if (!canReport()) return
				if (result.status === 'published') {
					confirmed(current.current.review)
				} else if (
					result.status === 'blocked' &&
					(result.reason === 'publication-rejected' ||
						result.reason === 'review-stale')
				) {
					// A definite server rejection is different from an absent receipt.
					// Report it even if the editor dismissed the pending check.
					toast.push({
						status: 'warning',
						title: 'Page was not published',
						description: 'Review the latest changes before publishing again.',
						duration: 9000,
						closable: true,
					})
					setReview(null)
					setPhase('idle')
					setError(undefined)
					setConflict(undefined)
					setErrorReason(undefined)
					setLimit(undefined)
					setRedirectIssue(undefined)
					setAccessIssues(undefined)
					setDismissed(false)
					current.current.props.onComplete()
				} else {
					setPhase('unknown')
					setError(
						'We still cannot confirm whether this page was published. Check again before trying to publish again.',
					)
				}
			} catch {
				if (canReport()) {
					setPhase('unknown')
					setError(
						'The result could not be checked. Check your connection and try again.',
					)
				}
			} finally {
				if (canReport()) {
					inFlight.current = false
					setCheckingResult(false)
				}
			}
		}
		if (!native || !registered) return native
		const stale = !!review && !isCurrent(review)
		const recovering = phase === 'unknown'
		const showingDialog =
			!dismissed && (!!review || !!error || phase === 'reviewing')
		return {
			...native,
			label: recovering ? 'Check publish status' : native.label,
			disabled: recovering
				? showingDialog
				: native.disabled ||
					localPending ||
					invalid ||
					unsupported ||
					phase !== 'idle' ||
					showingDialog ||
					(changed && !ready),
			title: recovering
				? 'Check whether the last attempt succeeded before publishing this page again.'
				: localPending
					? 'Wait for the URL edit to finish, or correct its error.'
					: invalid
						? 'The current or proposed URL cannot be resolved.'
						: unsupported
							? 'URL changes in releases and live-edit documents are not supported yet.'
							: native.title,
			onHandle: () => {
				if (!canReport()) return
				if (current.current.phase === 'unknown') {
					setDismissed(false)
					return
				}
				if (restorePending(false)) return
				if (
					current.current.native?.disabled ||
					current.current.phase !== 'idle' ||
					current.current.review ||
					current.current.error ||
					inFlight.current ||
					getUrlPublicationBlocked(current.current.scope)
				)
					return
				if (current.current.changed) {
					void begin()
				} else if (!current.current.invalid && !current.current.unsupported)
					current.current.native?.onHandle?.()
			},
			dialog: showingDialog
				? {
						type: 'dialog',
						header: 'Publish URL change',
						width: 'medium',
						onClose: close,
						showCloseButton: phase !== 'publishing',
						// Sanity supplies the dialog's content and footer padding. Keep this
						// hierarchy compact: page URL first, choice second, older redirects last.
						content: (
							<Box>
								<Stack gap={5}>
									{stale && !error && phase === 'idle' && (
										<Card tone="caution" padding={3} radius={2} role="alert">
											<Stack gap={3}>
												<Text size={1} weight="semibold">
													Review out of date
												</Text>
												<Text size={1}>
													The document changed. Close this dialog and publish
													again to review the latest version.
												</Text>
											</Stack>
										</Card>
									)}
									{error && phase !== 'unknown' && (
										<PublicationError
											message={error}
											{...(limit ? { limit } : {})}
											{...(redirectIssue ? { redirectIssue } : {})}
											{...(errorReason ? { reason: errorReason } : {})}
											{...(conflict ? { conflict } : {})}
											{...(accessIssues ? { accessIssues } : {})}
											onOpen={close}
											{...(reviewFailed
												? {
														onRetry: () => {
															void begin(true)
														},
														retryDisabled:
															!ready || !changed || phase !== 'idle',
													}
												: {})}
										/>
									)}
									{phase === 'unknown' && error && (
										<Card tone="caution" padding={3} radius={2} role="alert">
											<Stack gap={3}>
												<Text size={1} weight="semibold">
													Could not confirm this page was published
												</Text>
												<Text size={1}>{error}</Text>
												<Text size={1}>
													(You can keep working and return using Check publish
													status. If the result stays unclear, ask a developer
													or Studio administrator to verify the page and
													redirects before publishing again.)
												</Text>
											</Stack>
										</Card>
									)}
									{phase === 'reviewing' && (
										<Flex
											direction="column"
											align="center"
											justify="center"
											gap={3}
											paddingY={4}
											role="status"
										>
											<Spinner muted />
											<Text size={1} align="center">
												Checking the URL change…
											</Text>
										</Flex>
									)}
									{review && (
										<>
											<Stack gap={4}>
												<Card border radius={2} padding={4}>
													<Stack gap={4}>
														<Stack gap={2}>
															<Text size={1} muted>
																From
															</Text>
															<Text
																size={2}
																style={{ overflowWrap: 'anywhere' }}
															>
																{review.oldPathname}
															</Text>
														</Stack>
														<Stack gap={2}>
															<Text size={1} muted>
																To
															</Text>
															<Text
																size={2}
																weight="semibold"
																style={{ overflowWrap: 'anywhere' }}
															>
																{review.newPathname}
															</Text>
														</Stack>
													</Stack>
												</Card>
												<Stack gap={3}>
													<Flex as="label" align="center" gap={3}>
														<Checkbox
															checked={createRedirect}
															disabled={phase !== 'idle'}
															onChange={(event) =>
																setCreateRedirect(event.currentTarget.checked)
															}
														/>
														<Text size={1}>
															Redirect the old URL to the new URL
														</Text>
													</Flex>
													{!createRedirect && (
														<Text size={1} muted>
															The old URL will not automatically forward to the
															new URL.
														</Text>
													)}
												</Stack>
											</Stack>
											{review.affectedRedirects.length > 0 && (
												<Stack gap={3}>
													<Text size={1} weight="semibold">
														Existing redirects ·{' '}
														{review.affectedRedirects.length}
													</Text>
													<Text size={1} muted>
														Existing redirects for this page will be updated to
														the new destination URL, even if the checkbox above
														is unchecked.
													</Text>
													<Stack
														as="ul"
														gap={3}
														margin={0}
														padding={0}
														style={{
															listStyle: 'none',
															maxHeight: 280,
															overflowY: 'auto',
														}}
													>
														{review.affectedRedirects.map((redirect) => (
															<Card
																as="li"
																key={redirect.id}
																border
																radius={2}
																style={{ overflow: 'hidden' }}
															>
																<Card muted padding={3}>
																	<Stack gap={2}>
																		<Text size={0} muted>
																			Redirect from
																		</Text>
																		<Text
																			size={1}
																			weight="semibold"
																			style={{ overflowWrap: 'anywhere' }}
																		>
																			{redirect.source}
																		</Text>
																	</Stack>
																</Card>
																<Card borderTop padding={3}>
																	<Stack gap={3}>
																		<Text size={0} muted>
																			Destination
																		</Text>
																		<RedirectDestination
																			value={redirect.oldDestination}
																			previous
																		/>
																		<RedirectDestination
																			value={redirect.newDestination}
																		/>
																	</Stack>
																</Card>
															</Card>
														))}
													</Stack>
												</Stack>
											)}
										</>
									)}
								</Stack>
							</Box>
						),
						footer: (
							<Flex justify="flex-end" gap={2}>
								<Button
									text={phase === 'unknown' ? 'Close' : 'Cancel'}
									mode="bleed"
									disabled={phase === 'publishing'}
									onClick={close}
								/>
								{phase === 'unknown' ? (
									<Button
										text={
											checkingResult
												? 'Checking result…'
												: 'Check publish status'
										}
										disabled={checkingResult}
										onClick={() => {
											void reconcile()
										}}
									/>
								) : (
									<Button
										text={phase === 'publishing' ? 'Publishing…' : 'Publish'}
										loading={phase === 'publishing'}
										tone="primary"
										disabled={
											!review ||
											stale ||
											!!accessIssues?.length ||
											!!limit ||
											isRedirectDataError(errorReason) ||
											phase !== 'idle'
										}
										onClick={() => {
											void publish()
										}}
									/>
								)}
							</Flex>
						),
					}
				: (native.dialog ?? null),
		}
	}
	PublishAction.action = 'publish'
	PublishAction.displayName = 'UrlPublishAction'
	return PublishAction
}
