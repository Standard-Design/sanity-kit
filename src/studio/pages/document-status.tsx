/**
 * Keep Sanity's version/status integration in one adapter. These root exports are
 * beta/internal APIs on the pinned Studio version, not a stable cross-version
 * contract. Never infer publication status from the effective query's _id.
 */
import {
	DocumentVersionsStatusIndicator,
	useDocumentVersions,
	isDraftVersion,
	isPublishedVersion,
	isReleaseVersion,
} from 'sanity'
import { Text } from '@sanity/ui'
import { PagesTooltip } from './tooltip.js'

export function PageStatus({ id }: { id: string }) {
	const { versions, loading, error } = useDocumentVersions({ documentId: id })
	if (error || loading)
		return (
			<PagesTooltip content={error ? 'Status unavailable' : 'Loading status'}>
				<Text
					size={0}
					muted
					aria-label={error ? 'Status unavailable' : 'Loading status'}
				>
					…
				</Text>
			</PagesTooltip>
		)
	// Describe actual version availability for non-visual users. The native dots
	// themselves use the selected perspective and can show fewer of these versions.
	const available = [
		versions.some((version) => isPublishedVersion(version)) && 'published',
		versions.some((version) => isDraftVersion(version)) && 'draft',
		versions.some((version) => isReleaseVersion(version)) && 'release',
	]
		.filter(Boolean)
		.join(', ')
	const label = available
		? `Available versions: ${available}`
		: 'Status unavailable'
	return (
		<PagesTooltip content={label}>
			<span role="img" aria-label={label}>
				<DocumentVersionsStatusIndicator documentVersions={versions} />
			</span>
		</PagesTooltip>
	)
}
