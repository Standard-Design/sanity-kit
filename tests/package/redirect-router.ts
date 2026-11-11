/** The router adapter is available only through the server entry. */
import type { MiddlewareFunction } from 'react-router'
import {
	createSanityKit,
	createSanityRedirectMiddleware,
	type CreateSanityRedirectMiddlewareConfig,
} from '@standard-design/sanity-kit/react-router/server'
import type { RedirectCache } from '@standard-design/sanity-kit/redirect'

const kit = createSanityKit({
	projectId: 'project123',
	dataset: 'test',
	apiVersion: '2026-10-01',
	studioUrl: 'https://studio.example',
	readToken: 'test-only',
	sessionSecret: 'test-secret-with-at-least-32-characters',
})
const cache: RedirectCache = {
	getOrLoad: (_key, load) => load(),
	invalidate: () => Promise.resolve(),
}
const config: CreateSanityRedirectMiddlewareConfig = {
	kit,
	destinations: 'unverified',
	cache,
	reservedPathPrefixes: ['/account'],
}
const middleware: MiddlewareFunction<Response>[] =
	createSanityRedirectMiddleware(config)
void middleware
// @ts-expect-error The server adapter derives preview from the kit, not a caller boolean.
createSanityRedirectMiddleware({ ...config, preview: true })
