# core/dom

The browser half of `@jini-ai/agentic`: the DOM `PageDriver`, WebMCP model-context detection, the
native model-context adapter, the published-page filter, and the admin page-tool WebMCP adapter.
Compiled under `tsconfig.dom.json` (DOM lib) — see `../README.md` for why the rest of `core/` is not.

## `admin-page-tools.ts` (`@jini-ai/agentic/dom/admin-page-tools`)

`registerAdminPageWebMcpTools` registers every `PAGE_CAPABILITIES` entry as a native WebMCP tool.
Calls the host classifies as direct run through `executePageCapability` (schema validation,
credential-field and navigation guards still apply); every other call goes to the host's
authenticated `requestPageAction` channel and is never executed locally. Access is rechecked before
the call, before a direct execution, and again after the authenticated request settles.

## Wiring

The host injects, as required fields of the first argument:

- `directPageAction` — the host's shared action-approval table (which page calls run without a
  chat card). The admin app binds its headless approval-policy function.
- `isEnabled` — the browser-agent access preference. The admin app binds its browser-agent
  settings port (`getEnabled`).
- `onError` — reporting for a native registration failure. The admin app binds its own console
  warning.

Optional: `modelContext` (defaults to the document/navigator WebMCP surface) and
`requestPageAction` (without it, opaque actions are refused). The host's admin page-bridge hook
binds all of these. See `docs/decisions/DR-005-portable-package-boundaries.md`.
