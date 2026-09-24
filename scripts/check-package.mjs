import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../', import.meta.url))
const temporary = await mkdtemp(join(tmpdir(), 'sanity-kit-package-'))
console.log(`Package checks: ${temporary}`)
const sourceManifest = JSON.parse(
	await readFile(join(root, 'package.json'), 'utf8'),
)
await mkdir(join(root, 'dist'), { recursive: true })
await writeFile(join(root, 'dist/__stale-build-sentinel.js'), 'stale')
run(process.execPath, [join(root, 'scripts/build.mjs')])
const distManifest = JSON.parse(
	await readFile(join(root, 'dist/package.json'), 'utf8'),
)

function run(command, args, cwd = root, capture = false) {
	const result = spawnSync(command, args, {
		cwd,
		encoding: 'utf8',
		stdio: capture ? 'pipe' : 'inherit',
	})
	if (result.error) throw result.error
	assert.equal(
		result.status,
		0,
		`${command} ${args.join(' ')} failed\n${result.stdout ?? ''}\n${result.stderr ?? ''}`,
	)
	return result.stdout
}

const guard = spawnSync('npm', ['pack', '--pack-destination', temporary], {
	cwd: root,
	encoding: 'utf8',
})
assert.notEqual(guard.status, 0, 'Repository-root packing must be blocked.')
assert.match(guard.stderr, /Do not pack or publish the repository root/u)
const [packed] = JSON.parse(
	run(
		'npm',
		[
			'pack',
			'./dist',
			'--ignore-scripts',
			'--json',
			'--pack-destination',
			temporary,
		],
		root,
		true,
	),
)
const tarball = join(temporary, packed.filename)
const contents = new Set(packed.files.map(({ path }) => path))
assert.equal(
	contents.has('__stale-build-sentinel.js'),
	false,
	'Build must remove stale output.',
)
for (const path of contents) {
	assert.ok(
		!path.startsWith('dist/') && !path.startsWith('src/'),
		`Unexpected source/build prefix: ${path}`,
	)
	assert.ok(
		path.endsWith('.js') ||
			path.endsWith('.d.ts') ||
			/^(package.json|README.md|LICENSE|CHANGELOG.md|docs\/(sitemaps|prerelease).md)$/u.test(
				path,
			),
		`Unexpected packed file: ${path}`,
	)
	const content = await readFile(join(root, 'dist', path), 'utf8')
	assert.doesNotMatch(
		content,
		/sourceMappingURL|sourcesContent/u,
		`Source map embedded in ${path}`,
	)
}
for (const required of [
	'README.md',
	'LICENSE',
	'CHANGELOG.md',
	'docs/sitemaps.md',
	'docs/prerelease.md',
])
	assert.ok(contents.has(required), `Missing ${required}`)
assert.equal(distManifest.private, true)
for (const field of ['scripts', 'devDependencies', 'packageManager'])
	assert.equal(
		field in distManifest,
		false,
		`Unexpected distribution field: ${field}`,
	)
assert.deepEqual(
	Object.keys(distManifest.exports),
	Object.keys(sourceManifest.exports),
)
for (const target of Object.values(distManifest.exports)) {
	for (const path of typeof target === 'string'
		? [target]
		: Object.values(target))
		assert.ok(contents.has(path.slice(2)), `Missing export target: ${path}`)
}

const installedVersion = async (name) =>
	JSON.parse(
		await readFile(join(root, 'node_modules', name, 'package.json'), 'utf8'),
	).version
const current = Object.fromEntries(
	await Promise.all(
		Object.keys(sourceManifest.peerDependencies).map(async (name) => [
			name,
			await installedVersion(name),
		]),
	),
)
const types = Object.fromEntries(
	await Promise.all(
		['@types/node', '@types/react', '@types/react-dom'].map(async (name) => [
			name,
			await installedVersion(name),
		]),
	),
)
// Explicit peers avoid accidentally testing only the workspace's transitive graph.
const minimum = {
	...current,
	'@sanity/client': '7.27.0',
	'@sanity/preview-url-secret': '3.0.0',
	'@sanity/image-url': '2.1.1',
	'@sanity/visual-editing': '6.1.2',
	groq: '5.1.0',
	react: '19.2.7',
	'react-dom': '19.2.7',
	'react-router': '8.4.0',
	zod: '4.6.5',
}
const matrices = [
	{
		name: 'minimal',
		peers: {
			'@sanity/client': current['@sanity/client'],
			'@types/node': types['@types/node'],
		},
		full: false,
	},
	{ name: 'current', peers: { ...current, ...types }, full: true },
	{ name: 'minimum', peers: { ...minimum, ...types }, full: true },
	{
		name: 'standard-stack',
		peers: { ...current, ...types, '@sanity/client': '7.27.0' },
		full: true,
	},
]

for (const matrix of matrices) {
	const cwd = join(temporary, matrix.name)
	await mkdir(cwd)
	await writeFile(
		join(cwd, 'package.json'),
		JSON.stringify(
			{
				name: `sanity-kit-consumer-${matrix.name}`,
				private: true,
				type: 'module',
				dependencies: {
					'@standard/sanity-kit': `file:${tarball}`,
					...matrix.peers,
				},
			},
			null,
			2,
		),
	)
	if (matrix.name === 'standard-stack') {
		run(
			'pnpm',
			[
				'install',
				'--ignore-scripts',
				'--strict-peer-dependencies',
				'--no-frozen-lockfile',
			],
			cwd,
		)
	} else {
		run(
			'npm',
			[
				'install',
				'--ignore-scripts',
				'--strict-peer-deps',
				'--no-audit',
				'--no-fund',
			],
			cwd,
		)
	}
	const installed = JSON.parse(
		await readFile(
			join(cwd, 'node_modules/@standard/sanity-kit/package.json'),
			'utf8',
		),
	)
	assert.deepEqual(installed, distManifest)
	await copyFile(
		join(root, 'tests/package/runtime.mjs'),
		join(cwd, 'runtime.mjs'),
	)
	run(
		process.execPath,
		['runtime.mjs', ...(matrix.full ? ['--full'] : [])],
		cwd,
	)
	await copyFile(
		join(root, `tests/package/${matrix.full ? 'full.tsx' : 'minimal.ts'}`),
		join(cwd, 'consumer.tsx'),
	)
	await writeFile(
		join(cwd, 'tsconfig.json'),
		JSON.stringify({
			compilerOptions: {
				strict: true,
				exactOptionalPropertyTypes: true,
				noEmit: true,
				target: 'ES2024',
				module: 'NodeNext',
				moduleResolution: 'NodeNext',
				jsx: 'react-jsx',
				lib: ['ES2024', 'DOM', 'DOM.Iterable'],
				types: matrix.full ? ['node', 'react', 'react-dom'] : ['node'],
				skipLibCheck: false,
			},
			include: ['consumer.tsx'],
		}),
	)
	run(
		process.execPath,
		[join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'],
		cwd,
	)
	if (matrix.full) {
		await copyFile(
			join(root, 'tests/package/visual.tsx'),
			join(cwd, 'consumer.tsx'),
		)
		// Upstream Visual Editing declarations currently fail strict library checks.
		// Keep strict checking for our ordinary declarations; check adapter usage
		// separately with the same skipLibCheck used by the host application.
		run(
			process.execPath,
			[
				join(root, 'node_modules/typescript/bin/tsc'),
				'-p',
				'tsconfig.json',
				'--skipLibCheck',
			],
			cwd,
		)
	}
	await checkBrowserBundles(cwd, matrix.full)
	console.log(`PASS ${matrix.name}: ${JSON.stringify(matrix.peers)}`)
}
console.log(
	`Verified ${contents.size} packed files; tarball ${tarball}; integrity ${packed.integrity}`,
)

async function checkBrowserBundles(cwd, full) {
	const modules = [
		'',
		'/core',
		'/link',
		'/sitemap',
		...(full
			? ['/image', '/image/react', '/react-router', '/validation/zod']
			: []),
	]
	await writeFile(
		join(cwd, 'browser.js'),
		modules
			.map(
				(suffix, index) =>
					`import * as api${index} from '@standard/sanity-kit${suffix}'; console.log(api${index});`,
			)
			.join('\n'),
	)
	const options = {
		absWorkingDir: cwd,
		bundle: true,
		platform: 'browser',
		format: 'esm',
		write: false,
		metafile: true,
		logLevel: 'silent',
	}
	const normal = await build({ ...options, entryPoints: ['browser.js'] })
	for (const path of Object.keys(normal.metafile.inputs)) {
		assert.doesNotMatch(
			path,
			/@sanity\/(visual-editing|preview-url-secret)|sanity-kit\/react-router\/server/u,
		)
		if (!full)
			assert.doesNotMatch(
				path,
				/node_modules\/(react|react-dom|react-router|zod)\//u,
			)
	}
	if (!full) return
	await writeFile(
		join(cwd, 'preview.js'),
		"export { SanityVisualEditing } from '@standard/sanity-kit/react-router/visual-editing'",
	)
	const preview = await build({
		...options,
		entryPoints: ['preview.js'],
		splitting: true,
		outdir: 'bundle',
	})
	const outputs = preview.metafile.outputs
	const entry = Object.keys(outputs).find(
		(path) => outputs[path].entryPoint === 'preview.js',
	)
	assert.ok(entry, 'Preview bundle entry is missing.')
	const seen = new Set()
	function checkStatic(path) {
		if (seen.has(path)) return
		seen.add(path)
		const output = outputs[path]
		assert.ok(output, `Missing bundle chunk ${path}`)
		for (const input of Object.keys(output.inputs))
			assert.doesNotMatch(
				input,
				/node_modules\/@sanity\/visual-editing\//u,
				'Overlay code leaked into the initial preview bundle.',
			)
		for (const edge of output.imports)
			if (!edge.external && edge.kind !== 'dynamic-import') {
				const next = Object.keys(outputs).find(
					(candidate) =>
						resolve(cwd, candidate) === resolve(cwd, edge.path) ||
						resolve(cwd, candidate) === resolve(cwd, dirname(path), edge.path),
				)
				assert.ok(next, `Unknown chunk import ${edge.path}`)
				checkStatic(next)
			}
	}
	checkStatic(entry)
	assert.ok(
		Object.entries(outputs).some(
			([path, output]) =>
				!seen.has(path) &&
				Object.keys(output.inputs).some((input) =>
					input.includes('node_modules/@sanity/visual-editing/'),
				),
		),
		'Expected a separate lazy overlay chunk.',
	)
}
