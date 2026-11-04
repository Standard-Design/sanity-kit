/** Explain the measured kit boundary without presenting it as a Sanity quota. */
import { Card, Flex, Stack, Text } from '@sanity/ui'
import type { UrlPublicationLimit } from './publication-limits.js'

const number = (value: number) => value.toLocaleString('en-US')
function amount(value: number, bytes: boolean): string {
	return bytes
		? `${(value / 1_048_576).toFixed(2)} MiB (${number(value)} bytes)`
		: number(value)
}

export function PublicationLimitNotice({
	limit,
}: {
	readonly limit: UrlPublicationLimit
}) {
	const bytes = limit.kind.endsWith('bytes')
	const proposed = limit.phase === 'proposed'
	const content = {
		'redirect-updates': {
			title: 'Too many redirects need updating',
			description:
				'This URL change affects more existing redirects than can be updated when publishing this page.',
			label: 'Redirects to update',
			advice:
				'Review this page’s old redirects and remove only those that are no longer needed. If they must all remain, a developer will need to expand the workflow for publishing URL changes. Turning off the new redirect will not reduce these existing updates.',
		},
		'redirect-records': {
			title: proposed
				? 'Publishing this URL change would exceed the redirect limit'
				: 'Too many redirects to check before publishing this URL change',
			description: proposed
				? 'Redirects send visitors from old URLs to new ones. Adding a redirect for this URL change would put the site over the number of records SanityKit can check.'
				: 'Before publishing a URL change, SanityKit checks the site’s redirects—rules that send visitors from old URLs to new ones—to avoid URL conflicts and update existing links. The site currently has more redirect records than this check supports.',
			label: proposed ? 'Records after this change' : 'Records found',
			advice:
				'To publish this URL change, remove redirect records that are no longer needed, then try again. Disabling them will not reduce the count. If all records are still needed, ask a developer to increase the number SanityKit can safely check.',
		},
		'redirect-bytes': {
			title: proposed
				? 'This change would exceed the redirect data limit'
				: 'Redirect data is too large to review',
			description: proposed
				? 'Before publishing this URL change, SanityKit checks how much redirect data the site will have afterward. The estimated size, including space reserved for record metadata, exceeds what it can safely check.'
				: 'Before publishing this URL change, SanityKit needs to check the site’s redirects for conflicts and update existing links. The saved redirect data is currently too large for this check to complete.',
			label: proposed ? 'Projected data size' : 'Data size found',
			advice:
				'The amount of data grows with both the number of saved redirects and the length of their URLs. Removing redirects that are no longer needed, or correcting URLs that contain unintended text, can bring it below the limit. If all redirects are needed and their URLs are correct, ask a developer to increase the amount SanityKit can safely check.',
		},
		'publication-bytes': {
			title: 'This URL change is too large to publish',
			description:
				'Publishing this page sends its redirect updates and a confirmation record together. That combined request exceeds the supported size.',
			label: 'Combined request size',
			advice:
				'The request grows with the number of redirects that need updating and the length of their URLs. Removing affected redirects that are no longer needed, or correcting URLs that contain unintended text, can bring it below the limit. If all updates are needed and their URLs are correct, ask a developer to increase the amount SanityKit can safely send together.',
		},
	}[limit.kind]
	const qualifier =
		limit.measurement === 'at-least'
			? 'At least '
			: limit.measurement === 'estimated'
				? 'Estimated '
				: ''
	return (
		<Card tone="critical" padding={4} radius={2} role="alert">
			<Stack gap={4}>
				<Text size={2} weight="semibold">
					{content.title}
				</Text>
				<Text size={1}>{content.description}</Text>
				<Card tone="default" border radius={2} padding={3}>
					<Stack gap={4}>
						<Flex gap={3} justify="space-between" wrap="wrap">
							<Text size={1} muted>
								{content.label}
							</Text>
							<Text size={1} weight="semibold">
								{qualifier}
								{amount(limit.actual, bytes)}
							</Text>
						</Flex>
						<Flex gap={3} justify="space-between" wrap="wrap">
							<Text size={1} muted>
								Supported limit
							</Text>
							<Text size={1} weight="semibold">
								{amount(limit.maximum, bytes)}
							</Text>
						</Flex>
					</Stack>
				</Card>
				{limit.kind === 'redirect-records' && (
					<Text size={1} muted>
						The count includes published redirects, disabled records, drafts,
						and release versions across the site.
					</Text>
				)}
				{limit.measurement === 'at-least' && (
					<Text size={1} muted>
						The check stopped at its safety boundary; the total may be higher.
					</Text>
				)}
				<Text size={1}>{content.advice}</Text>
				<Text size={1} muted>
					Nothing was published. This is a SanityKit workflow limit, not a
					Sanity plan quota.
				</Text>
			</Stack>
		</Card>
	)
}

export function isRedirectDataError(reason?: string): boolean {
	return [
		'redirect-inventory-invalid',
		'invalid-inventory',
		'invalid-before-snapshot',
		'invalid-after-snapshot',
		'incomplete-inventory',
	].includes(reason ?? '')
}

/** State the problem directly; technical reason codes stay out of editor notices. */
export function redirectDataTitle(issue?: string): string {
	switch (issue) {
		case 'self-redirect':
			return 'A redirect points back to itself'
		case 'redirect-cycle':
			return 'Redirects form a loop'
		case 'redirect-chain':
			return 'A redirect points to another redirect'
		case 'invalid-source':
			return 'A redirect has an invalid source URL'
		case 'invalid-destination':
			return 'A redirect has an invalid destination URL'
		case 'unsupported-status':
			return 'A redirect has an unsupported status'
		case 'occupied-source':
			return 'A page and a redirect use the same URL'
		case 'reserved-source':
			return 'A redirect uses a URL reserved by the app'
		case 'invalid-record':
			return 'A redirect has missing or invalid fields'
		case 'incomplete-snapshot':
		case 'invalid-envelope':
		case 'wrong-perspective':
		case 'duplicate-id':
			return 'Redirect data could not be checked'
		default:
			return 'Redirect data needs correction'
	}
}

/** Describe data defects separately from counts and byte limits. */
export function redirectDataExplanation(issue?: string): string {
	switch (issue) {
		case 'duplicate-source':
			return 'More than one redirect uses the same source URL. Keep one intended rule for each source.'
		case 'self-redirect':
			return 'This redirect sends visitors back to the URL they started from. Change its destination to the intended page, or retire the redirect if it is no longer needed.'
		case 'redirect-cycle':
			return 'These redirects send visitors around a loop instead of reaching a page. Open the redirects above and change their destinations to the intended final page.'
		case 'redirect-chain':
			return 'Visitors would pass through several redirects before reaching a page. Update the redirects above to point directly to the final destination shown here.'
		case 'invalid-source':
			return 'A redirect has an invalid source URL. Correct that URL before trying again.'
		case 'invalid-destination':
			return 'A redirect has an invalid destination URL. Correct that URL before trying again.'
		case 'unsupported-status':
			return 'A redirect has an unsupported response status. Use 301 for a permanent redirect or 302 for a temporary one.'
		case 'occupied-source':
			return 'This URL cannot serve a page and redirect visitors elsewhere at the same time. If the page should keep its URL, retire or change the redirect. If the redirect should use it, change the page’s URL before trying again.'
		case 'reserved-source':
			return 'The app reserves this URL for its own routing, so a redirect cannot use it. Change or retire the redirect, or ask a developer to review the app’s reserved URLs if this reservation is unintended.'
		case 'unknown-destination':
			return 'A redirect destination could not be matched to an allowed page. Correct the destination or review the routing configuration.'
		case 'invalid-record':
			return 'SanityKit cannot check this redirect until its required fields contain valid values. Correct the fields identified above. If no record or field could be identified, ask a developer to inspect the redirect data.'
		case 'duplicate-id':
			return 'The same redirect record appeared more than once in the loaded data. This does not mean two redirects use the same URL. Ask a developer to check how the Studio loads redirect data before trying again.'
		case 'incomplete-snapshot':
		case 'invalid-envelope':
		case 'wrong-perspective':
			return 'SanityKit did not receive a complete, usable set of redirects, so it cannot safely check this URL change. Close the dialog and try again. If the problem continues, ask a developer to check how the Studio loads redirect data. This does not mean the redirect URLs themselves are wrong.'
		default:
			return 'The redirect records could not be validated. Review missing or malformed fields and duplicate records. If the response itself is invalid, a developer should check the data-loading integration.'
	}
}
