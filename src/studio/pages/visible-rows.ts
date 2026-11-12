/** A visible preorder, independent of which rows happen to be mounted. */
import type { PageDocument } from './model.js'
import type {
	NavigationNode,
	NavigationCollection,
	NavigationPage,
} from './navigation.js'

export type VisibleRow = {
	key: string
	depth: number
	/** Space after this row, at each ancestor's indentation. */
	spacing: number[]
} & (
	| { kind: 'page'; document: PageDocument }
	| {
			kind: 'group'
			node: Exclude<NavigationNode, NavigationPage>
			open: boolean
	  }
	| { kind: 'note'; text: string }
	| { kind: 'heading'; text: string }
	| { kind: 'recent'; node: NavigationCollection }
)

export function pageRows(documents: readonly PageDocument[]): VisibleRow[] {
	return documents.map((document, index) => ({
		kind: 'page',
		key: `page:${document._id}`,
		document,
		depth: 0,
		spacing: [index < documents.length - 1 ? 4 : 0],
	}))
}

export function visibleTreeRows(
	nodes: readonly NavigationNode[],
	collapsed: readonly string[],
	unfiled: readonly NavigationPage[] = [],
): VisibleRow[] {
	const rows: VisibleRow[] = []
	const closed = new Set(collapsed)
	const space = (depth: number, amount: number) => {
		const last = rows.at(-1)
		if (last) last.spacing[depth] = (last.spacing[depth] ?? 0) + amount
	}
	function walk(entries: readonly NavigationNode[], depth: number) {
		entries.forEach((node, index) => {
			if (node.kind === 'page') {
				rows.push({
					kind: 'page',
					key: node.key,
					document: node.document,
					depth,
					spacing: [],
				})
			} else {
				const open = !closed.has(node.key)
				rows.push({
					kind: 'group',
					key: node.key,
					node,
					open,
					depth,
					spacing: [],
				})
				if (open) {
					const note = (text: string) =>
						rows.push({
							kind: 'note',
							key: `${node.key}:note`,
							text,
							depth: depth + 1,
							spacing: [],
						})
					if (node.kind === 'folder' && node.children.length === 0)
						note('No pages in this folder.')
					if (node.kind === 'collection') {
						if (node.indexPages.length === 0) note('No index page')
						if (node.indexPages.length > 1)
							note('Multiple index pages share this URL.')
						for (const page of node.indexPages)
							rows.push({
								kind: 'page',
								key: page.key,
								document: page.document,
								depth: depth + 1,
								spacing: [],
							})
					}
					walk(node.children, depth + 1)
					if (node.kind === 'collection')
						rows.push({
							kind: 'recent',
							key: `${node.key}:recent`,
							node,
							depth: depth + 1,
							spacing: [],
						})
					if (index < entries.length - 1) space(depth, 12)
				}
			}
			if (index < entries.length - 1) space(depth, 4)
		})
	}
	walk(nodes, 0)
	for (const [title, pages] of [
		['Pages without URLs', unfiled.filter((page) => !page.pathname)],
		['Ungrouped pages', unfiled.filter((page) => page.pathname)],
	] as const) {
		if (!pages.length) continue
		space(0, 12)
		rows.push({
			kind: 'heading',
			key: `heading:${title}`,
			text: title,
			depth: 0,
			spacing: [4],
		})
		pages.forEach((page, index) =>
			rows.push({
				kind: 'page',
				key: page.key,
				document: page.document,
				depth: 0,
				spacing: [index < pages.length - 1 ? 4 : 0],
			}),
		)
	}
	return rows
}
