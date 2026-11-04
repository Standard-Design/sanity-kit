/**
 * The URL input checks a local proposal before handing it to Sanity. Native
 * document sync state cannot see that short interval. This small, scoped bridge
 * keeps Publish unavailable until the proposal is saved or discarded. Multiple
 * mounted inputs report independently, so one cannot clear another's work.
 */
import {
	useCallback,
	useLayoutEffect,
	useRef,
	useSyncExternalStore,
} from 'react'

export interface UrlPublicationScope {
	readonly projectId: string
	readonly dataset: string
	readonly documentId: string
}

const pending = new Map<string, Set<symbol>>()
const listeners = new Set<() => void>()
const scopeKey = ({ projectId, dataset, documentId }: UrlPublicationScope) =>
	JSON.stringify([projectId, dataset, documentId.replace(/^drafts\./u, '')])
const subscribe = (listener: () => void) => {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}
const notify = () => {
	for (const listener of listeners) listener()
}

/** Read again inside async handlers; a captured React value may already be stale. */
export function getUrlPublicationBlocked(scope: UrlPublicationScope): boolean {
	return (pending.get(scopeKey(scope))?.size ?? 0) > 0
}

export function useUrlPublicationBlocked(scope: UrlPublicationScope): boolean {
	const key = scopeKey(scope)
	const snapshot = useCallback(() => (pending.get(key)?.size ?? 0) > 0, [key])
	return useSyncExternalStore(subscribe, snapshot, () => false)
}

/** Clears only this input's report when it changes document or unmounts. */
export function useUrlPublicationState(
	scope: UrlPublicationScope,
	blocked: boolean,
): void {
	const token = useRef(Symbol('URL proposal')).current
	const key = scopeKey(scope)
	useLayoutEffect(() => {
		if (!blocked) return
		const reporters = pending.get(key) ?? new Set<symbol>()
		reporters.add(token)
		pending.set(key, reporters)
		notify()
		return () => {
			reporters.delete(token)
			if (reporters.size === 0) pending.delete(key)
			notify()
		}
	}, [key, token, blocked])
}
