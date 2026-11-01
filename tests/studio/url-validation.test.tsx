// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import type { ObjectFieldProps, SlugValue } from 'sanity'
import {
	UrlValidationField,
	useUrlFieldError,
} from '../../src/studio/url/validation.js'

function Proposal({ message }: { message: string | undefined }) {
	useUrlFieldError(message)
	return <input aria-label="URL" />
}

describe('URL field validation header', () => {
	it.each([false, true])(
		'passes local errors through the field renderer and clears them (custom: %s)',
		async (custom) => {
			Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
			const host = document.createElement('div')
			const root = createRoot(host)
			const existing = [
				{
					level: 'warning' as const,
					message: 'Existing warning',
					path: ['pathname'],
				},
			]
			const render = vi.fn((props: ObjectFieldProps<SlugValue>) => (
				<>{props.children}</>
			))
			const props = {
				path: ['pathname'],
				validation: existing,
				renderDefault: render,
			} as unknown as ObjectFieldProps<SlugValue>
			async function show(message: string | undefined) {
				await act(async () => {
					root.render(
						<UrlValidationField
							fieldProps={{
								...props,
								children: <Proposal message={message} />,
							}}
							customField={custom ? render : undefined}
						/>,
					)
					await Promise.resolve()
				})
			}
			try {
				await show('This URL is taken.')
				expect(render.mock.lastCall?.[0].validation).toEqual([
					...existing,
					{ level: 'error', message: 'This URL is taken.', path: ['pathname'] },
				])
				expect(existing).toHaveLength(1)
				await show(undefined)
				expect(render.mock.lastCall?.[0].validation).toEqual(existing)
			} finally {
				await act(async () => {
					root.unmount()
					await Promise.resolve()
				})
			}
		},
	)
})
