import { defineConfig } from 'vitest/config'

/**
 * Separate from vite.config.ts on purpose. That file sets `root: 'src/viewer'`
 * so the dev server serves the viewer, and vitest would inherit it — which
 * silently narrowed the test run to a directory containing no tests and made
 * `pnpm test` exit "No test files found". vitest prefers this file when it
 * exists, so the engine's tests keep the repository root.
 */
export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ['src/**/*.test.ts'],
  },
})
