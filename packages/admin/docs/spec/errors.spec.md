Spec ID: SPEC-JINI-ADMIN-ERRORS
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:4a8f85f249e1414f2a81ddf0735404b17756b82d738a12c05f6cab1d6ca24232
spec_mode: reverse_spec


# Admin errors contract

## Purpose and evidence

Source: `src/core/transport/{errors,http}.ts`, `src/core/entities/rules.ts`, `src/react/entities/contribution.tsx`, `src/react/components/Sidebar.tsx`, `src/react/shell/use-admin-theme.ts`; corresponding tests were read, not executed. Only AdminApiError is an exported package error class. There is no package-owned error-code enum.

## Exported error class

```ts
new AdminApiError(
  { message: string, status: number },
  { code?: string, body?: Record<string, unknown> } = {},
);
// extends Error; name === 'AdminApiError'
// readonly status: number; readonly code?: string; readonly body?: Record<string, unknown>
```

The default HTTP transport throws this class only after fetch resolves a response with `ok: false`. It retains the parsed body without schema validation. A JSON parse failure supplies `{}`; absent/null error text becomes `request failed (<status>)`. Other error values are stringified; code is retained only when it is a string. The backend owns code vocabulary and contextual error text. Alternative transports must preserve this class for unsuccessful backend responses.

| Failure | Caller response |
|---|---|
| Authentication or forbidden response | Follow the host's session/authorization policy; do not treat upstream credentials failure as operator-session expiry without confirmation |
| Validation response | Present backend/domain-specific correction guidance |
| Conflict response | Inspect raw body for domain fields such as currentVersion; refresh and re-evaluate before retrying |
| Rate limit or server response | Apply consumer retry policy; the package does not retry or establish mutation idempotency |
| Network/abort fetch rejection | Catch the original thrown value; it is not wrapped as AdminApiError |
| Success with malformed/empty JSON | Resolves `{}`; validate the response if a typed payload is required |

`describeApiError({ e, fallback }): string` returns nonempty AdminApiError.message or fallback; for another Error it returns message even if empty; for non-Error values it returns fallback. It never maps code to a shared message. Supply per-domain translations before falling back.

## Composition and input failures

| Class / message | Trigger | Caller action |
|---|---|---|
| `Error`: `createAdminClient: "transport" is a reserved route-group name` | Factory map contains reserved key | Rename the group before composition; earlier factories might already have run |
| `Error`: `createAdminEntityRegistry: invalid descriptors` plus all problems | Any descriptor violates registry constraints in behavior.spec | Correct all listed descriptor problems; no registry is returned |
| `Error`: `Entity panelId must be one URL segment` | Entity routes factory panelId fails `^[a-zA-Z0-9_-]+$` | Use one nonempty allowed panel segment |
| `Error`: `Entity adminBase must be an absolute pathname` | Base lacks leading slash, begins `//`, or includes `?`/`#` | Supply an absolute pathname; trailing slashes are removed |
| `Error`: `Entity route segments must be non-empty` | Explicit entity/id argument is empty during href or navigation construction | Omit absent values or provide a nonempty identifier |
| Native `URIError` | encodeURIComponent receives malformed surrogate text | Validate identifier text at the adapter boundary |
| `Error`: `useSidebar ... must be rendered inside a <Sidebar>` | Context consumer lacks a root; Footer itself does not read context | Put context-dependent controls beneath Sidebar |
| `TypeError`: `AdminShell theme requires a themeEnvironment port` | A theme is supplied without its environment; thrown in an effect | Supply target/document/matchMedia before mounting with a theme |
| `TypeError`: `Invalid color scheme preference` | setPreference gets a value other than light/dark/system | Supply one of the three supported preferences |
| Dependency `TypeError` with theme validation messages | applyAdminTheme rejects theme data | Correct palette/font/radius/density inputs using the UI theme contract |
| Adapter/factory/DOM/storage exceptions | Host ports, diagnostics callback, group factory, preference store or DOM operation throws | Handle at the owning boundary; no universal wrapping or recovery is promised |

None of these composition/input errors has a package code field. Do not parse message text as a stable machine code. Injected hooks, DOM operations and agent helpers can propagate native/dependency errors; the current component calls use the published argument shapes.

## Failures represented as state or data

- Session read/logout rejections become `{status: 'error', error}` and remove authenticated content. Controller refresh/logout promises absorb those adapter failures; subscription registration/cleanup failures are not caught by that path.
- Entity screen read failures render generic translated alerts. Save/remove failures render `Operation failed`, retaining the draft and withholding navigation. Original mutation errors are not exposed by these screens.
- Invalid entity route decoding renders a translated `Invalid route` alert; it does not throw through the panel renderer.
- Unknown entity is null/alert; unknown row is null/status; neither is an exported not-found exception.
- Row violations and draft validation return reports. No conformance checking runs without onViolation; a throwing onViolation callback can reject the wrapped operation, including after a write completed.
- Rail/section persistence get/set/JSON-parse failures are swallowed with usable local defaults/state. Theme preference store exceptions are not swallowed.
- Redirect import item failures have `{index: number, code: string, message: string}` in a resolved result; inspect `failed` even when the batch promise resolves.
