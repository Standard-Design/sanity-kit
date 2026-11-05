/**
 * Keep Presentation's native create-intent transport at this small boundary.
 * A URL field outside Presentation has no creation hint and behaves normally.
 */
import { useFormValue, type SlugInputProps } from 'sanity'
import { usePresentationParams } from 'sanity/presentation'
import { decodeJsonParams } from 'sanity/router'
import { matchSanityKitCreationContext } from './creation-context.js'

export function useUrlCreationContext(path: SlugInputProps['path']) {
	const params = usePresentationParams(false)
	const document = useFormValue([]) as
		{ _id?: string; _type?: string } | undefined
	const fieldParts = path.filter(
		(part): part is string => typeof part === 'string',
	)
	if (!params?.templateParams || fieldParts.length !== path.length)
		return undefined
	try {
		return matchSanityKitCreationContext(
			decodeJsonParams(params.templateParams),
			{
				selectedId: params.id,
				selectedType: params.type,
				templateId: params.template,
				documentId: document?._id,
				documentType: document?._type,
				pathField: [...fieldParts, 'current'].join('.'),
			},
		)
	} catch {
		// Stale or malformed URL parameters must not break an otherwise usable field.
		return undefined
	}
}
