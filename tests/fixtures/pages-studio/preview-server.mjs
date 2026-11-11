/**
 * Local-only acceptance frontend. It reads kitProof* content and saved kit redirects, and never writes.
 * A server-side viewer token enables drafts; no credentials enter the JS bundle.
 * Do not deploy this development server or bind it to a public interface.
 */
import { Buffer } from 'node:buffer'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { createClient } from '@sanity/client'
import { build } from 'esbuild'

const projectId = process.env.SANITY_STUDIO_PROJECT_ID
const dataset = process.env.SANITY_STUDIO_DATASET
if (!projectId || !dataset)
	throw new Error('Set the test project and dataset environment variables.')
const client = createClient({
	projectId,
	dataset,
	apiVersion: '2026-10-01',
	useCdn: false,
	token: process.env.SANITY_API_READ_TOKEN,
})
const bundle = await build({
	entryPoints: [fileURLToPath(new URL('./preview-client.ts', import.meta.url))],
	bundle: true,
	write: false,
	outfile: 'fixture-client.js',
	format: 'esm',
	platform: 'browser',
})
// Compile the shared HTTP boundary and its pure kit helpers without writing a
// generated artifact. The published listener uses the same saved redirect rules.
const httpBundle = await build({
	entryPoints: [fileURLToPath(new URL('./preview-http.ts', import.meta.url))],
	bundle: true,
	write: false,
	format: 'esm',
	platform: 'node',
})
const { createFixtureHttpHandler } = await import(
	`data:text/javascript;base64,${Buffer.from(httpBundle.outputFiles[0].text).toString('base64')}`
)
const assets = Object.fromEntries(
	bundle.outputFiles.map((file) => [
		file.path.endsWith('.css') ? '/fixture-client.css' : '/fixture-client.js',
		file.text,
	]),
)
for (const [mode, port] of [
	['preview', 3334],
	['published', 3335],
]) {
	createServer(
		createFixtureHttpHandler({
			mode,
			port,
			client,
			projectId,
			dataset,
			assets,
		}),
	).listen(port, '127.0.0.1', () =>
		console.log(`Pages fixture ${mode}: http://localhost:${port}`),
	)
}
