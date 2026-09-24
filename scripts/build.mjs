import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
// Only generated package output is removed; stale files must never be packed.
await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true })
const result = spawnSync(
	process.execPath,
	[
		fileURLToPath(import.meta.resolve('typescript/bin/tsc')),
		'-p',
		'tsconfig.build.json',
	],
	{ cwd: root, stdio: 'inherit' },
)
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)

const manifest = JSON.parse(
	await readFile(new URL('../package.json', import.meta.url), 'utf8'),
)
// Assemble a self-contained distribution with an explicit public field list.
const distribution = Object.fromEntries(
	[
		'name',
		'version',
		'private',
		'description',
		'license',
		'repository',
		'type',
		'sideEffects',
		'engines',
		'peerDependencies',
		'peerDependenciesMeta',
	].map((key) => [key, manifest[key]]),
)
distribution.main = './index.js'
distribution.types = './index.d.ts'
distribution.exports = Object.fromEntries(
	Object.entries(manifest.exports).map(([subpath, target]) => [
		subpath,
		typeof target === 'string'
			? target
			: Object.fromEntries(
					Object.entries(target).map(([condition, path]) => [
						condition,
						path.replace(/^\.\/dist\//u, './'),
					]),
				),
	]),
)
await mkdir(new URL('../dist/docs/', import.meta.url), { recursive: true })
for (const file of [
	'README.md',
	'LICENSE',
	'CHANGELOG.md',
	'docs/sitemaps.md',
	'docs/prerelease.md',
]) {
	await copyFile(
		new URL(`../${file}`, import.meta.url),
		new URL(`../dist/${file}`, import.meta.url),
	)
}
await writeFile(
	new URL('../dist/package.json', import.meta.url),
	JSON.stringify(distribution, null, 2) + '\n',
)
