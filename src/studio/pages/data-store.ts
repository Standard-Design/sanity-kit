/** Tool-scoped sessions: no module-global cache or cross-workspace data sharing. */
import type { PagesRuntime } from './runtime.js'
import { createPagesDataSource, type PagesClient } from './data-source.js'
import { createPagesDataSession } from './data-session.js'

export function createPagesDataStore(
	runtime: PagesRuntime,
	onPathsChanged?: () => void,
) {
	const clients = new WeakMap<
		PagesClient,
		Map<string, ReturnType<typeof createPagesDataSession>>
	>()
	const allSessions = new Set<ReturnType<typeof createPagesDataSession>>()
	return {
		refreshFolders: () => {
			for (const session of allSessions) session.refreshFolders()
		},
		session(client: PagesClient, perspective: readonly string[]) {
			const key = JSON.stringify(perspective)
			let sessions = clients.get(client)
			if (!sessions) {
				sessions = new Map()
				clients.set(client, sessions)
			}
			let session = sessions.get(key)
			if (!session) {
				session = createPagesDataSession(
					runtime,
					createPagesDataSource(client, perspective, runtime.model.types),
					onPathsChanged,
				)
				allSessions.add(session)
				sessions.set(key, session)
			}
			return session
		},
	}
}
