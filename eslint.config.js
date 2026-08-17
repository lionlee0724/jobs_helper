// ESLint 9 flat config（ESLINT_USE_FLAT_CONFIG 默认启用，替代旧 .eslintrc.js）。
// 用途：本仓 lint 基线门禁（`npm run lint`）。
// 说明：历史代码未经过 lint，故先启用非类型感知的 recommended 基线；
//       类型感知规则（recommendedTypeChecked）与 explicit-function-return-type
//       留待 R1 修正包按模块启用（见 docs/aegis/next-step-roadmap-2026-08-14.md R1）。
import js from '@eslint/js'
import tsParser from '@typescript-eslint/parser'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

export default [
  {
    ignores: ['dist/**', 'node_modules/**', '*.config.js'],
  },
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        tsconfigRootDir: rootDir,
        project: './tsconfig.json',
      },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      // TS 负责未定义变量检查，避免 no-undef 对 chrome/globalThis 等误报
      'no-undef': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      // 历史代码大多未标显式返回类型；R1 逐模块收紧
      '@typescript-eslint/explicit-function-return-type': 'off',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
]
