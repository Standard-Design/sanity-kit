import js from '@eslint/js'
import eslintConfigPrettier from 'eslint-config-prettier'
import tseslint from 'typescript-eslint'

export default tseslint.config(
	{
		ignores: ['coverage/**', 'dist/**', 'node_modules/**'],
	},
	js.configs.recommended,
	...tseslint.configs.recommendedTypeChecked,
	{
		files: ['**/*.ts', '**/*.tsx'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
	{
		files: ['**/*.js', '**/*.mjs'],
		...tseslint.configs.disableTypeChecked,
		languageOptions: {
			globals: {
				console: 'readonly',
				process: 'readonly',
				Request: 'readonly',
				URL: 'readonly',
			},
		},
	},
	eslintConfigPrettier,
)
