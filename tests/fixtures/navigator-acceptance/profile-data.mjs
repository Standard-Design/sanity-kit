import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const directory = await mkdtemp(join(tmpdir(), 'sanity-kit-navigator-profile-'))
const outfile = join(directory, 'profile.mjs')
try {
	await build({
		entryPoints: [fileURLToPath(new URL('./profile-data.ts', import.meta.url))],
		bundle: true,
		platform: 'node',
		format: 'esm',
		outfile,
	})
	await import(pathToFileURL(outfile).href)
} finally {
	await rm(directory, { recursive: true, force: true })
}
