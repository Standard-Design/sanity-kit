/**
 * Private native Publish adapter for collection settings. Settings-only saves
 * keep the ordinary one-click workflow; an existing prefix move opens the URL
 * review. This factory is inert until a workspace explicitly installs it.
 * @see docs/collection-prefix-publication.md
 */
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import {
	Box,
	Button,
	Card,
	Dialog,
	Flex,
	Spinner,
	Stack,
	Text,
} from '@sanity/ui'
import { useToast } from '@sanity/ui/toast'
import {
	useClient,
	useCurrentUser,
	useGrantsStore,
	useSyncState,
	useValidationStatus,
	useWorkspace,
	type DocumentActionComponent,
} from 'sanity'
import type { CollectionRoutingConfig } from '../../url/settings/resolve.js'
import { createCollectionSettingsPublicationClassifier } from './settings-publication-plan.js'
import { createNativeCollectionPrefixReadAccess } from './prefix-native-access.js'
import { createNativeCollectionPrefixWriteAccess } from './prefix-native-write-access.js'
import { createCollectionPrefixController } from './prefix-write.js'
import { createCollectionSettingsPublicationController } from './settings-publication-write.js'
import { createCollectionPrefixPublicationSession } from './prefix-publication-session.js'
import {
	createCollectionSettingsPublicationSession,
	type CollectionSettingsSessionView,
} from './settings-publication-session.js'
import { CollectionPrefixPublicationDialog } from './prefix-publication-dialog.js'

const guardedActions = new WeakMap<DocumentActionComponent, string>()
/** The workspace guard recognizes actual wrapped components, not a public flag. */
export const isCollectionSettingsPublishAction = (
	action: DocumentActionComponent,
	configuration?: CollectionRoutingConfig,
) =>
	guardedActions.has(action) &&
	(configuration === undefined ||
		guardedActions.get(action) === JSON.stringify(configuration))

function message(reason: string | undefined): {
	title: string
	text: string
	retry?: boolean
} {
	if (reason === 'request-failed')
		return {
			title: 'Settings could not be checked',
			text: 'The connection ended before the checks finished. Check your connection and retry; nothing has been published.',
			retry: true,
		}
	if (reason === 'review-stale')
		return {
			title: 'Settings changed during the check',
			text: 'The draft or routing information changed while it was being checked. Review the latest values, then try publishing again.',
			retry: true,
		}
	if (
		reason === 'unknown-read-access' ||
		reason === 'read-access-unverified' ||
		(reason?.startsWith('write-access') &&
			reason !== 'write-access-protected') ||
		reason === 'receipt-read-unverified'
	)
		return {
			title: 'Access could not be confirmed',
			text: 'Publishing needs access to the settings and the information used to check their URLs. Your access could not be confirmed. Retry, or ask someone who can manage project permissions to check your access.',
			retry: true,
		}
	if (
		reason === 'settings-not-synced' ||
		reason === 'settings-validation-pending'
	)
		return {
			title: 'Wait for the draft to finish saving',
			text: 'The draft and its validation checks must finish before it can be published. Try again once the document has saved.',
			retry: true,
		}
	if (
		reason === 'settings-validation-failed' ||
		reason === 'write-access-protected'
	)
		return {
			title: 'Settings need attention',
			text: 'Correct the validation errors or protected field changes in this document, then publish again.',
		}
	if (reason === 'prefix-review-required')
		return {
			title: 'The URL prefix has changed',
			text: 'This change needs a review of the affected item URLs and redirects. Close this notice and choose Publish again to open that review.',
		}
	if (reason === 'other-publication-pending' || reason === 'outcome-unknown')
		return {
			title: 'Another settings save needs checking',
			text: 'A collection settings save in this dataset has an unconfirmed result. Check that save before starting another one.',
		}
	if (reason === 'recovery-invalid' || reason === 'recovery-unavailable')
		return {
			title: 'Publish status information is unavailable',
			text: 'The saved information used to confirm a settings change could not be read or stored. Check the last save before trying again. A developer or Studio administrator can help recover this information.',
		}
	if (reason === 'conflict')
		return {
			title: 'Settings changed before they could be published',
			text: 'Someone saved or published newer settings before this attempt finished. Review the latest draft and try again.',
			retry: true,
		}
	if (reason === 'permission-denied')
		return {
			title: 'Settings could not be published',
			text: 'Your current permissions do not allow this save. Ask someone who can manage project permissions to check your access.',
		}
	if (
		reason === 'release-version' ||
		reason === 'release-version-exists' ||
		reason === 'release-version-unsupported'
	)
		return {
			title: 'A release needs review before these URLs can go live',
			text: 'This collection has planned release changes. SanityKit cannot yet coordinate first-time URL activation with releases. Keep that planned work and review the routing change separately.',
		}
	if (
		reason === 'url-collision' ||
		reason === 'routing-conflict' ||
		reason === 'reserved-prefix' ||
		reason === 'url-conflict' ||
		reason === 'reserved-path' ||
		reason === 'redirect-conflict'
	)
		return {
			title: 'The proposed collection URLs are not available',
			text: 'One or more item URLs conflict with another page, redirect, or an app-reserved path. Review the proposed prefix and the conflicting URLs before publishing.',
		}
	if (reason === 'invalid-url')
		return {
			title: 'An item URL needs attention',
			text: 'An item does not have a valid URL for this collection. Correct its slug or URL before publishing the collection settings.',
		}
	if (
		reason === 'limit-exceeded' ||
		reason === 'request-size-limit' ||
		reason === 'settings-size-limit'
	)
		return {
			title: 'This change is too large to check safely',
			text: 'The settings or routing inventory exceeds the supported size. A developer can review the data and the publishing limits before these settings go live.',
		}
	if (
		reason === 'incomplete-inventory' ||
		reason === 'invalid-inventory' ||
		reason === 'invalid-response' ||
		reason === 'settings-invalid'
	)
		return {
			title: 'Routing information could not be verified',
			text: 'The information needed to check these collection URLs is incomplete or invalid. Retry the checks. If this continues, ask a developer to review the routing data.',
			retry: true,
		}
	return {
		title: 'Settings could not be published',
		text: 'The settings or their routing information did not pass the publishing checks. Review the draft and try again. If this continues, ask a developer to check the collection configuration.',
	}
}
function SettingsNotice({
	view,
	onClose,
	onRetry,
	onCheck,
}: {
	view: CollectionSettingsSessionView
	onClose: () => void
	onRetry: () => void
	onCheck: () => void
}) {
	const uncertain = view.phase === 'unknown' || view.phase === 'checking-status'
	const notice = message(view.reason)
	return (
		<Dialog
			id="sanity-kit-settings-publish-notice"
			header={
				uncertain
					? 'Check settings publish status'
					: 'Publish collection settings'
			}
			width={1}
			onClose={onClose}
			onClickOutside={onClose}
			footer={
				<Flex padding={3} gap={2} justify="flex-end">
					<Button text="Close" mode="bleed" onClick={onClose} />
					{uncertain ? (
						<Button
							text={
								view.phase === 'checking-status'
									? 'Checking status…'
									: 'Check publish status'
							}
							disabled={view.phase === 'checking-status'}
							onClick={onCheck}
						/>
					) : notice.retry ? (
						<Button text="Retry" onClick={onRetry} />
					) : null}
				</Flex>
			}
		>
			<Box padding={4}>
				<Card tone={uncertain ? 'caution' : 'critical'} padding={3} radius={2}>
					<Stack gap={3}>
						<Text size={1} weight="semibold">
							{uncertain
								? 'We could not confirm whether the settings were published'
								: notice.title}
						</Text>
						<Text size={1}>
							{uncertain
								? 'Check the publish status before trying again. This will only check the previous attempt; it will not publish the settings a second time.'
								: notice.text}
						</Text>
						{view.pathname && (
							<Card padding={3} radius={2} border>
								<Text size={1} style={{ overflowWrap: 'anywhere' }}>
									{view.pathname}
								</Text>
							</Card>
						)}
						{!!view.accessRequirements?.length && (
							<Stack gap={2}>
								{view.accessRequirements.map((label) => (
									<Text key={label} size={1}>
										{label}
									</Text>
								))}
							</Stack>
						)}
						{view.phase === 'checking-status' && (
							<Flex justify="center">
								<Spinner muted />
							</Flex>
						)}
					</Stack>
				</Card>
			</Box>
		</Dialog>
	)
}

export function createCollectionSettingsPublishAction(
	NativeAction: DocumentActionComponent,
	configuration: CollectionRoutingConfig,
): DocumentActionComponent {
	const config = structuredClone(configuration)
	const classifier = createCollectionSettingsPublicationClassifier(config)
	const PublishAction: DocumentActionComponent = (props) => {
		// Preserve native permissions, locks, validation, and shortcut metadata. The
		// native handler is never called: it would bypass the reviewed writers.
		const native = NativeAction(props)
		const client = useClient({ apiVersion: '2026-10-01' })
		const workspace = useWorkspace(),
			currentUser = useCurrentUser(),
			grantsStore = useGrantsStore()
		const toast = useToast()
		const sync = useSyncState(props.id, props.type)
		const validation = useValidationStatus(
			props.draft?._id ?? props.id,
			props.type,
			true,
		)
		const registered = config.collections?.find(
			(collection) => collection.settingsDocumentId === props.id,
		)
		const classification = classifier.classify({
			collection: registered?.name,
			published: props.published ?? null,
			draft: props.draft ?? null,
		})
		const canPublish =
			!!native &&
			!native.disabled &&
			!native.dialog &&
			!props.liveEdit &&
			!props.release &&
			!props.version &&
			!!registered
		const current = useRef({ props, canPublish, registered, sync, validation })
		current.current = { props, canPublish, registered, sync, validation }
		const controllers = useMemo(() => {
			const confirmReadAccess = createNativeCollectionPrefixReadAccess(client)
			const authorize = createNativeCollectionPrefixWriteAccess({
				client,
				workspace,
				currentUser,
				grantsStore,
			})
			const options = { configuration: config, confirmReadAccess, authorize }
			return {
				prefix: createCollectionPrefixController(options, client),
				settings: createCollectionSettingsPublicationController(
					options,
					client,
				),
			}
		}, [client, workspace, currentUser, grantsStore])
		const owners = useMemo(() => {
			const documentId = props.id
			const getCurrent = () => {
				const state = current.current
				return {
					collection: state.registered?.name ?? '',
					published: state.props.published ?? null,
					draft: state.props.draft ?? null,
					isSynced:
						!state.sync.isSyncing &&
						state.canPublish &&
						state.props.id === documentId,
					canPublish: state.canPublish && state.props.id === documentId,
					validation: {
						isValidating: state.validation.isValidating,
						hasErrors: state.validation.validation.some(
							(marker) => marker.level === 'error',
						),
						...(state.validation.revision
							? { revision: state.validation.revision }
							: {}),
					},
				}
			}
			const confirmed = () => {
				if (current.current.props.id !== documentId) return
				toast.push({
					status: 'success',
					title: 'Collection settings published',
					description:
						'The settings and any reviewed URL changes are now saved.',
					duration: 9000,
					closable: true,
				})
				current.current.props.onComplete()
			}
			return {
				mounts: 0,
				prefix: createCollectionPrefixPublicationSession({
					controller: controllers.prefix,
					getCurrent,
					onPublished: confirmed,
				}),
				settings: createCollectionSettingsPublicationSession({
					controller: controllers.settings,
					getCurrent,
					onPublished: confirmed,
				}),
			}
		}, [controllers, props.id])
		const prefix = useSyncExternalStore(
			owners.prefix.subscribe,
			owners.prefix.getView,
			owners.prefix.getView,
		)
		const settings = useSyncExternalStore(
			owners.settings.subscribe,
			owners.settings.getView,
			owners.settings.getView,
		)
		useEffect(() => {
			owners.mounts++
			return () => {
				owners.mounts--
				// React's development Strict Mode replays effects on the same owner.
				// Dispose only once no mounted effect still uses this particular owner.
				queueMicrotask(() => {
					if (!owners.mounts) {
						owners.prefix.dispose()
						owners.settings.dispose()
					}
				})
			}
		}, [owners])
		useEffect(() => {
			owners.prefix.refresh()
		}, [
			owners,
			props.published?._rev,
			props.draft?._rev,
			sync.isSyncing,
			validation.isValidating,
			validation.revision,
			validation.validation,
		])
		let pendingKind: string | undefined
		try {
			pendingKind = controllers.settings.getPending()?._type
		} catch {
			pendingKind = 'invalid'
		}
		const recovering =
			owners.prefix.needsRecovery() ||
			!!pendingKind ||
			settings.phase === 'unknown' ||
			settings.phase === 'checking-status'
		const busy =
			['checking', 'publishing', 'checking-status'].includes(settings.phase) ||
			(prefix.open &&
				['checking', 'publishing', 'checking-status'].includes(
					prefix.state.phase,
				))
		const showPrefix = prefix.open
		const showSettings =
			settings.open &&
			['blocked', 'unknown', 'checking-status'].includes(settings.phase)
		const ready =
			canPublish &&
			classification.ok &&
			!sync.isSyncing &&
			!validation.isValidating &&
			validation.revision === props.draft?._rev &&
			!validation.validation.some((marker) => marker.level === 'error')
		function handle() {
			if (settings.phase === 'unknown') {
				owners.settings.recover()
				return
			}
			if (owners.prefix.needsRecovery()) {
				void owners.prefix.open()
				return
			}
			// Read the shared pending slot again on click; another mounted action may
			// have started a save since this component last rendered.
			let kind: string | undefined
			try {
				kind = controllers.settings.getPending()?._type
			} catch {
				owners.settings.recover()
				return
			}
			if (kind === 'sanityKitCollectionPrefixPublication') {
				void owners.prefix.open()
				return
			}
			if (kind === 'sanityKitCollectionSettingsPublication') {
				owners.settings.recover()
				return
			}
			if (!ready || busy) return
			if (classification.ok && classification.value.kind === 'prefix-change')
				void owners.prefix.open()
			else void owners.settings.publish()
		}
		if (!native) return null
		return {
			...native,
			// The dialog owns progress and recovery feedback while it is open.
			// A pending receipt also exists during a normal write, so show active
			// progress before considering the closed-dialog recovery action.
			label:
				showPrefix || showSettings
					? 'Publish'
					: busy
						? settings.phase === 'publishing'
							? 'Publishing…'
							: 'Checking…'
						: recovering
							? 'Check publish status'
							: native.label,
			disabled: busy || showPrefix || showSettings || (!recovering && !ready),
			onHandle: handle,
			dialog: showPrefix
				? {
						type: 'custom',
						component: (
							<CollectionPrefixPublicationDialog
								collectionTitle={
									registered?.displayName?.mode === 'locked'
										? registered.displayName.value
										: typeof props.draft?.displayName === 'string'
											? props.draft.displayName
											: (registered?.title ?? registered?.name ?? 'Collection')
								}
								state={prefix.state}
								createRedirects={prefix.createRedirects}
								onCreateRedirectsChange={owners.prefix.setCreateRedirects}
								onPublish={(review) => {
									void owners.prefix.publish(review)
								}}
								onReview={() => {
									void owners.prefix.review()
								}}
								onCheckStatus={() => {
									void owners.prefix.checkStatus()
								}}
								onClose={owners.prefix.close}
							/>
						),
					}
				: showSettings
					? {
							type: 'custom',
							component: (
								<SettingsNotice
									view={settings}
									onClose={owners.settings.close}
									onRetry={() => {
										void owners.settings.publish()
									}}
									onCheck={() => {
										void owners.settings.checkStatus()
									}}
								/>
							),
						}
					: null,
		}
	}
	PublishAction.action = 'publish'
	guardedActions.set(PublishAction, JSON.stringify(config))
	return PublishAction
}
