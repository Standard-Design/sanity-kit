/** Native document action: fields save drafts; this review makes them live. */
import { Box, Button, Card, Flex, Spinner, Stack, Text } from '@sanity/ui'
import { useToast } from '@sanity/ui/toast'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
	useClient,
	useSyncState,
	useValidationStatus,
	type DocumentActionComponent,
} from 'sanity'
import type { PagesRouteConfig } from '../../url/registry.js'
import {
	ConflictRecord,
	RedirectDestination,
} from '../url/publication-action.js'
import { UrlAccessNotice } from '../url/access-notice.js'
import {
	createRedirectPublicationController,
	type RedirectPublishBlocked,
	type RedirectPublishReview,
} from './publication.js'

const display = (value: unknown): string =>
	typeof value === 'string'
		? value
		: typeof value === 'number' || typeof value === 'boolean'
			? String(value)
			: value == null
				? 'Not set'
				: 'Unsupported value'
export function redirectPublishFailure(reason: string): string {
	switch (reason) {
		case 'review-stale':
			return 'The redirect or another URL changed after this review. Review the latest information before publishing again.'
		case 'release-version':
			return 'This redirect also has changes in a release. Publishing it here could conflict with that planned work. This version of SanityKit cannot review release conflicts yet. Wait until the release is resolved, or coordinate the changes with the person preparing it.'
		case 'request-failed':
			return 'We could not check the redirect. Check your connection and retry.'
		case 'page-url-unresolved':
			return 'A page has a URL that could not be checked. Correct invalid page URLs in Pages before publishing this redirect.'
		case 'publish-rejected':
			return 'The redirect was not published. Check that you have permission to publish redirects and save confirmation records, then review again.'
		case 'recovery-unavailable':
			return 'The browser could not save the information needed to confirm this change if the connection drops. Allow session storage for this Studio, then review again. Nothing was sent.'
		case 'inventory-limit':
			return 'The site has more redirect records than this check supports. Publishing this redirect requires checking the other rules for conflicts. Review obsolete records, or ask a developer to support the larger inventory.'
		case 'inventory-size-limit':
			return 'To publish this redirect, the site’s existing rules must be checked for conflicts. That redirect data is larger than this check supports. Correct unexpectedly long values or review obsolete records. If the data must remain, ask a developer to support the larger inventory.'
		case 'request-limit':
			return 'The redirect and its confirmation record are too large to send together. Check for unexpectedly large custom fields, or ask a developer to review the data before publishing.'
		default:
			return 'The redirect could not be checked completely. Reload the Studio and review again. If this continues, ask a developer or Studio administrator to verify the routing data.'
	}
}
function RedirectChange({
	review,
}: {
	readonly review: RedirectPublishReview
}) {
	const before = review.before,
		after = review.after
	const fields = [
		['source', 'Old URL'],
		['destination', 'Destination URL'],
		['status', 'Redirect type'],
		['enabled', 'Status'],
	] as const
	const label = (field: (typeof fields)[number][0], value: unknown) =>
		field === 'enabled' && typeof value === 'boolean'
			? value
				? 'Active'
				: 'Retired'
			: field === 'status' && [301, 302].includes(value as number)
				? `${String(value)} — ${value === 301 ? 'Permanent' : 'Temporary'}`
				: display(value)
	return (
		<Stack gap={4}>
			<Text size={1}>
				{after.enabled
					? before
						? 'Publishing replaces the live redirect with these draft changes.'
						: 'Publishing makes this redirect available to the website.'
					: 'Publishing retires this redirect. Once the website refreshes its redirect data, visitors will no longer be sent from the old URL to this destination.'}
			</Text>
			<Card border radius={2} overflow="hidden">
				<Card tone={after.enabled ? 'positive' : 'caution'} padding={3}>
					<Text size={1} weight="semibold">
						{after.enabled
							? before
								? 'Update redirect'
								: 'New redirect'
							: 'Retire redirect'}
					</Text>
				</Card>
				<Stack gap={4} padding={4}>
					{fields.map(([field, title]) => (
						<Stack gap={3} key={field}>
							<Text size={1} muted>
								{title}
							</Text>
							{before && before[field] !== after[field] ? (
								<>
									<RedirectDestination
										previous
										label={`Previous ${title.toLowerCase()}`}
										value={label(field, before[field])}
									/>
									<RedirectDestination
										label={`New ${title.toLowerCase()}`}
										value={label(field, after[field])}
									/>
								</>
							) : (
								<Text size={1} style={{ overflowWrap: 'anywhere' }}>
									{label(field, after[field])}
								</Text>
							)}
						</Stack>
					))}
				</Stack>
			</Card>
		</Stack>
	)
}
function RedirectError({
	error,
	onClose,
	onRetry,
}: {
	readonly error: RedirectPublishBlocked
	readonly onClose: () => void
	readonly onRetry: () => void
}) {
	if (error.issues?.length)
		return (
			<UrlAccessNotice operation="redirect-publish" issues={error.issues} />
		)
	return (
		<Card
			tone={error.reason === 'review-stale' ? 'caution' : 'critical'}
			padding={4}
			radius={2}
			role="alert"
		>
			<Stack gap={4}>
				<Text size={2} weight="semibold">
					{error.reason === 'review-stale'
						? 'Review out of date'
						: error.reason === 'request-failed'
							? 'Could not check this redirect'
							: 'This redirect cannot be published yet'}
				</Text>
				<Text size={1}>
					{error.diagnostic?.message ?? redirectPublishFailure(error.reason)}
				</Text>
				{error.limit && (
					<Text size={1} weight="semibold">
						{error.limit.actual.toLocaleString()} {error.limit.unit} · Limit:{' '}
						{error.limit.maximum.toLocaleString()} {error.limit.unit}
					</Text>
				)}
				{error.diagnostic?.fieldIssues?.map((issue) => (
					<Stack gap={2} key={issue.field}>
						<Text size={1} weight="semibold">
							{issue.field}
						</Text>
						<Text size={1}>{issue.message}</Text>
					</Stack>
				))}
				{error.diagnostic?.redirects?.map((redirect) => (
					<ConflictRecord
						key={redirect.documentId}
						conflict={{
							kind: 'redirect',
							schemaType: 'sanityKitRedirect',
							...redirect,
						}}
						onOpen={onClose}
					/>
				))}
				{['request-failed', 'review-stale'].includes(error.reason) && (
					<Box>
						<Button
							text={error.reason === 'review-stale' ? 'Review again' : 'Retry'}
							mode="ghost"
							onClick={onRetry}
						/>
					</Box>
				)}
			</Stack>
		</Card>
	)
}

export function createRedirectPublishAction(
	NativeAction: DocumentActionComponent,
	routes: PagesRouteConfig,
	options: { readonly reservedPaths?: readonly string[] } = {},
): DocumentActionComponent {
	const PublishAction: DocumentActionComponent = (props) => {
		// Preserve Sanity's permission/validation/lock behavior, but never call the
		// native onHandle: every redirect write must use our guarded controller.
		const native = NativeAction(props)
		const client = useClient({ apiVersion: '2026-10-01' })
		const controller = useMemo(
			() => createRedirectPublicationController(routes, client, options),
			[client, props.id],
		)
		const toast = useToast()
		const sync = useSyncState(props.id, props.type)
		const validation = useValidationStatus(
			props.draft?._id ?? props.id,
			props.type,
			true,
		)
		const ready =
			!!native &&
			!native.disabled &&
			!native.dialog &&
			!sync.isSyncing &&
			!validation.isValidating &&
			validation.revision === props.draft?._rev &&
			!validation.validation.some((marker) => marker.level === 'error') &&
			!props.liveEdit &&
			!props.release &&
			!props.version &&
			!!props.draft
		const [review, setReview] = useState<RedirectPublishReview | null>(null)
		const [phase, setPhase] = useState<
			'idle' | 'reviewing' | 'publishing' | 'unknown'
		>('idle')
		const [error, setError] = useState<RedirectPublishBlocked | null>(null)
		const [open, setOpen] = useState(false)
		const [checking, setChecking] = useState(false)
		const current = useRef({ props, ready, review, phase, controller })
		current.current = { props, ready, review, phase, controller }
		const alive = useRef(true),
			inFlight = useRef(false),
			abort = useRef<AbortController | null>(null)
		const canReport = () =>
			alive.current && current.current.controller === controller
		function restore(): boolean {
			try {
				const pending = controller.getPending(props.id)
				if (!pending) return false
				setReview(pending)
				setError(null)
				setPhase('unknown')
				return true
			} catch {
				setReview(null)
				setError({ status: 'blocked', reason: 'recovery-corrupt' })
				setPhase('unknown')
				return true
			}
		}
		useEffect(() => {
			alive.current = true
			inFlight.current = false
			setOpen(false)
			setReview(null)
			setError(null)
			setPhase('idle')
			restore()
			return () => {
				alive.current = false
				abort.current?.abort()
			}
		}, [controller])
		const isCurrent = (value: RedirectPublishReview) =>
			canReport() &&
			current.current.ready &&
			current.current.review === value &&
			current.current.props.id === value.documentId &&
			current.current.props.draft?._rev === value.draftRevision &&
			(current.current.props.published?._rev ?? null) ===
				value.publishedRevision
		function close() {
			if (current.current.phase === 'publishing') return
			abort.current?.abort()
			setOpen(false)
			if (current.current.phase !== 'unknown') {
				setPhase('idle')
				setReview(null)
				setError(null)
			}
		}
		function confirmed() {
			toast.push({
				status: 'success',
				title:
					current.current.review?.after.enabled === false
						? 'Redirect retired'
						: 'Redirect published',
				description:
					'The reviewed change is now saved. The website will use it when its redirect data refreshes.',
				duration: 9000,
				closable: true,
			})
			setOpen(false)
			setReview(null)
			setError(null)
			setPhase('idle')
			current.current.props.onComplete()
		}
		async function begin() {
			if (inFlight.current || !canReport() || !current.current.ready) return
			if (restore()) {
				setOpen(true)
				return
			}
			const state = current.current.props
			if (!state.draft?._rev) return
			const request = new AbortController()
			abort.current = request
			inFlight.current = true
			setOpen(true)
			setReview(null)
			setError(null)
			setPhase('reviewing')
			try {
				const result = await controller.review(
					{
						documentId: state.id,
						draftRevision: state.draft._rev,
						publishedRevision: state.published?._rev ?? null,
					},
					request.signal,
				)
				if (!canReport() || request.signal.aborted) return
				if (result.status === 'ready') setReview(result.review)
				else setError(result)
			} catch {
				if (canReport() && !request.signal.aborted)
					setError({ status: 'blocked', reason: 'request-failed' })
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
				inFlight.current ||
				current.current.phase !== 'idle' ||
				error
			)
				return
			inFlight.current = true
			setPhase('publishing')
			try {
				const result = await controller.publish(review, {
					isCurrent: () => isCurrent(review),
				})
				if (!canReport()) return
				if (result.status === 'published') confirmed()
				else if (result.status === 'unknown') setPhase('unknown')
				else {
					setError(result)
					setPhase('idle')
				}
			} catch {
				if (canReport()) setPhase('unknown')
			} finally {
				if (canReport()) inFlight.current = false
			}
		}
		async function reconcile() {
			if (inFlight.current) return
			inFlight.current = true
			setChecking(true)
			try {
				const result = await controller.reconcile(props.id)
				if (!canReport()) return
				if (result.status === 'published') confirmed()
				else if (
					result.status === 'blocked' &&
					['review-stale', 'publish-rejected'].includes(result.reason)
				) {
					setReview(null)
					setError(result)
					setPhase('idle')
				}
			} finally {
				if (canReport()) {
					inFlight.current = false
					setChecking(false)
				}
			}
		}
		if (!native) return native
		const stale = !!review && !isCurrent(review) && phase === 'idle'
		const uncertain = phase === 'unknown'
		return {
			...native,
			label: uncertain ? 'Check publish status' : native.label,
			disabled: uncertain ? open : !ready || phase !== 'idle' || open,
			onHandle: () => {
				if (uncertain) {
					setOpen(true)
					return
				}
				void begin()
			},
			dialog: open
				? {
						type: 'dialog',
						header:
							review?.after.enabled === false
								? 'Retire redirect'
								: 'Publish redirect',
						width: 'medium',
						onClose: close,
						showCloseButton: phase !== 'publishing',
						content: (
							<Stack gap={5}>
								{uncertain ? (
									<Card tone="caution" padding={4} radius={2} role="alert">
										<Stack gap={3}>
											<Text size={2} weight="semibold">
												Could not confirm the redirect was published
											</Text>
											<Text size={1}>
												{error?.reason === 'recovery-corrupt'
													? 'The saved confirmation information could not be read. Ask a developer or Studio administrator to verify the last change before publishing again.'
													: 'The connection ended before we received confirmation. Check the result before trying to publish again.'}
											</Text>
											<Text size={1}>
												(You can keep working and return using Check publish
												status.)
											</Text>
										</Stack>
									</Card>
								) : error ? (
									<RedirectError
										error={error}
										onClose={close}
										onRetry={() => {
											void begin()
										}}
									/>
								) : stale ? (
									<RedirectError
										error={{ status: 'blocked', reason: 'review-stale' }}
										onClose={close}
										onRetry={() => {
											void begin()
										}}
									/>
								) : null}
								{phase === 'reviewing' ? (
									<Flex
										direction="column"
										align="center"
										gap={3}
										paddingY={4}
										role="status"
									>
										<Spinner muted />
										<Text size={1}>Checking the redirect…</Text>
									</Flex>
								) : review ? (
									<RedirectChange review={review} />
								) : null}
							</Stack>
						),
						footer: (
							<Flex justify="flex-end" gap={2}>
								<Button
									text={uncertain ? 'Close' : 'Cancel'}
									mode="bleed"
									onClick={close}
									disabled={phase === 'publishing'}
								/>
								{uncertain ? (
									<Button
										text="Check publish status"
										onClick={() => {
											void reconcile()
										}}
										loading={checking}
										disabled={checking || error?.reason === 'recovery-corrupt'}
									/>
								) : (
									<Button
										text={
											review?.after.enabled === false
												? 'Retire redirect'
												: 'Publish'
										}
										tone="primary"
										onClick={() => {
											void publish()
										}}
										loading={phase === 'publishing'}
										disabled={
											!review ||
											!isCurrent(review) ||
											!!error ||
											phase !== 'idle'
										}
									/>
								)}
							</Flex>
						),
					}
				: null,
		}
	}
	PublishAction.action = 'publish'
	return PublishAction
}
