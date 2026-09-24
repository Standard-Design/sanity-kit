import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const git = (...args) =>
	execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
assert.equal(
	git('status', '--porcelain'),
	'',
	'Release artifacts require a clean, approved commit.',
)
const commit = git('rev-parse', 'HEAD')
const branch = git('branch', '--show-current')
const manifest = JSON.parse(
	await readFile(join(root, 'dist/package.json'), 'utf8'),
)
const destination = join(
	root,
	'.artifacts',
	`${manifest.version}-${commit.slice(0, 12)}`,
)
await mkdir(destination, { recursive: true })
const [packed] = JSON.parse(
	execFileSync(
		'npm',
		[
			'pack',
			'./dist',
			'--ignore-scripts',
			'--json',
			'--pack-destination',
			destination,
		],
		{ cwd: root, encoding: 'utf8' },
	),
)
const artifact = join(destination, packed.filename)
const sha256 = createHash('sha256')
	.update(await readFile(artifact))
	.digest('hex')
const metadata = {
	name: manifest.name,
	version: manifest.version,
	commit,
	branch,
	filename: packed.filename,
	sha256,
	integrity: packed.integrity,
	files: packed.files.map(({ path }) => path),
}
await writeFile(
	join(destination, 'manifest.json'),
	JSON.stringify(metadata, null, 2) + '\n',
)
await writeFile(
	join(destination, 'SHA256SUMS'),
	`${sha256}  ${packed.filename}\n`,
)
console.log(JSON.stringify({ artifact, ...metadata }, null, 2))
