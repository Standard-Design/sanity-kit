/** Native document action: fields save drafts; Publish checks and saves without extra confirmation. */
import { Box, Button, Card, Flex, Stack, Text } from '@sanity/ui'
import { useToast } from '@sanity/ui/toast'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
	useClient,
	useSyncState,
	useValidationStatus,
	type DocumentActionComponent,
} from 'sanity'
import type { PagesRouteConfig } from '../../url/registry.js'
import { ConflictRecord } from '../url/publication-action.js'
import { UrlAccessNotice } from '../url/access-notice.js'
import {
	createRedirectPublicationController,
	type RedirectPublishBlocked,
	type RedirectPublishReview,
} from './publication.js'

export function redirectPublishFailure(reason: string): string {
	switch (reason) {
		case 'review-stale':
			return 'The redirect or another URL changed while we were checking it. Retry publishing to check the latest information.'
		case 'release-version':
			return 'This redirect also has changes in a release. Publishing it here could conflict with that planned work. This version of SanityKit cannot review release conflicts yet. Wait until the release is resolved, or coordinate the changes with the person preparing it.'
		case 'request-failed':
			return 'We could not check the redirect. Check your connection and retry.'
		case 'page-url-unresolved':
			return 'A page has a URL that could not be checked. Correct invalid page URLs in Pages before publishing this redirect.'
		case 'publish-rejected':
			return 'The redirect was not published. Check that you have permission to publish redirects and save confirmation records, then retry publishing.'
		case 'recovery-unavailable':
			return 'The browser could not save the information needed to confirm this change if the connection drops. Allow session storage for this Studio, then retry publishing. Nothing was sent.'
		case 'inventory-limit':
			return 'The site has more redirect records than this check supports. Publishing this redirect requires checking the other rules for conflicts. Review obsolete records, or ask a developer to support the larger inventory.'
		case 'inventory-size-limit':
			return 'To publish this redirect, the site’s existing rules must be checked for conflicts. That redirect data is larger than this check supports. Correct unexpectedly long values or review obsolete records. If the data must remain, ask a developer to support the larger inventory.'
		case 'request-limit':
			return 'The redirect and its confirmation record are too large to send together. Check for unexpectedly large custom fields, or ask a developer to review the data before publishing.'
		default:
			return 'The redirect could not be checked completely. Reload the Studio and retry publishing. If this continues, ask a developer or Studio administrator to verify the routing data.'
	}
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
						? 'Changes need another check'
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
						<Button text={'Retry publish'} mode="ghost" onClick={onRetry} />
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
		function confirmed(value: RedirectPublishReview | null, recovered = false) {
			// Normal success uses native document status. Recovery needs an explicit result.
			if (recovered)
				toast.push({
					status: 'success',
					title:
						value?.after.enabled === false
							? 'Redirect retired'
							: 'Redirect published',
					description:
						'The change is now saved. The website will use it when its redirect data refreshes.',
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
			setOpen(false)
			setReview(null)
			setError(null)
			setPhase('reviewing')
			let dispatching = false
			try {
				const checked = await controller.review(
					{
						documentId: state.id,
						draftRevision: state.draft._rev,
						publishedRevision: state.published?._rev ?? null,
					},
					request.signal,
				)
				if (!canReport() || request.signal.aborted) return
				if (checked.status !== 'ready') {
					setError(checked)
					setPhase('idle')
					setOpen(true)
					return
				}
				const value = checked.review
				setReview(value)
				// State can change during asynchronous checks. Validate the current
				// document now and again immediately before the service sends a write.
				if (!isCurrent(value)) {
					setError({ status: 'blocked', reason: 'review-stale' })
					setPhase('idle')
					setOpen(true)
					return
				}
				setPhase('publishing')
				dispatching = true
				const result = await controller.publish(value, {
					isCurrent: () => isCurrent(value),
				})
				if (!canReport()) return
				if (result.status === 'published') confirmed(value)
				else {
					if (result.status === 'unknown') setPhase('unknown')
					else {
						setError(result)
						setPhase('idle')
					}
					setOpen(true)
				}
			} catch {
				if (canReport() && !request.signal.aborted) {
					setPhase(dispatching ? 'unknown' : 'idle')
					if (!dispatching)
						setError({ status: 'blocked', reason: 'request-failed' })
					setOpen(true)
				}
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
				if (result.status === 'published')
					confirmed(current.current.review, true)
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
		const uncertain = phase === 'unknown'
		return {
			...native,
			label: uncertain
				? 'Check publish status'
				: phase === 'reviewing'
					? 'Checking redirect…'
					: phase === 'publishing'
						? 'Publishing…'
						: native.label,
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
								) : null}
							</Stack>
						),
						footer: (
							<Flex justify="flex-end" gap={2}>
								<Button
									text="Close"
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
								) : null}
							</Flex>
						),
					}
				: null,
		}
	}
	PublishAction.action = 'publish'
	return PublishAction
}
