# Jini release B report — 54d1cf47 (cloud/jini-release-2026-10-22b)
VERDICT: NOT READY TO PUBLISH (7 test failures in cms, chat, platform)
Env: Node 24.22.0, pnpm 10.33.2. Nothing modified/published.

Build: `pnpm --no-bail -r build` exit 0, no failures.
Typecheck: `pnpm -r --if-present run typecheck` exit 0, no failures.
Changeset status --verbose: exit per log, no errors (package bump list only).

Tests (files / tests):
- cms:      3 failed | 4094 passed (4097)
- chat:     2 failed | 3624 passed, 1 skipped (3627)
- platform: 2 failed | 2504 passed, 6 skipped (2512)
- mcp:      1332 passed / 1332 (70 files)  PASS
- commerce: 4 passed / 4 (2 files) PASS
- core:     1408 passed / 1408 (98 files)  PASS

Failures:
cms
- identity-extraction.boundary.test.ts "CMS removes identity entry points while preserving the media import subpath" — AssertionError: expected [ { package: '@jini-ai/cms', …(5) } ] to deeply equal []
- integration-package.contract.test.ts "keeps exports and entry runtime metadata synchronized" — AssertionError: expected { Object (@jini-ai/core, @jini-ai/platform) } to deeply equal { '@jini-ai/core': 'workspace:^' } (cms now depends on platform; contract not updated)
- subpath-isolation.contract.test.ts "keeps every CMS subpath isolated at runtime and installation" — fails after 7.7s (likely same platform dep / isolation cause)
chat
- MessageRow.display.test.tsx "hidden keeps an unrecovered failure compact when text ordering is unavailable" — TestingLibraryElementError: Unable to find an element with the text: boom
- MessageRow.display.test.tsx "hidden shows one compact terminal failure with a working disclosure of the existing cards" — same (text "boom" not found)  [new Hidden-mode recovered-failures change]
platform
- integration-contracts.test.ts "each published subpath declares its intended runtime and preserves its targets" — AssertionError: expected 'universal' to be 'node'
- secrets/exports.test.ts "retains published subpaths and declares adapter dependencies as optional peers" — AssertionError: expected subpaths [ '.', './fetch-with-timeout', …(24) ] to deeply equal […(23) ] (new email sender subpath added, test list not updated)

Assessment: failures look like stale contract/export-list tests for the new email sender (platform/cms) and the chat Hidden-mode test vs new behavior; not investigated further (report-only). Fix tests or code, then re-run.
