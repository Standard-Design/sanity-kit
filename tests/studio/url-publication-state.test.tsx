// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import {
	getUrlPublicationBlocked,
	useUrlPublicationBlocked,
	useUrlPublicationState,
	type UrlPublicationScope,
} from '../../src/studio/url/publication-state.js'

it('keeps pending work isolated by project, dataset, document, and mounted input', async () => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
	const scope = { projectId: 'a', dataset: 'test', documentId: 'page' }
	const host = document.createElement('div')
	const root = createRoot(host)
	function Input({
		scope,
		blocked,
	}: {
		scope: UrlPublicationScope
		blocked: boolean
	}) {
		useUrlPublicationState(scope, blocked)
		return null
	}
	function Status() {
		return <span>{String(useUrlPublicationBlocked(scope))}</span>
	}
	async function show(first: boolean, second: boolean) {
		await act(async () => {
			root.render(
				<>
					<Input key="first" scope={scope} blocked={first} />
					{second && (
						<Input
							key="second"
							scope={{ ...scope, documentId: 'drafts.page' }}
							blocked
						/>
					)}
					<Status />
				</>,
			)
			await Promise.resolve()
		})
	}
	try {
		await show(true, true)
		expect(host.textContent).toBe('true')
		expect(getUrlPublicationBlocked({ ...scope, projectId: 'b' })).toBe(false)
		expect(getUrlPublicationBlocked({ ...scope, dataset: 'production' })).toBe(
			false,
		)
		expect(
			getUrlPublicationBlocked({ ...scope, documentId: 'another-page' }),
		).toBe(false)
		await show(false, true)
		expect(host.textContent).toBe('true')
		await show(false, false)
		expect(host.textContent).toBe('false')
		await show(true, false)
	} finally {
		await act(async () => {
			root.unmount()
			await Promise.resolve()
		})
	}
	expect(getUrlPublicationBlocked(scope)).toBe(false)
})
