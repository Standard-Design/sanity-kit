import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
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
const publishGuard = spawnSync('npm', ['publish', '--dry-run'], {
	cwd: root,
	encoding: 'utf8',
})
assert.notEqual(
	publishGuard.status,
	0,
	'Repository-root publishing must be blocked.',
)
assert.match(publishGuard.stderr, /Do not pack or publish the repository root/u)
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
// Check the actual packed files, not just the build directory or file names.
// Keep the full permission notice and warranty disclaimer intact in distribution.
const sourceLicense = await readFile(join(root, 'LICENSE'), 'utf8')
assert.match(
	sourceLicense,
	/^MIT License\n\nCopyright \(c\) 2026 Standard Design LLC\n/u,
)
assert.equal(
	run('tar', ['-xOf', tarball, 'package/LICENSE'], root, true),
	sourceLicense,
	'Packed LICENSE must preserve the complete source license.',
)
const packedManifest = JSON.parse(
	run('tar', ['-xOf', tarball, 'package/package.json'], root, true),
)
assert.equal(sourceManifest.license, 'MIT')
assert.equal(distManifest.license, 'MIT')
assert.equal(packedManifest.license, 'MIT')
assert.equal(sourceManifest.name, '@standard-design/sanity-kit')
assert.equal(packedManifest.name, sourceManifest.name)
// Exclude deprecated client 8.6.0 in the actual consumer-facing manifest too.
for (const manifest of [sourceManifest, distManifest, packedManifest]) {
	assert.equal(manifest.peerDependencies['@sanity/client'], '^7.27.0 || ^8.6.1')
}
assert.equal(
	packed.filename,
	`standard-design-sanity-kit-${sourceManifest.version}.tgz`,
)
const notices = await readFile(join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8')
assert.match(notices, /Copyright \(c\) 2025 Sanity\.io/u)
assert.match(notices, /Tinloof/u)
assert.equal(
	run('tar', ['-xOf', tarball, 'package/THIRD_PARTY_NOTICES.md'], root, true),
	notices,
	'Packed third-party notices must match the source notices in full.',
)
// Never remove --dry-run here: CI checks publication shape, not credentials,
// registry ownership, attribution clearance, or permission to release.
const publication = JSON.parse(
	run(
		'npm',
		[
			'publish',
			tarball,
			'--dry-run',
			'--ignore-scripts',
			'--json',
			'--access',
			'public',
			'--tag',
			'alpha',
			'--registry',
			'https://registry.npmjs.org/',
		],
		root,
		true,
	),
)
// npm may key publish results by package name rather than return one pack result.
const published = publication[sourceManifest.name] ?? publication
assert.equal(published.name, sourceManifest.name)
assert.equal(published.version, sourceManifest.version)
assert.equal(published.integrity, packed.integrity)
assert.deepEqual(published.files, packed.files)
assert.deepEqual(published.bundled, [])
// Validate the exact artifact installed below, not the source manifest.
run('pnpm', ['exec', 'publint', tarball, '--strict'])
run('pnpm', ['exec', 'attw', tarball, '--profile', 'esm-only'])
const contents = new Set(packed.files.map(({ path }) => path))
// Studio is opt-in: its files ship, but frontend entry points must not load it.
assert.ok(Object.keys(packedManifest.exports).includes('./studio'))
assert.ok(contents.has('studio/index.js'))
const studioPeers = [
	'sanity',
	'@sanity/ui',
	'styled-components',
	'react-focus-lock',
]
for (const name of studioPeers)
	assert.equal(packedManifest.peerDependenciesMeta[name]?.optional, true)
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
			/^(package\.json|README\.md|LICENSE|THIRD_PARTY_NOTICES\.md|CHANGELOG\.md|docs\/(README|core|image|image-react|link|pages|react-router|server|visual-editing|validation-zod|extraction-provenance|sitemaps|prerelease|loaders)\.md)$/u.test(
				path,
			),
		`Unexpected packed file: ${path}`,
	)
	const content = await readFile(join(root, 'dist', path), 'utf8')
	assert.doesNotMatch(
		content,
		/\/Users\/|\/home\/|Sawkill|sawkill-lumber/u,
		`Private workstation or project detail in ${path}`,
	)
	assert.doesNotMatch(
		content,
		/sourceMappingURL|sourcesContent/u,
		`Source map embedded in ${path}`,
	)
}
for (const required of [
	'README.md',
	'LICENSE',
	'THIRD_PARTY_NOTICES.md',
	'CHANGELOG.md',
	'docs/sitemaps.md',
	'docs/prerelease.md',
	'docs/loaders.md',
	'docs/README.md',
	'docs/core.md',
	'docs/image.md',
	'docs/image-react.md',
	'docs/link.md',
	'docs/pages.md',
	'docs/react-router.md',
	'docs/server.md',
	'docs/visual-editing.md',
	'docs/validation-zod.md',
	'docs/extraction-provenance.md',
])
	assert.ok(contents.has(required), `Missing ${required}`)
assert.equal(sourceManifest.private, true)
assert.equal(distManifest.private, false)
assert.deepEqual(distManifest.publishConfig, {
	access: 'public',
	tag: 'alpha',
	registry: 'https://registry.npmjs.org/',
})
assert.deepEqual(packedManifest, distManifest)
assert.deepEqual(distManifest.dependencies, sourceManifest.dependencies)
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
		Object.keys(sourceManifest.peerDependencies)
			.filter((name) => !studioPeers.includes(name))
			.map(async (name) => [name, await installedVersion(name)]),
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
		name: 'minimum-client-8',
		peers: { ...current, ...types, '@sanity/client': '8.6.1' },
		full: true,
	},
	{
		name: 'standard-stack',
		peers: { ...current, ...types, '@sanity/client': '7.27.0' },
		full: true,
	},
]

// A strict consumer must reject the deprecated release rather than silently
// accepting it or satisfying the kit with a second nested client installation.
const deprecatedClientConsumer = join(temporary, 'deprecated-client')
await mkdir(deprecatedClientConsumer)
await writeFile(
	join(deprecatedClientConsumer, 'package.json'),
	JSON.stringify({
		name: 'sanity-kit-consumer-deprecated-client',
		private: true,
		type: 'module',
		dependencies: {
			'@standard-design/sanity-kit': `file:${tarball}`,
			'@sanity/client': '8.6.0',
		},
	}),
)
const deprecatedClientInstall = spawnSync(
	'npm',
	[
		'install',
		'--ignore-scripts',
		'--strict-peer-deps',
		'--no-audit',
		'--no-fund',
	],
	{ cwd: deprecatedClientConsumer, encoding: 'utf8' },
)
if (deprecatedClientInstall.error) throw deprecatedClientInstall.error
assert.notEqual(deprecatedClientInstall.status, 0)
assert.match(deprecatedClientInstall.stderr, /ERESOLVE/u)
assert.match(
	deprecatedClientInstall.stderr,
	/peer @sanity\/client@"\^7\.27\.0 \|\| \^8\.6\.1"/u,
)
console.log('Deprecated client 8.6.0 rejected by strict consumer installation.')

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
					'@standard-design/sanity-kit': `file:${tarball}`,
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
			join(cwd, 'node_modules/@standard-design/sanity-kit/package.json'),
			'utf8',
		),
	)
	assert.deepEqual(installed, distManifest)
	// Visual Editing already depends on Sanity UI/styled-components. Minimal
	// consumers need none of these; full frontend consumers must still lack Sanity.
	for (const name of matrix.full ? ['sanity'] : studioPeers) {
		assert.equal(
			existsSync(join(cwd, 'node_modules', name)),
			false,
			`Frontend consumer unexpectedly installed Studio peer ${name}`,
		)
	}
	const installedClient = JSON.parse(
		await readFile(
			join(cwd, 'node_modules/@sanity/client/package.json'),
			'utf8',
		),
	)
	assert.equal(installedClient.version, matrix.peers['@sanity/client'])
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

// Install the packed Studio entry separately. This does not let source aliases
// or the repository's node_modules hide missing exports or peer requirements.
const studioConsumer = join(temporary, 'studio-consumer')
await mkdir(studioConsumer)
const studioVersions = Object.fromEntries(
	await Promise.all(
		studioPeers.map(async (name) => [name, await installedVersion(name)]),
	),
)
await writeFile(
	join(studioConsumer, 'package.json'),
	JSON.stringify({
		name: 'sanity-kit-studio-consumer',
		private: true,
		type: 'module',
		dependencies: {
			'@standard-design/sanity-kit': `file:${tarball}`,
			...studioVersions,
			groq: current.groq,
			'@sanity/client': current['@sanity/client'],
			react: current.react,
			'react-dom': current['react-dom'],
			...types,
		},
	}),
)
run(
	'npm',
	[
		'install',
		'--ignore-scripts',
		'--strict-peer-deps',
		'--no-audit',
		'--no-fund',
	],
	studioConsumer,
)
await copyFile(
	join(root, 'tests/package/studio.tsx'),
	join(studioConsumer, 'consumer.tsx'),
)
await writeFile(
	join(studioConsumer, 'tsconfig.json'),
	JSON.stringify({
		compilerOptions: {
			strict: true,
			exactOptionalPropertyTypes: true,
			noEmit: true,
			target: 'ES2024',
			module: 'NodeNext',
			moduleResolution: 'NodeNext',
			jsx: 'react-jsx',
			skipLibCheck: true,
		},
		include: ['consumer.tsx'],
	}),
)
run(
	process.execPath,
	[join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'],
	studioConsumer,
)
const studioBundle = await build({
	absWorkingDir: studioConsumer,
	entryPoints: ['consumer.tsx'],
	// Native Studio imports CSS. Give the in-memory build an output directory
	// so styles are compiled rather than ignored or replaced by a test stub.
	outdir: 'bundle',
	bundle: true,
	platform: 'browser',
	format: 'esm',
	write: false,
	metafile: true,
	logLevel: 'silent',
})
assert.ok(
	Object.keys(studioBundle.metafile.inputs).some((path) =>
		path.includes('sanity-kit/studio/pages/plugin.js'),
	),
)
console.log(`PASS studio-consumer: ${JSON.stringify(studioVersions)}`)

// Exercise Sanity's real static resolver from a sibling Studio workspace,
// not a custom resolver or source-tree import that bypasses package exports.
const codegenRoot = join(temporary, 'typegen-workspace')
const studio = join(codegenRoot, 'apps/studio')
const web = join(codegenRoot, 'apps/web')
await mkdir(studio, { recursive: true })
await mkdir(join(web, 'app/data'), { recursive: true })
await writeFile(
	join(codegenRoot, 'package.json'),
	JSON.stringify({
		name: 'sanity-kit-typegen-workspace',
		private: true,
		packageManager: sourceManifest.packageManager,
	}),
)
await writeFile(
	join(codegenRoot, 'pnpm-workspace.yaml'),
	"packages:\n  - 'apps/*'\n",
)
for (const [cwd, name] of [
	[studio, 'studio'],
	[web, 'web'],
]) {
	await writeFile(
		join(cwd, 'package.json'),
		JSON.stringify({
			name: `sanity-kit-typegen-${name}`,
			private: true,
			type: 'module',
			devDependencies: {
				'@standard-design/sanity-kit': `file:${tarball}`,
				'@sanity/client': current['@sanity/client'],
				...(name === 'studio'
					? { '@sanity/codegen': '8.1.0' }
					: { groq: current.groq }),
			},
		}),
	)
}
await writeFile(
	join(studio, 'tsconfig.json'),
	JSON.stringify({
		compilerOptions: { module: 'ESNext', moduleResolution: 'Bundler' },
	}),
)
await copyFile(
	join(root, 'tests/package/typegen.mjs'),
	join(studio, 'typegen.mjs'),
)
await copyFile(
	join(root, 'tests/package/typegen-queries.ts'),
	join(web, 'app/data/queries.ts'),
)
run(
	'pnpm',
	[
		'install',
		'--ignore-scripts',
		'--strict-peer-dependencies',
		'--no-frozen-lockfile',
	],
	codegenRoot,
)
run(process.execPath, ['typegen.mjs'], studio)
console.log(
	'PASS typegen-workspace: Studio codegen resolves installed kit fragments from sibling web queries.',
)
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
					`import * as api${index} from '@standard-design/sanity-kit${suffix}'; console.log(api${index});`,
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
			/node_modules\/(sanity|@sanity\/ui|styled-components|react-focus-lock)\/|sanity-kit\/studio\//u,
			'Studio code leaked into a frontend entry point.',
		)
		assert.doesNotMatch(
			path,
			/@sanity\/(visual-editing|preview-url-secret)|sanity-kit\/react-router\/server/u,
		)
		if (!full)
			assert.doesNotMatch(
				path,
				/node_modules\/(react|react-dom|react-router|zod|@sanity\/asset-utils)\//u,
			)
	}
	if (!full) return
	await writeFile(
		join(cwd, 'preview.js'),
		"export { SanityVisualEditing } from '@standard-design/sanity-kit/react-router/visual-editing'",
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
