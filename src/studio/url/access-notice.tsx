/**
 * Report configured access requirements, never the identity of hidden documents.
 * Publication and field loading share this notice; native field validation uses
 * the same plain-language summary for failures while preparing an edit.
 */
import { Card, Stack, Text } from '@sanity/ui'
import type { UrlAccessIssue, UrlReadOperation } from './access.js'

const groups = [
	{ status: 'missing', title: 'Missing read access' },
	{ status: 'unverified', title: 'Read access could not be verified' },
] as const

export function formatUrlAccessIssues(
	issues: readonly UrlAccessIssue[],
): string {
	return [
		...groups.flatMap(({ status, title }) => {
			const labels = issues
				.filter((issue) => issue.status === status)
				.map((issue) => issue.label)
			return labels.length ? [`${title}: ${labels.join('; ')}.`] : []
		}),
		'Contact someone who manages project permissions to review the access requirements listed here.',
	].join(' ')
}

export function UrlAccessNotice({
	issues,
	operation = 'edit',
}: {
	readonly issues: readonly UrlAccessIssue[]
	readonly operation?: UrlReadOperation
}) {
	return (
		<Card tone="critical" padding={4} radius={2} role="alert">
			<Stack gap={4}>
				<Text size={2} weight="semibold">
					Access needed to check URLs
				</Text>
				<Text size={1}>
					{
						{
							edit: 'To change this URL, we need to check other pages for conflicts. Your account’s access could not be fully confirmed.',
							publish:
								'To publish this URL change, we need to check other pages and redirects for conflicts. Your account’s access could not be fully confirmed.',
							'redirect-publish':
								'To publish this redirect, we need to check pages and other redirects for conflicts. Your account’s access could not be fully confirmed.',
							'folder-rename':
								'To rename this folder, we need to check affected pages and redirects for conflicts. Your account’s access could not be fully confirmed.',
						}[operation]
					}
				</Text>
				<Text size={1}>
					The required access is listed below. Unverified access may be granted,
					but we could not confirm it.
				</Text>
				{groups.map(({ status, title }) => {
					const required = issues.filter((issue) => issue.status === status)
					if (!required.length) return null
					return (
						<Stack key={status} gap={3}>
							<Text size={1} weight="semibold">
								{title}
							</Text>
							<Stack as="ul" gap={3} margin={0} paddingLeft={4}>
								{required.map((issue) => (
									<li key={issue.key}>
										<Text size={1}>{issue.label}</Text>
									</li>
								))}
							</Stack>
						</Stack>
					)
				})}
				<Text size={1}>
					Contact someone who manages project permissions to review the access
					requirements listed here.
				</Text>
			</Stack>
		</Card>
	)
}
