// bun:test's `expect` is its own implementation, not jest/vitest's, so the
// jest-dom matcher types (registered at runtime by test-setup.ts's
// `import '@testing-library/jest-dom'`) must be merged into bun:test's own
// Matchers interface for TypeScript to see them.
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers'

declare module 'bun:test' {
  interface Matchers<T> extends TestingLibraryMatchers<unknown, T> {}
}
