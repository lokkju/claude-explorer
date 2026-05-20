import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Hunt #2: ban non-null assertions in production source. The prior
      // agent cleared the worst callsites (commits 977d0da, 10282a2);
      // this rule keeps them from regressing. `x!.foo` is almost always
      // a runtime lie — replace with `??` defaults, explicit
      // `if (!x) throw` guards, or optional-chain (`x?.foo`).
      // tseslint.configs.recommended has this as a WARNING; promote to
      // ERROR so a new `!.` blocks lint. Test directories opt out below
      // (fixture-shape narrowing is intentional there).
      '@typescript-eslint/no-non-null-assertion': 'error',
    },
  },
  {
    // Tests and e2e specs may use `!.` for fixture-shape narrowing —
    // the unit/Playwright assertion structure already guards against
    // null at the assertion site, so the `!.` is documented intent.
    files: ['src/test/**/*.{ts,tsx}', 'e2e/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
])
