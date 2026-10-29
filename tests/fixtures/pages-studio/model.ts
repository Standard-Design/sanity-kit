/** Fixture aliases keep the preview server and old proof cases on the shared model. */
import { createBrowserModel } from '../../../src/studio/pages/model.js'
import { pagePathname } from '../../../src/studio/pages/registry.js'
import { proofRegistry } from './routes.js'
export type { PageDocument as ProofDocument } from '../../../src/studio/pages/model.js'
export const {
	types: proofTypes,
	query: proofQuery,
	documentPath: proofDocumentPath,
	previewedDocument,
} = createBrowserModel(proofRegistry)
export const previewPath = pagePathname
