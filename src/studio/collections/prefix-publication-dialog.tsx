/**
 * Presentation-only review of a collection prefix change. The owner supplies
 * controller results and handles review, publish, and receipt checks. Mounting
 * this dialog never reads or writes Sanity and does not enable native Publish.
 */
import { useId } from 'react'
import { useVersionRelease } from 'sanity'
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
} from '@sanity/ui'
import {
	ConflictRecord,
	RedirectDestination,
} from '../url/publication-action.js'
import { UrlAccessNotice } from '../url/access-notice.js'
import type { UrlPublicationConflict } from '../url/publication.js'
import type { CollectionPrefixReceipt } from './prefix-pending.js'
import type {
	CollectionPrefixPublishResult,
	CollectionPrefixPublishReview,
} from './prefix-write.js'

type Blocked = Extract<CollectionPrefixPublishResult, { status: 'blocked' }>
type Settlement = Extract<
	CollectionPrefixPublishResult,
	{ status: 'published' | 'rejected' }
>

export type CollectionPrefixDialogState =
	| { readonly phase: 'checking' }
	| {
			readonly phase: 'ready' | 'publishing'
			readonly review: CollectionPrefixPublishReview
	  }
	| {
			readonly phase: 'blocked'
			readonly result: Blocked
			readonly conflict?: UrlPublicationConflict
			/** Optional readable release title supplied by the owner; display only. */
			readonly releaseTitle?: string
	  }
	| {
			readonly phase: 'unconfirmed' | 'checking-status'
			readonly result: Extract<
				CollectionPrefixPublishResult,
				{ status: 'unknown' }
			>
			readonly receipt?: Pick<
				CollectionPrefixReceipt,
				'oldPrefix' | 'newPrefix'
			>
	  }
	| {
			readonly phase: 'rejected'
			readonly result: Settlement & { readonly status: 'rejected' }
	  }

export interface CollectionPrefixPublicationDialogProps {
	/** The resolved editor-facing name; not necessarily the collection identifier. */
	readonly collectionTitle: string
	readonly state: CollectionPrefixDialogState
	readonly createRedirects: boolean
	/** Changing this choice must invalidate/rebuild the owner's reviewed plan. */
	readonly onCreateRedirectsChange: (value: boolean) => void
	/** The owner must still call the guarded controller with this exact review. */
	readonly onPublish: (review: CollectionPrefixPublishReview) => void
	readonly onReview: () => void
	readonly onCheckStatus: () => void
	readonly onClose: () => void
}

function notice(reason: string): {
	title: string
	text: string
	warning?: boolean
	retry?: boolean
} {
	if (reason === 'other-publication-pending')
		return {
			title: 'Another collection settings save needs checking',
			warning: true,
			text: 'A settings save in this dataset has an unconfirmed result. Check that save before starting another URL change.',
		}
	if (reason === 'settings-not-synced')
		return {
			title: 'The latest settings are still saving',
			retry: true,
			text: 'Wait for the settings draft to finish saving, then review the URL change again.',
		}
	if (reason === 'settings-validation-pending')
		return {
			title: 'The latest settings are still being checked',
			retry: true,
			text: 'Wait for Studio to finish validating the current draft, then review the URL change again.',
		}
	if (reason === 'settings-validation-failed')
		return {
			title: 'Fix the settings validation errors first',
			text: 'The current settings draft has errors. Return to the form, fix the marked fields, then review the URL change again.',
		}
	if (reason === 'review-stale' || reason === 'conflict')
		return {
			title: 'Review out of date',
			warning: true,
			retry: true,
			text: 'Settings, items, or redirects changed after this review. Check the latest changes before publishing.',
		}
	if (reason === 'request-failed' || reason === 'aborted')
		return {
			title: 'Could not check this URL change',
			retry: true,
			text: 'We could not finish checking the collection settings and affected URLs. Check your connection, then retry the checks.',
		}
	if (reason === 'routing-conflict')
		return {
			title: 'Collection URL prefixes overlap',
			text: 'The proposed prefix overlaps another registered collection route. Choose a different prefix, or update the other collection settings before reviewing again.',
		}
	if (reason === 'url-collision')
		return {
			title: 'Another page is using a proposed URL',
			text: 'Changing this collection prefix would give an item a URL that is already in use. Choose a different prefix, or update the page using that URL before reviewing again.',
		}
	if (reason === 'redirect-conflict')
		return {
			title: 'A redirect conflicts with this URL change',
			text: 'An existing redirect or its unpublished changes prevents these URLs from moving safely. Review the conflicting redirect, or choose a different prefix.',
		}
	if (reason === 'release-version')
		return {
			title: 'A planned release affects this URL change',
			text: 'Affected settings, items, or redirects have a Content Release version. Sanity Kit cannot yet coordinate this URL change with releases. Finish the planned release and review again, or keep the current prefix for now.',
		}
	if (reason === 'write-access-protected')
		return {
			title: 'A document needs attention before publishing',
			text: 'A settings or redirect document has a validation error or a read-only value that this change would modify. Resolve the validation issue, or ask a developer to review the field rules.',
		}
	if (
		reason.includes('access') ||
		reason === 'permission-denied' ||
		reason === 'receipt-read-unverified'
	)
		return {
			title: 'Access could not be confirmed',
			text: 'Publishing this change requires access to the collection settings, affected redirects, and its saved confirmation record. We could not confirm all of that access. Contact someone who manages project permissions to review it.',
		}
	if (reason === 'reserved-prefix')
		return {
			title: 'This URL prefix is reserved by the app',
			text: 'The proposed prefix overlaps URLs owned by the application. Choose a different prefix, or ask a developer to review the reserved routes.',
		}
	if (reason.includes('limit'))
		return {
			title: 'This change exceeds the supported review size',
			text: 'The collection settings and redirect changes are too large for this workflow to check or save together. Ask a developer to review the affected data and plan a supported change; this workflow will not split it into partial saves.',
		}
	if (reason.startsWith('recovery-'))
		return {
			title: 'Recovery information needs attention',
			text: 'The browser could not read or safely save the information used to confirm this change. Check browser storage access. If an earlier save may still be pending, ask a developer or Studio administrator to verify it before clearing recovery data.',
		}
	if (reason === 'request-rejected')
		return {
			title: 'The settings were not published',
			retry: true,
			text: 'Sanity rejected the save. Review the latest settings and redirects before trying again. If this continues, ask a developer to check the request.',
		}
	if (
		reason === 'locked-prefix' ||
		reason === 'first-publication-unsupported' ||
		reason === 'unchanged-prefix'
	)
		return {
			title: 'This change needs a different publishing workflow',
			text: 'This review handles changes to an existing editable collection prefix. Close it and return to the collection settings.',
		}
	if (reason === 'settings-unavailable' || reason === 'missing-draft')
		return {
			title: 'The settings could not be reviewed',
			retry: true,
			text: 'The expected published settings or their current draft could not be loaded. Return to the settings document and check its current state before trying again.',
		}
	return {
		title: 'This URL change could not be reviewed',
		text: 'Some settings, item, or redirect information could not be checked safely. Review the saved data with a developer or Studio administrator before trying again.',
	}
}

/** Same light red/green review treatment as single-page publishing. */
function ChangeCard({
	label,
	before,
	after,
	redirect = false,
}: {
	label: string
	before: string
	after: string
	redirect?: boolean
}) {
	return (
		<Card as="li" border radius={2} style={{ overflow: 'hidden' }}>
			<Card muted padding={3}>
				<Stack gap={2}>
					{redirect && (
						<Text size={0} muted>
							Redirect from
						</Text>
					)}
					<Text size={1} weight="semibold" style={{ overflowWrap: 'anywhere' }}>
						{label}
					</Text>
				</Stack>
			</Card>
			<Card borderTop padding={3}>
				<Stack gap={3}>
					{redirect && (
						<Text size={0} muted>
							Destination
						</Text>
					)}
					<RedirectDestination
						value={before}
						previous
						label={redirect ? 'Previous destination' : 'Previous item URL'}
					/>
					<RedirectDestination
						value={after}
						label={redirect ? 'New destination' : 'New item URL'}
					/>
				</Stack>
			</Card>
		</Card>
	)
}

/** Read the release's display name from Studio's existing release store. A
 * missing name must not hide the known release identity or affected document. */
function ReleaseConflictDetails({
	release,
	releaseTitle,
	onOpen,
}: {
	readonly release: NonNullable<NonNullable<Blocked['planFailure']>['release']>
	readonly releaseTitle?: string
	readonly onOpen: () => void
}) {
	const versionId = `versions.${release.id}.${release.document.id}`
	const { release: nativeRelease } = useVersionRelease(versionId)
	const title =
		releaseTitle ||
		(nativeRelease && typeof nativeRelease === 'object'
			? nativeRelease.metadata.title
			: undefined)
	return (
		<Stack gap={3}>
			<Card tone="default" border padding={3} radius={2}>
				<Stack gap={2}>
					<Text size={1} muted>
						Release that needs review
					</Text>
					<Text size={1} weight="semibold">
						{title || `Release ${release.id}`}
					</Text>
					{!title && (
						<Text size={1} muted>
							The release name is unavailable. The identifier above comes from
							the affected version.
						</Text>
					)}
				</Stack>
			</Card>
			<Text size={1} muted>
				Affected document
			</Text>
			<Card tone="default" border radius={2} padding={1}>
				<ConflictRecord
					conflict={{
						kind: 'page',
						documentId: versionId,
						schemaType: release.document.schemaType,
						title: release.document.title,
						pathname: release.currentPublishedPathname ?? '',
					}}
					onOpen={onOpen}
				/>
			</Card>
		</Stack>
	)
}

export function CollectionPrefixPublicationDialog({
	collectionTitle,
	state,
	createRedirects,
	onCreateRedirectsChange,
	onPublish,
	onReview,
	onCheckStatus,
	onClose,
}: CollectionPrefixPublicationDialogProps) {
	const id = useId()
	const review =
		state.phase === 'ready' || state.phase === 'publishing'
			? state.review
			: undefined
	const blocked = state.phase === 'blocked' ? state.result : undefined
	const reason =
		blocked?.reason ??
		(state.phase === 'rejected'
			? (state.result.reason ?? 'request-rejected')
			: undefined)
	const unknown =
		state.phase === 'unconfirmed' ||
		state.phase === 'checking-status' ||
		reason === 'outcome-unknown'
	const busy =
		state.phase === 'checking' ||
		state.phase === 'publishing' ||
		state.phase === 'checking-status'
	const saving = state.phase === 'publishing'
	const description = reason && !unknown ? notice(reason) : undefined
	const currentChoice = review?.createRedirects === createRedirects
	const canPublish = state.phase === 'ready' && currentChoice
	const plan = review?.plan
	const scrollList = {
		listStyle: 'none',
		maxHeight: 280,
		overflowY: 'auto',
	} as const
	return (
		<Dialog
			id={`${id}-collection-prefix`}
			header={
				unknown
					? 'Check collection settings save'
					: `Publish ${collectionTitle} URL change`
			}
			width={2}
			{...(!saving ? { onClose, onClickOutside: onClose } : {})}
			footer={
				<Flex justify="flex-end" gap={2} padding={3}>
					<Button
						mode="bleed"
						text={unknown ? 'Close' : 'Cancel'}
						disabled={saving}
						onClick={onClose}
					/>
					{unknown ? (
						<Button
							text={
								state.phase === 'checking-status'
									? 'Checking result…'
									: 'Check publish status'
							}
							disabled={busy}
							loading={state.phase === 'checking-status'}
							onClick={onCheckStatus}
						/>
					) : (
						<Button
							text={state.phase === 'publishing' ? 'Publishing…' : 'Publish'}
							tone="primary"
							loading={state.phase === 'publishing'}
							disabled={!canPublish}
							onClick={() => {
								if (canPublish && review) onPublish(review)
							}}
						/>
					)}
				</Flex>
			}
		>
			<Stack padding={4} gap={5}>
				{unknown && (
					<Card tone="caution" padding={3} radius={2} role="alert">
						<Stack gap={3}>
							<Text size={1} weight="semibold">
								Could not confirm the collection settings were published
							</Text>
							<Text size={1}>
								The save may have succeeded. Check its status before publishing
								again; checking does not repeat the save.
							</Text>
							{(state.phase === 'unconfirmed' ||
								state.phase === 'checking-status') &&
								state.receipt && (
									<Text size={1} style={{ overflowWrap: 'anywhere' }}>
										{state.receipt.oldPrefix} → {state.receipt.newPrefix}
									</Text>
								)}
							<Text size={1}>
								(If the result stays unclear, ask a developer or Studio
								administrator to verify the settings and redirects before trying
								again.)
							</Text>
						</Stack>
					</Card>
				)}
				{description &&
					(blocked?.accessIssues?.length ? (
						<UrlAccessNotice
							issues={blocked.accessIssues}
							operation="publish"
						/>
					) : (
						<Card
							tone={description.warning ? 'caution' : 'critical'}
							padding={3}
							radius={2}
							role="alert"
						>
							<Stack gap={3}>
								<Text size={1} weight="semibold">
									{description.title}
								</Text>
								<Text size={1}>{description.text}</Text>
								{blocked?.planFailure?.pathname && (
									<Card tone="default" border padding={3} radius={2}>
										<Stack gap={2}>
											<Text size={1} muted>
												URL in conflict
											</Text>
											<Text
												size={1}
												weight="semibold"
												style={{ overflowWrap: 'anywhere' }}
											>
												{blocked.planFailure.pathname}
											</Text>
										</Stack>
									</Card>
								)}
								{!!blocked?.planFailure?.documents?.length && (
									<Card tone="default" border radius={2} padding={3}>
										<Stack gap={2}>
											<Text size={1} muted>
												Documents using this URL
											</Text>
											{blocked.planFailure.documents.map((document) => (
												<ConflictRecord
													key={document.id}
													conflict={{
														kind: 'page',
														documentId: document.id,
														schemaType: document.schemaType,
														title: document.title,
														pathname: blocked.planFailure?.pathname || '',
													}}
													onOpen={onClose}
												/>
											))}
										</Stack>
									</Card>
								)}
								{blocked?.planFailure?.release && (
									<ReleaseConflictDetails
										release={blocked.planFailure.release}
										{...(state.phase === 'blocked' && state.releaseTitle
											? { releaseTitle: state.releaseTitle }
											: {})}
										onOpen={onClose}
									/>
								)}
								{state.phase === 'blocked' && state.conflict && (
									<Card tone="default" border radius={2} padding={1}>
										<ConflictRecord
											conflict={state.conflict}
											onOpen={onClose}
										/>
									</Card>
								)}
								{description.retry && (
									<Box>
										<Button
											mode="ghost"
											text={
												description.warning
													? 'Review latest changes'
													: 'Retry checks'
											}
											onClick={onReview}
										/>
									</Box>
								)}
							</Stack>
						</Card>
					))}
				{state.phase === 'checking' && (
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
							Checking the collection URL change…
						</Text>
					</Flex>
				)}
				{plan && review && (
					<>
						<Card border padding={4} radius={2}>
							<Stack gap={4}>
								<Stack gap={2}>
									<Text size={1} muted>
										From
									</Text>
									<Text size={2} style={{ overflowWrap: 'anywhere' }}>
										{plan.settings.oldPrefix}
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
										{plan.settings.newPrefix}
									</Text>
								</Stack>
							</Stack>
						</Card>
						<Stack gap={3}>
							<Flex align="center" gap={3}>
								<Checkbox
									id={`${id}-redirects`}
									checked={createRedirects}
									disabled={busy}
									onChange={(event) =>
										onCreateRedirectsChange(event.currentTarget.checked)
									}
								/>
								<Box flex={1}>
									<Text as="label" htmlFor={`${id}-redirects`} size={1}>
										Create redirects from old item URLs
									</Text>
								</Box>
							</Flex>
							{!createRedirects && (
								<Text size={1} muted>
									Old item URLs will not automatically forward to the new URLs.
									Existing redirects still follow these items.
								</Text>
							)}
							{!currentChoice && (
								<Card tone="caution" padding={3} radius={2} role="alert">
									<Stack gap={3}>
										<Text size={1}>
											Review this redirect choice before publishing.
										</Text>
										<Box>
											<Button
												mode="ghost"
												text="Review latest changes"
												onClick={onReview}
												disabled={busy}
											/>
										</Box>
									</Stack>
								</Card>
							)}
						</Stack>
						<Text size={1} muted>
							This publishes all changes in the collection settings draft,
							including its display name. Item slugs and item drafts stay
							unchanged. Listing pages keep their own URLs.
						</Text>
						<Stack gap={3}>
							<Text size={1} weight="semibold">
								Published item URLs · {plan.liveChanges.length}
							</Text>
							{plan.liveChanges.length ? (
								<Stack
									as="ul"
									aria-label="Published item URL changes"
									tabIndex={0}
									gap={3}
									margin={0}
									padding={0}
									style={scrollList}
								>
									{plan.liveChanges.map((item) => (
										<ChangeCard
											key={item.id}
											label={item.title || 'Untitled item'}
											before={item.oldPathname}
											after={item.newPathname}
										/>
									))}
								</Stack>
							) : (
								<Text size={1} muted>
									No published item URLs will change. Draft items remain
									unpublished.
								</Text>
							)}
						</Stack>
						{plan.redirects.updates.length > 0 && (
							<Stack gap={3}>
								<Text size={1} weight="semibold">
									Existing redirects · {plan.redirects.updates.length}
								</Text>
								<Text size={1} muted>
									Existing redirects for these items will be updated to the new
									destination URLs, even if the checkbox above is unchecked.
								</Text>
								<Stack
									as="ul"
									aria-label="Existing redirect destination changes"
									tabIndex={0}
									gap={3}
									margin={0}
									padding={0}
									style={scrollList}
								>
									{plan.redirects.updates.map((item) => (
										<ChangeCard
											key={item.id}
											redirect
											label={item.source}
											before={item.oldDestination}
											after={item.newDestination}
										/>
									))}
								</Stack>
							</Stack>
						)}
					</>
				)}
			</Stack>
		</Dialog>
	)
}
