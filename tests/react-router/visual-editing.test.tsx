import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
	SanityPreviewExit,
	SanityVisualEditing,
	type SanityVisualEditingProps,
	type SuspiciousStegaReport,
} from '../../src/react-router/visual-editing/index.js'

describe('SanityVisualEditing', () => {
	it('renders nothing and no preview controls when preview is disabled', () => {
		const html = renderToStaticMarkup(
			<SanityVisualEditing enabled={false} fallback={<p>Loading overlays</p>}>
				<span>Preview controls</span>
			</SanityVisualEditing>,
		)

		expect(html).toBe('')
	})

	it('uses an SSR-safe fallback without eagerly rendering the overlay', () => {
		const onSuspiciousStega = (reports: readonly SuspiciousStegaReport[]) =>
			reports.length
		const html = renderToStaticMarkup(
			<SanityVisualEditing
				enabled
				fallback={<p>Loading overlays</p>}
				keepStegaOnCopy
				onSuspiciousStega={onSuspiciousStega}
			>
				<span>Preview controls</span>
			</SanityVisualEditing>,
		)

		expect(html).toBe('<p>Loading overlays</p><span>Preview controls</span>')
		const props: SanityVisualEditingProps = {
			enabled: true,
			onSuspiciousStega,
		}
		expect(props.onSuspiciousStega).toBe(onSuspiciousStega)
	})
})

describe('SanityPreviewExit', () => {
	it('stays hidden during SSR in standalone mode', () => {
		expect(
			renderToStaticMarkup(<SanityPreviewExit href="/preview/disable" />),
		).toBe('')
	})

	it('can render during SSR when explicitly always visible', () => {
		const html = renderToStaticMarkup(
			<SanityPreviewExit
				className="preview-exit"
				href="/preview/disable?redirect=%2Farticle"
				visibility="always"
			/>,
		)

		expect(html).toBe(
			'<a class="preview-exit" href="/preview/disable?redirect=%2Farticle">Disable preview mode</a>',
		)
	})

	it('accepts application-owned accessible content and attributes', () => {
		const html = renderToStaticMarkup(
			<SanityPreviewExit
				aria-label="Leave preview"
				href="/preview/disable"
				visibility="always"
			>
				Leave preview
			</SanityPreviewExit>,
		)

		expect(html).toContain('aria-label="Leave preview"')
		expect(html).toContain('>Leave preview</a>')
	})
})
