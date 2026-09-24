throw new Error(
	'Do not pack or publish the repository root. Run pnpm test:package to verify, or pnpm pack:release from approved, clean history. npm publication remains disabled.',
)
