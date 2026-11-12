/** Synthetic read-only Studio boundary; no credentials or Content Lake requests. */
import { evaluate, parse } from 'groq-js'
import type { SanityClient } from '@sanity/client'

export const fixture = {
	documents: [] as Record<string, unknown>[],
	queries: 0,
	queryStarts: 0,
	pendingQueries: 0,
	queryMilliseconds: 0,
}
const client = {
	async fetch(query: string, params: Record<string, unknown>) {
		const start = performance.now()
		fixture.queryStarts += 1
		fixture.pendingQueries += 1
		try {
			const result: unknown = await (
				await evaluate(parse(query), { dataset: fixture.documents, params })
			).get()
			fixture.queries += 1
			return result
		} finally {
			fixture.pendingQueries -= 1
			fixture.queryMilliseconds += performance.now() - start
		}
	},
	listen: () => ({ subscribe: () => ({ unsubscribe() {} }) }),
	withConfig: () => client,
	config: () => ({ projectId: 'synthetic', dataset: 'local' }),
}
export const useClient = () => client as unknown as SanityClient
export const usePerspective = () => ({
	perspectiveStack: ['published'],
	selectedVariantNames: [],
})
export const usePresentationParams = () => ({ preview: '/' })
export const usePresentationNavigate = () => () => {}
export const useRouter = () => ({ navigate() {}, navigateIntent() {} })
export const useTemplates = () => []
export const useSchema = () => ({ get: () => undefined })
export const useTemplatePermissions = () => [[], false]
export const useDocumentVersions = () => ({ versions: [], loading: false })
export const isDraftVersion = () => false
export const isPublishedVersion = () => false
export const isReleaseVersion = () => false
export function DocumentVersionsStatusIndicator() {
	return (
		<span
			aria-label="Synthetic status"
			style={{
				display: 'inline-block',
				width: 6,
				height: 6,
				borderRadius: '50%',
				background: '#43b581',
			}}
		/>
	)
}
