/**
 * Apply app-owned URL reservations consistently to pages and redirect sources.
 * Callers validate configuration first. Prefixes match complete path segments:
 * /account owns /account/settings, but not /accounting. Root owns every path.
 */
export function isReservedPath(
	pathname: string,
	exactPaths: readonly string[] = [],
	prefixes: readonly string[] = [],
): boolean {
	return (
		exactPaths.includes(pathname) ||
		prefixes.some(
			(prefix) =>
				prefix === '/' ||
				pathname === prefix ||
				pathname.startsWith(`${prefix}/`),
		)
	)
}
