import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'src/components/__fixtures__/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
    rules: {
      'no-undef': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['src/components/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='useState']",
          message:
            'src/components/** may not hold local state (useState banned). Read from useVidgenStore (src/store/store.ts) via a selector instead.',
        },
        {
          selector: "CallExpression[callee.name='useReducer']",
          message:
            'src/components/** may not hold local state (useReducer banned). Read from useVidgenStore (src/store/store.ts) via a selector instead.',
        },
        {
          selector: "CallExpression[callee.name='useEffect']",
          message:
            'src/components/** may not run side effects (useEffect banned). Side effects (fetch, nats.ws) belong in src/store/store.ts, wired once at bootstrap in src/main.tsx.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@nats-io/*'],
              message:
                'nats.ws wiring belongs only in src/store/natsClient.ts. Dispatch store actions instead of importing NATS directly.',
            },
            {
              group: ['zustand', 'zustand/*'],
              message:
                "Import the typed hook from '../store/store' (useVidgenStore), not zustand directly — this keeps store construction in one place.",
            },
          ],
        },
      ],
    },
  },
)
