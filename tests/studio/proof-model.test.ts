import { describe, expect, it } from 'vitest'
import {
	previewPath,
	previewedDocument,
} from '../fixtures/pages-studio/model.js'

describe('Pages integration proof routing', () => {
	it.each(['/', '/about', '/about/team', '/journal/first-post'])(
		'accepts the canonical path %s',
		(path) => {
			expect(previewPath(path)).toBe(path)
		},
	)
	it.each([
		null,
		undefined,
		'',
		'about',
		'//other.test',
		'https://other.test',
		'/a\\b',
		'/a b',
		'/a?b',
		'/a#b',
		'/a/../b',
		'/%2e%2e/b',
		'/bad%zz',
	])('does not navigate an invalid path %s', (path) => {
		expect(previewPath(path)).toBeUndefined()
	})
	it('resolves the previewed page independently of the edited document', () => {
		const page = {
			_id: 'page',
			_type: 'kitProofPage',
			title: 'About',
			pathname: '/about',
		}
		const shared = {
			_id: 'shared',
			_type: 'kitProofShared',
			title: 'Footer',
			pathname: null,
		}
		expect(previewedDocument([page, shared], '/about?campaign=1')).toBe(page)
		expect(previewedDocument([shared], '/about')).toBeUndefined()
		expect(previewedDocument([page, shared])).toBeUndefined()
	})
})
