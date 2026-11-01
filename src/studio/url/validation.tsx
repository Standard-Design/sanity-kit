/**
 * Local URL proposals are checked before they reach the stored document. Share
 * their errors with the field wrapper so Sanity can render its normal label
 * icon and tooltip. This does not alter document validation or publish state.
 */
import { createContext, useContext, useEffect, useState } from 'react'
import type { ComponentType } from 'react'
import type { ObjectFieldProps, SlugValue } from 'sanity'

const ReportUrlError = createContext<(message: string | undefined) => void>(
	() => {},
)

export function UrlValidationField({
	fieldProps,
	customField: CustomField,
}: {
	fieldProps: ObjectFieldProps<SlugValue>
	customField?: ComponentType<ObjectFieldProps<SlugValue>> | undefined
}) {
	const [message, setMessage] = useState<string>()
	const props: ObjectFieldProps<SlugValue> = {
		...fieldProps,
		validation: message
			? [
					...fieldProps.validation,
					{ level: 'error', message, path: fieldProps.path },
				]
			: fieldProps.validation,
	}
	return (
		<ReportUrlError.Provider value={setMessage}>
			{CustomField ? (
				<CustomField {...props} />
			) : (
				fieldProps.renderDefault(props)
			)}
		</ReportUrlError.Provider>
	)
}

export function useUrlFieldError(message: string | undefined) {
	const report = useContext(ReportUrlError)
	useEffect(() => report(message), [message, report])
	useEffect(() => () => report(undefined), [report])
}
