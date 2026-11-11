/** Isolated read-only browser harness. No Sanity connection, secrets or Studio config. */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
const production = process.env.HARNESS_MODE === 'production'
const native = fileURLToPath(new URL('./native.tsx', import.meta.url))
const bundle = await build({
	entryPoints: [fileURLToPath(new URL('./main.tsx', import.meta.url))],
	bundle: true,
	write: false,
	format: 'esm',
	platform: 'browser',
	minify: production,
	alias: production ? { 'react-dom/client': 'react-dom/profiling' } : undefined,
	define: {
		'process.env.NODE_ENV': JSON.stringify(
			production ? 'production' : 'development',
		),
	},
	plugins: [
		{
			name: 'synthetic-studio',
			setup(builder) {
				builder.onResolve(
					{ filter: /^sanity(?:\/presentation|\/router)?$/ },
					() => ({ path: native }),
				)
			},
		},
	],
})
const javascript = bundle.outputFiles[0].text
const require = createRequire(import.meta.url)
const stylesheet = await readFile(
	new URL(
		'./dist/styles.css',
		pathToFileURL(require.resolve('@sanity/ui/package.json')),
	),
	'utf8',
)
createServer((request, response) => {
	response.setHeader('Cache-Control', 'no-store')
	if (!['localhost:3346', '127.0.0.1:3346'].includes(request.headers.host))
		return response.writeHead(403).end()
	if (request.url === '/ui.css')
		return response
			.writeHead(200, { 'Content-Type': 'text/css' })
			.end(stylesheet)
	if (request.url === '/harness.js')
		return response
			.writeHead(200, { 'Content-Type': 'text/javascript' })
			.end(javascript)
	response
		.writeHead(200, { 'Content-Type': 'text/html' })
		.end(
			'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Navigator acceptance harness</title><meta name="harness-mode" content="' +
				(production ? 'production-profiling' : 'development') +
				'"><link rel="stylesheet" href="/ui.css"></head><body style="margin:0"><div id="root"></div><script type="module" src="/harness.js"></script></body></html>',
		)
}).listen(3346, '127.0.0.1', () =>
	console.log('Read-only navigator harness: http://localhost:3346'),
)
