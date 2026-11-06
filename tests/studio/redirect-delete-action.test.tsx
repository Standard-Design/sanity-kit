// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createInstance } from 'i18next'
import { I18nextProvider, useTranslation } from 'react-i18next'
import type { DocumentActionDescription, DocumentActionProps } from 'sanity'
import { describe, expect, it, vi } from 'vitest'
import { createRedirectDeleteAction } from '../../src/studio/redirects/delete-action.js'

function NativeConfirmation({ count = 1 }: { count?: number }) {
	const { t } = useTranslation('structure')
	return (
		<p>
			{t('confirm-delete-dialog.confirmation.text', {
				context: 'delete',
				count,
			})}
		</p>
	)
}

describe('redirect deletion wording', () => {
	it.each([1, 2])(
		'changes only the active redirect dialog for %i versions',
		async (count) => {
			Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
			const i18n = createInstance()
			await i18n.init({
				lng: 'en-US',
				fallbackLng: false,
				keySeparator: false,
				resources: {
					'en-US': {
						structure: {
							'confirm-delete-dialog.confirmation.text_delete_one':
								'Delete this document?',
							'confirm-delete-dialog.confirmation.text_delete_other':
								'Delete all versions?',
							'reference-warning': 'Other documents reference this one.',
						},
					},
				},
			})
			const handle = vi.fn()
			const native: DocumentActionDescription = {
				label: 'Delete',
				disabled: false,
				onHandle: handle,
				dialog: {
					type: 'custom',
					component: <NativeConfirmation count={count} />,
				},
			}
			const action = createRedirectDeleteAction(() => native)
			const props = {
				published: { enabled: true },
				draft: { enabled: false },
			} as unknown as DocumentActionProps
			const description = action(props)
			expect(description?.onHandle).toBe(handle)
			expect(description?.disabled).toBe(false)
			const host = document.createElement('div')
			document.body.append(host)
			const root = createRoot(host)
			try {
				await act(async () => {
					root.render(
						<I18nextProvider i18n={i18n}>
							<NativeConfirmation />
							{description?.dialog &&
								description.dialog.type === 'custom' &&
								description.dialog.component}
						</I18nextProvider>,
					)
					await Promise.resolve()
				})
				expect(host.textContent).toContain('This is a live, active redirect.')
				expect(host.textContent).toContain(
					'will stop visitors being redirected',
				)
				expect(host.textContent).toContain(
					'Are you sure you want to delete it?',
				)
				expect(host.textContent).toContain('Delete this document?')
				expect(
					i18n.t('confirm-delete-dialog.confirmation.text', {
						ns: 'structure',
						context: 'delete',
						count: 1,
					}),
				).toBe('Delete this document?')
				expect(i18n.t('reference-warning', { ns: 'structure' })).toBe(
					'Other documents reference this one.',
				)
			} finally {
				await act(async () => {
					root.unmount()
					await Promise.resolve()
				})
				host.remove()
			}
		},
	)

	it.each([null, { enabled: false }])(
		'keeps native confirmation for an unpublished or inactive redirect',
		(published) => {
			const native: DocumentActionDescription = {
				label: 'Delete',
				dialog: { type: 'custom', component: <p>Native confirmation</p> },
			}
			const action = createRedirectDeleteAction(() => native)
			expect(
				action({
					published,
					draft: { enabled: true },
				} as unknown as DocumentActionProps),
			).toBe(native)
		},
	)

	it('preserves native denial and does not open a dialog or write on its own', () => {
		const handle = vi.fn()
		const native: DocumentActionDescription = {
			label: 'Delete',
			disabled: true,
			title: 'No permission',
			onHandle: handle,
		}
		const action = createRedirectDeleteAction(() => native)
		expect(
			action({
				published: { enabled: true },
			} as unknown as DocumentActionProps),
		).toBe(native)
		expect(handle).not.toHaveBeenCalled()
	})
})
