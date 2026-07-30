/**
 * `@jini-ai/artifacts/node` — the Node-only half of this package: real disk I/O for the stub-guard
 * (`findPriorArtifactSiblings`, `evaluateArtifactStubGuard`). Split from the main `.` entry point
 * (2026-07-29) so importing the universal types/pure decision logic there never forces a resolver
 * to also resolve `node:fs`/`node:path`.
 */
export * from './stub-guard.js';
