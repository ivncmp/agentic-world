import js from '@eslint/js'
import tseslint from 'typescript-eslint'

/**
 * ESLint is here to catch mistakes, not to argue about layout — Prettier owns
 * formatting, so no stylistic rule appears below.
 *
 * The project-specific rules are at the bottom. They encode constraints that
 * are load-bearing for the simulation rather than matters of taste: the tick
 * loop has to stay deterministic, and the viewer has to draw the same town for
 * every spectator.
 */
export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'logs/', 'src/viewer/public/', 'tools/**/index.html'] },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // An unused symbol is usually a leftover from a refactor. Underscore
      // prefix opts out, for the arguments a signature requires but ignores.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],

      // A floating promise in the tick host means work that silently never
      // happened. `void` marks the deliberate fire-and-forget calls.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',

      // Model responses arrive as `unknown` and every route hand-validates
      // them, so member access on a parsed body is normal here.
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',

      // `!` is used deliberately after a bounds check the compiler cannot see.
      '@typescript-eslint/no-non-null-assertion': 'off',

      // `MemoryStore` is async because dbrain is over HTTP. The in-memory
      // implementation satisfies the same interface without awaiting anything,
      // and that is the point of having two implementations.
      '@typescript-eslint/require-await': 'off',

      // Passing a static method or a destructured helper by reference is
      // deliberate where it appears; none of them read `this`.
      '@typescript-eslint/unbound-method': 'off',

      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/await-thenable': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'off',
    },
  },

  {
    // The tick loop is a pure function and two runs with the same seed must
    // agree. Randomness comes from the injected `deps.random`.
    files: ['src/engine/**/*.ts', 'src/cognition/gate.ts'],
    ignores: ['**/__tests__/**'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'the tick must stay deterministic — use deps.random' },
        { object: 'Date', property: 'now', message: 'the tick reads game time from the clock, not wall time' },
      ],
    },
  },

  {
    // Only venues come from the engine; everything else the viewer draws is
    // chosen by a stable hash, so two spectators see the same town.
    files: ['src/viewer/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'the viewer must render identically everywhere — use hash() from core/hash.js',
        },
      ],
    },
  },

  {
    files: ['**/__tests__/**/*.ts', 'tools/**/*.mjs', '*.config.js', '*.config.ts'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
)
