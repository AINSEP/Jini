# Google Workspace plugin (`google-workspace`)

## Purpose

One bundled Agent Plugin for everything Google: the Google sign-in and every Google product as a
module. v1 ships Sheets. All Google-specific code (endpoints, scopes, request formats, response
parsing, revocation, later the Picker) lives here; host core and Jini core name no provider. It ships
as `@jini-ai/agent-plugins/google-workspace` (this folder, `packages/agent-plugins/google-workspace`).
A host that selects it stages the payload into its bundled-source root and seeds it **disabled**;
the bundled-digest ledger records its digest at seed time, which the executable trust gate checks
before any module loads. Host-specific chat guidance (exact tool names, admin paths, the OAuth
callback route) lives in the host's overlay for this plugin, not here.

## Layout

| Path | What it is |
|---|---|
| `plugin.json`, `mcp.json` | Manifest (no MCP servers). |
| `tovu-connections.json` | The sign-in (the `tovu-*.json` files are the Tovu host's contribution contracts; their names and keys are frozen): Google endpoints, per-client-kind parameters, Picker start params and the `picked_file_ids` callback field, and the NAMES of the host config holding the client ids (`TOVU_GOOGLE_WORKSPACE_OAUTH_{WEB,DESKTOP}_CLIENT_{ID,SECRET}`, placeholders until the Cloud project exists). `byoClient: true` lets a workspace admin use their own OAuth client instead (saved as the custom credential `google-workspace/account OAuth client`; see `skills/google-workspace/references/connection.md`). |
| `products.json` | Product catalog: id, label, tool prefix (every tool named with it belongs to the product and is gated by it; a security pin enumerates them), required scopes. Sheets = `drive.file` only. |
| `tovu-agent-tools.json` + `tools/` | Executable tools (the host adds its own prefix to each name): `account_info`, and the Sheets tools in `tools/sheets/` (see its README). |
| `tovu-admin-surfaces.json` + `ui/` | Plugin-owned admin surfaces: the connection panel, Choose spreadsheet (Picker) and Form destinations, each with a server-side `handlerModule`. See `ui/README.md`. |
| `tovu-form-destinations.json` + `form-destinations/` | Push-only `google-sheets` destination (no `receive`): frozen column mapping, bounded submission-id dedupe, contract-shaped results. See `form-destinations/README.md`. Not yet called by the host's forms fan-out (wired in a later lot). |
| `lib/` | Shared code (below). |
| `skills/google-workspace/` | What the in-app assistant reads. |
| `__tests__/` | Plugin-local `node:test` suites (not shipped): `fake-google-http.mjs` (127.0.0.1 fake Google), the OAuth contract pins and the skill-content pins. |

## `lib/` public API

| Module | Exports |
|---|---|
| `auth.mjs` | Default `{ createHooks({ http }) }`: Jini's `ApiConnectionHooks` (`resolveScopes`, `readAccount`, `revoke`). `GOOGLE_REVOCATION_ENDPOINT`, `GOOGLE_ACCOUNT_ACCESS_PAGE`. |
| `http.mjs` | `createGoogleClient({ http, connections }, { sleep, random }).request({ connectionRef, url, method, query, body, kind })`; `accessTokenFor`; `buildUrl`; `pathSegment` (one encoded path segment, dot segments refused). |
| `drive-files.mjs` | `readAccount({ client, connectionRef })` via Drive `about.get` (works under `drive.file`); `copyFile({ client, connectionRef, fileId, name }, { parentId })` via Drive `files.copy`. |
| `sheets-client.mjs` | The one Sheets client: `sheetsClientFor({ capabilities })` (Sheets product gate per request), `googleClientFor` (ungated: delivery), `sendSheetsRequest`, `assertSpreadsheetId` / `SPREADSHEET_ID_PATTERN` (the one id rule, also every schema's pattern), `sheetsUrl` (the one URL builder; checks the id), `getSpreadsheet`, `runBatchUpdate` (inventory check first), `valueInputOption` (RAW default), `SHEETS_LIMITS` and the bounds (`boundValueRanges`, `assertPayloadWithin`, `outputFits` / `assertOutputWithin`, `spreadsheetFields` (grid-data masks need the opt-in)), `resourceLines` (card lines), `spreadsheetLine`, `tabsOf`. |
| `sheets-a1.mjs` | A1 helpers, one name and contract each: `columnName`, `columnIndex`, `parseA1Range` (Google's normalized range → parts or undefined), `parseBoundsA1` (a plain `A1:B2` → bounds, else `invalid-input`), `tabRange` (tab-title quoting), `gridRangeLabel` (card label). |
| `product-state.mjs` | `PRODUCTS` (validated catalog), `scopesFor({ productIds })`, and the product gate: `PRODUCT_STATE_KEY` (`'products'`), `isProductEnabled({ state, productId })`, `assertProductEnabled(...)` (`product-disabled`); form delivery uses `isProductEnabled` over the read-only plugin-state reader the host passes as `optional.state`. A product is off unless the plugin's settings hold `products: { <id>: true }`. |
| `picker-selection.mjs` | `verifySelectedSpreadsheet({ client, connectionRef, fileId, expectedAccountId })` (plain Drive id, same account, spreadsheet MIME via Drive `files.get`, real access via Sheets `spreadsheets.get`; metadata only), `verifySpreadsheetAccess({ client, connectionRef, fileId })` (live spreadsheet per Drive, then opened by the Sheets API; shared with `sheets_open_existing`), `parsePickedFileIds({ value })` (desktop callback field → one id or null on cancel), `DESKTOP_PICKER_START_PARAMS`, `SPREADSHEET_MIME_TYPE`. |
| `surface-actions.mjs` | For the admin-surface handlers: `CONNECTION_ID` (`'account'`), `surfaceSheetsClient({ capabilities })` (the one Sheets client over the surface port, which names connections by id), `surfaceAccount`, `sheetsUnavailableReason`, `withSurfaceFailures` (plugin/host refusals → surface-safe failures), `surfaceRefusal`. |
| `picker-flow.mjs` | `createPickerFlow({}, { now, randomId })` → `bootstrap` (hosted session + short-lived token, or `system-browser` / `unavailable`), `verifyHosted`, `startSystemBrowser`, `finishSystemBrowser`; `readPickedSpreadsheets`, `rememberPickedSpreadsheet`, `PICKER_CONFIG_NAMES`, `PICKER_SESSION_TTL_MS`. |
| `form-destination-settings.mjs` | `readFormDestinations({ deliveryBindings })`, `saveFormDestination({ deliveryBindings, formSlug, destination }, { bindingId })`, `SHEETS_ADAPTER_ID`, `FORM_SLUG_PATTERN`, `MAX_FORM_DESTINATIONS`. |
| `request-policy.mjs` | `GoogleWorkspaceError`, `classifyFailure`, `parseRetryAfter`, `backoffMs`, `shouldRetryInline`. |

## Rules the plugin keeps

- Tokens come only from the host capability, right before each request; only access tokens ever
  reach the plugin, and none is returned, logged or put in an error.
- Errors carry a fixed message per code, never Google's text (it echoes ranges and values).
- `kind: 'write'` (append, create, copy) with an unknown outcome is `uncertain-outcome` and never
  retried; reads and idempotent writes retry with jittered backoff that honours Retry-After.
- Revocation is confirmed only by Google's 200 (or `invalid_token`: already revoked); a failed
  revoke throws `provider-unreachable` or `provider-refused` for the host to record.
- An access token can expire in flight: a 401 gets one more token read and is retried only if the
  token differs. An unchanged token or second 401 is `reconnect-required`. Tools and form delivery share this.
- The budgets declared in `tovu-connections.json` (45/min per account, 240/min per instance) are
  charged by the host on every token read; its refusal (`rate-limited`) becomes `quota-delay` with
  the host's `retryAfterMs` and `outcome: 'not-applied'`, and follows the same inline backoff rules
  as Google's 429 (nothing was sent, so even an append may wait and retry).
- Modules import nothing outside this directory except what the host injects.

## How it fits

The host reads each contribution file and runs it on Jini's services: `tovu-connections.json` on
`@jini-ai/integrations/api-connections`; `tovu-agent-tools.json` on
`@jini-ai/agent-plugins/lifecycle/tools`; `tovu-admin-surfaces.json` on
`@jini-ai/agent-plugins/admin-surfaces`; `tovu-form-destinations.json` through the host's form
destination registry. In Tovu those readers are `features/api-connections/contribution.ts`,
`features/agent-plugins/executable-tools`, `features/agent-plugins/admin-surfaces` and
`features/form-destinations/registry.ts`.

## Extension points

A new product adds an entry to `products.json` (its scopes), its tools to `tovu-agent-tools.json`
under its own prefix, and its modules under `products/<id>/`, all on the same sign-in.

## Known gaps

- Duplicate submission ids found in a tab are delivered as `ok` with a "review" note in
  `reference`, which the forms ledger drops; the contract has no reviewable success outcome, so
  no person sees it yet (Jini contract change needed for a distinct outcome).
- Form-delivery retry window: product-off (`adapter-unavailable`) and quota (`rate-limited`)
  refusals are retried within the site's forms retry policy (about 8 attempts over about a day),
  then the job fails; authorization failures (`authorization-required`) fail at once and stay as
  failed jobs, with no automatic re-send after a reconnect. Owner decision pending on longer holds
  (for example a `paused` outcome resumed by turning the product on or reconnecting).

- Products are read from the plugin's settings and default to OFF; the connection panel writes them,
  and the host hands form delivery the same settings (read-only) as `optional.state`.
- The Form destinations panel saves each form's choice as the form's delivery binding through the
  host's `deliveryBindings` capability (both the destination and connection surfaces declare
  `deliveryAdapters: ["google-sheets"]`): one binding per form slug, on this plugin's `account`
  connection, config = spreadsheet, tab (numeric sheet id), the frozen `accountId`, plus the names the
  panels show. The host writes it to `core.forms/deliveryBindings` as the signed-in admin.
- Panels (G13b) are built and unit-tested only; they need a Chrome check (hosted Picker inside the
  sandboxed frame, desktop system-browser Picker, the account-page button). The host says whether it
  is hosted or desktop (`context.hostKind`); a hosted site also needs both
  `TOVU_GOOGLE_PICKER_BROWSER_KEY` and `TOVU_GOOGLE_PICKER_APP_ID` (placeholders, never real values)
  or the Picker is `picker-not-configured`. The panels cannot open links themselves (no
  `allow-popups`): the connection panel declares `linkOrigins: ["https://myaccount.google.com"]` and
  asks the admin page to open the Google account-access page (`client.openLink`); the address also
  stays visible as text.
- Quotas: the per-account (45/min) and per-instance (240/min) budgets declared in
  `tovu-connections.json` are implemented by the host and charged on every token read; there is no
  plugin-side limiter. Form delivery reads a token per Google request (`credential.getAccessToken`),
  so it is charged per request like the tools.
- Hosted Picker sessions are kept one per surface (`picker-session:<surfaceId>`), not per tab or
  admin: opening the same panel in a second tab (or by a second admin) starts a new session and
  the first tab's pick is refused as `picker-expired`. Documented in
  `skills/google-workspace/references/troubleshooting.md`; not changed (a pick only needs one
  open panel).

## Sheets admin tools (`tools/sheets-admin/`, lot G12)

Eleven tools for tabs, sorting, filters, filter views, formatting, named and protected ranges,
developer metadata, raw batch updates, CSV export and opening a picked file; see
`tools/sheets-admin/README.md`. Their helpers:

| Module | Exports |
|---|---|
| `lib/sheets-admin-request-kinds.mjs` | `REQUEST_KINDS` (the reviewed batchUpdate inventory: effect, replay class, required fields), `checkRequests`, `describeRequests`, batch bounds. |
| `lib/sheets-admin-csv.mjs` | `planChunks`, `encodeCsv`, export bounds. |

These tools use the plugin-side codes `invalid-input` and `limit-exceeded` (shared with the values
tools) and add `unsupported-request`; `sheets_open_existing` reuses the Picker's `not-a-spreadsheet`, plus an optional plugin-composed `detail`
on `GoogleWorkspaceError` (a request index or kind name, never Google's text or a cell value).


Hosted sign-in asks for consent when Jini has no renewable credential stored (`forceConsentParams`),
so connecting another workspace can obtain offline access. Renewable same-account reconnects keep
incremental grants without forcing consent. Client settings now use the full plugin namespace,
`TOVU_GOOGLE_WORKSPACE_OAUTH_{WEB,DESKTOP}_CLIENT_{ID,SECRET}`. Provision these settings
before enabling this build; the earlier abbreviated names were never configured, so no fallback is needed.
