/**
 * Turn lightweight page records into navigation groups, without changing content.
 * This is the data model for the approved navigator, not a second document router.
 * It is tested independently of the browser that renders it. See
 * docs/pages.md: “Navigator data foundation” for the rollout boundary.
 */
import type { PageDocument } from './model.js'
import { registeredPathname, type PagesRegistry } from './registry.js'

export interface NavigationPage {
	kind: 'page'
	/** Document identity survives a title or URL change. */
	key: string
	document: PageDocument
	pathname: string | undefined
}

export interface NavigationFolder {
	kind: 'folder'
	key: string
	name: string
	pathname: string
	/** Index pages are ordinary children with their real titles, not “Index” rows. */
	children: NavigationNode[]
}

export interface NavigationCollection {
	kind: 'collection'
	key: string
	name: string
	title: string
	pathname: string
	/** Zero means missing; more than one is ambiguous. Never pick an arbitrary one. */
	overviews: NavigationPage[]
	/** Ordinary pages nested below the overview URL remain visible here. */
	children: NavigationNode[]
}

export type NavigationNode =
	NavigationPage | NavigationFolder | NavigationCollection

/**
 * Some valid app URLs contain repeated or trailing separators. Keep those URLs
 * unchanged, but do not pretend they describe ordinary named folders. Such pages
 * remain reachable in the unfiled list; “unfiled” does not mean uneditable.
 */
function canGroup(path: string): boolean {
	return path === '/' || (!path.endsWith('/') && !path.includes('//'))
}

function parentPath(path: string): string {
	return path.slice(0, path.lastIndexOf('/')) || '/'
}

function compare(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Input must be the COMPLETE ordinary-page snapshot for ONE effective Sanity
 * perspective. Content Lake chooses drafts/releases before this function runs.
 * Collection items belong in their own queries and must not become page folders.
 * No folder documents, empty folders, or parent references are created here.
 */
export function buildNavigationTree(
	registry: PagesRegistry,
	documents: readonly PageDocument[],
) {
	const roots: NavigationNode[] = []
	const unfiled: NavigationPage[] = []
	const folders = new Map<string, NavigationFolder>()
	const collections = registry.collections.map<NavigationCollection>(
		(collection) => ({
			kind: 'collection',
			key: `collection:${collection.name}`,
			name: collection.name,
			title: collection.title,
			pathname: collection.overview.pathname,
			overviews: [],
			children: [],
		}),
	)
	const groups = new Map<string, NavigationFolder | NavigationCollection>(
		collections.map((collection) => [collection.pathname, collection]),
	)
	const collectionByPath = new Map(
		collections.map((collection) => [collection.pathname, collection]),
	)
	const overviewTypes = new Map(
		registry.collections.map((collection) => [
			collection.name,
			collection.overview.schemaType,
		]),
	)
	const ordinaryTypes = new Set(
		registry.types
			.filter((type) => !type.collection)
			.map((type) => type.schemaType),
	)
	const seen = new Set<string>()
	const pages = documents.filter((document) =>
		ordinaryTypes.has(document._type),
	)
	const page = (document: PageDocument): NavigationPage => ({
		kind: 'page',
		key: `page:${document._id}`,
		document,
		pathname: registeredPathname(registry, document._type, document.pathname),
	})
	// Use iteration, not recursion: deeply nested authored paths must not exhaust
	// the JavaScript call stack. A folder is inferred only when it has descendants.
	function ensureAncestors(path: string) {
		const ancestors: string[] = []
		let parent = parentPath(path)
		while (parent !== '/' && !groups.has(parent)) {
			ancestors.push(parent)
			parent = parentPath(parent)
		}
		for (const pathname of ancestors.reverse()) {
			const folder: NavigationFolder = {
				kind: 'folder',
				key: `folder:${pathname}`,
				name: pathname.slice(pathname.lastIndexOf('/') + 1),
				pathname,
				children: [],
			}
			folders.set(pathname, folder)
			groups.set(pathname, folder)
		}
	}
	for (const document of pages) {
		if (
			seen.has(document._id) ||
			document._id.startsWith('drafts.') ||
			document._id.startsWith('versions.')
		)
			throw new Error(
				'Pages navigation requires one effective document per ID, not raw versions.',
			)
		seen.add(document._id)
		const path = page(document).pathname
		if (path && canGroup(path)) ensureAncestors(path)
	}
	for (const collection of collections) {
		// A missing overview still has a collection group. It is not a fabricated
		// overview page, and offers no invented editor ID or preview selection.
		if (canGroup(collection.pathname)) ensureAncestors(collection.pathname)
	}
	for (const group of groups.values()) {
		const parent = canGroup(group.pathname) ? parentPath(group.pathname) : '/'
		// The root is represented by the Pages heading, even when a collection's
		// overview itself lives at /. Do not put every site page in that collection.
		;(parent === '/' ? roots : groups.get(parent)!.children).push(group)
	}
	for (const document of pages) {
		const entry = page(document)
		const collection = collectionByPath.get(entry.pathname ?? '')
		if (collection && overviewTypes.get(collection.name) === document._type)
			collection.overviews.push(entry)
		else if (!entry.pathname || !canGroup(entry.pathname)) unfiled.push(entry)
		else {
			// /about belongs inside the /about folder when descendants establish
			// that folder; otherwise it is a regular page directly under the root.
			const path = parentPath(entry.pathname)
			const parent =
				folders.get(entry.pathname) ??
				(path === '/' ? undefined : groups.get(path))
			;(parent?.children ?? roots).push(entry)
		}
	}
	const sortNodes = (nodes: NavigationNode[], indexPath: string) => {
		const rank = (node: NavigationNode) =>
			node.kind === 'page' ? (node.pathname === indexPath ? 0 : 2) : 1
		const label = (node: NavigationNode) =>
			node.kind === 'page' ? (node.document.title ?? '') : node.pathname
		nodes.sort(
			(a, b) =>
				rank(a) - rank(b) ||
				compare(label(a), label(b)) ||
				compare(a.key, b.key),
		)
	}
	sortNodes(roots, '/')
	for (const folder of folders.values())
		sortNodes(folder.children, folder.pathname)
	for (const collection of collections) {
		sortNodes(collection.overviews, collection.pathname)
		sortNodes(collection.children, collection.pathname)
	}
	sortNodes(unfiled, '')
	return { roots, unfiled }
}
