/** Test harness configuration; state and behavior live in the reusable plugin. */
import type { PropsWithChildren } from 'react'
import { BrowserStateProvider as Provider } from '../../../src/studio/pages/browser-state.js'
import { createPagesRuntime } from '../../../src/studio/pages/runtime.js'
import { proofRoutes } from './routes.js'
const runtime = createPagesRuntime({
	...proofRoutes,
	name: 'pages-proof',
	previewUrl: 'http://localhost:3334',
	create: { schemaType: 'kitProofPage', templateId: 'kitProofPage' },
})
export function BrowserStateProvider({ children }: PropsWithChildren) {
	return <Provider runtime={runtime}>{children}</Provider>
}
