// Bun runs `bun test` with NODE_ENV=production, which makes `react` resolve its
// production build where `React.act` is stripped. @testing-library/react then
// falls back to `react-dom/test-utils.act` (removed in React 19), so every
// render throws "React.act is not a function". Force the development build.
//
// This must be a dedicated, import-free preload listed BEFORE test-setup.ts:
// test-setup's static imports pull in React, and ES module imports evaluate
// before any statement in the same file, so setting NODE_ENV there would be
// too late.
process.env.NODE_ENV = 'development'
