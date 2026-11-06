/**
 * Keep Sanity's delete operation, permissions, reference checks, and confirmation.
 * Only the active redirect's dialog receives different wording. Its translation
 * store is forked so page deletion and other open dialogs keep their own text.
 * @see docs/redirects.md#deleting-a-redirect
 */
import { useMemo, type ReactNode } from 'react'
import { I18nextProvider, useTranslation } from 'react-i18next'
import type { DocumentActionComponent } from 'sanity'

const message =
	'This is a live, active redirect. Deleting it will stop visitors being redirected from the old URL to its destination once the website refreshes its redirect data. Are you sure you want to delete it?'

export function ActiveRedirectDeleteDialog({
	children,
}: {
	children: ReactNode
}) {
	const { i18n } = useTranslation('structure')
	const language = i18n.resolvedLanguage ?? i18n.language
	const scoped = useMemo(() => {
		const instance = i18n.cloneInstance({ forkResourceStore: true })
		instance.addResourceBundle(
			language,
			'structure',
			{
				'confirm-delete-dialog.confirmation.text_delete': message,
				'confirm-delete-dialog.confirmation.text_delete_one': message,
				'confirm-delete-dialog.confirmation.text_delete_other': message,
			},
			true,
			true,
		)
		return instance
	}, [i18n, language])
	return <I18nextProvider i18n={scoped}>{children}</I18nextProvider>
}

export function createRedirectDeleteAction(
	NativeAction: DocumentActionComponent,
): DocumentActionComponent {
	const DeleteAction: DocumentActionComponent = (props) => {
		const native = NativeAction(props)
		// A disabled draft does not retire an active published rule. Base this
		// warning on the live version, never the draft currently being edited.
		if (!native || props.published?.enabled !== true || !native.dialog)
			return native
		const dialog = native.dialog
		if (dialog.type !== 'custom') return native
		return {
			...native,
			dialog: {
				...dialog,
				component: (
					<ActiveRedirectDeleteDialog>
						{dialog.component}
					</ActiveRedirectDeleteDialog>
				),
			},
		}
	}
	DeleteAction.action = 'delete'
	return DeleteAction
}
