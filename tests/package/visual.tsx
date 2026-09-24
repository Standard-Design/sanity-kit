import { renderToStaticMarkup } from 'react-dom/server'
import {
	SanityVisualEditing,
	SanityPreviewExit,
	type SuspiciousStegaReport,
} from '@standard/sanity-kit/react-router/visual-editing'

export const html: string = renderToStaticMarkup(
	<SanityVisualEditing
		enabled={false}
		keepStegaOnCopy
		onSuspiciousStega={(reports: readonly SuspiciousStegaReport[]) => {
			console.log(reports)
		}}
	>
		<SanityPreviewExit href="/preview/disable" />
	</SanityVisualEditing>,
)
