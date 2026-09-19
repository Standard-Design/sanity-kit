import { describe, expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { createZodDecoder } from '../../src/validation/zod/index.js'

describe('createZodDecoder', () => {
	it('returns transformed output from asynchronous schemas', async () => {
		const decoder = createZodDecoder(
			z.object({
				title: z.string().transform(async (title) => {
					await Promise.resolve()
					return title.toUpperCase()
				}),
			}),
		)

		const result = await decoder.decode({ title: 'Page title' })

		expect(result).toEqual({
			success: true,
			value: { title: 'PAGE TITLE' },
			diagnostics: [],
		})

		if (result.success) {
			expectTypeOf(result.value).toEqualTypeOf<{ title: string }>()
		}
	})

	it('maps Zod issues to portable diagnostics', async () => {
		const decoder = createZodDecoder(
			z.object({
				sections: z.array(
					z.object({
						title: z.string(),
					}),
				),
			}),
		)

		const result = await decoder.decode({
			sections: [{ title: 42 }],
		})

		expect(result).toEqual({
			success: false,
			diagnostics: [
				{
					code: 'invalid_type',
					message: 'Invalid input: expected string, received number',
					path: ['sections', 0, 'title'],
					source: 'zod',
				},
			],
		})
	})
})
