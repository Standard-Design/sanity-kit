import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		coverage: {
			exclude: ['dist/**', 'tests/**'],
			provider: 'v8',
			reporter: ['text', 'json', 'html'],
		},
		include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
	},
})
