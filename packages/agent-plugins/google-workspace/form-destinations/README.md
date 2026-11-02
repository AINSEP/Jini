# `form-destinations/` — the Google Sheets form destination

**Purpose.** Push each accepted form submission into a Google Sheets tab as one row, at least once,
with best-effort dedupe. Declared in `../tovu-form-destinations.json` as `google-sheets` (push only,
no `receive`), part of the Sheets product (`../products.json`).

## Public API

`sheets.mjs` default export: `deliver(required, optional)`, the forms delivery contract's push
method (see the forms-multidest delivery contract, §2–§3).

- `required`: `{ kit, credential, form, submission, binding, idempotencyKey }` exactly as the host
  hands a frozen job. `credential.token` is the access token the host resolved for this attempt
  from `binding.connectionRef`; it is used only in the `authorization` header.
- `optional`: `{ state? }` — the host's read-only reader of this plugin's settings (the store the
  connection panel writes). Unless it holds `products.sheets === true` (no reader counts as off),
  delivery refuses as `adapter-unavailable`, retryable: while Sheets is off a job is retried within
  the forms retry policy (about 8 attempts over about a day), then marked failed; no reader never enables delivery.
- `credential.getAccessToken()` (OAuth connections): one fresh token per Google request, so the
  host's declared budgets count every request and the frozen account is re-checked each time.
- Returns a `FormDeliveryResult`; it never throws.

Binding config (non-secret, frozen with the job):

```json
{ "spreadsheetId": "…", "accountId": "…", "tabs": { "<formSlug>": { "sheetId": 7 } } }
```

`accountId` is read by the host, not this module: the OAuth connection port refuses a job whose
connection now holds another account (`authorization-required`), and a binding without one
(`configuration-invalid`).

Which column holds which field is kept in the sheet, not the binding: the first time a field is
written, its column gets a developer-metadata marker (`tovu_form_field` = the field id, visibility
`DOCUMENT`, attached to that one column). The marker decides the column from then on, so a label
edited in the form, a header renamed in the sheet, or columns inserted or moved before it keep the
field's data in one column (Google moves column metadata with the column). An untagged field is
matched by its label in row 1 and tagged, or gets a new column at the end (header = label, else
field id). Chosen over the binding because the adapter cannot write the host's binding, and over a
header note because people neither see nor edit metadata. Growing the grid, writing new headers
(as text cells) and tagging columns happen in ONE atomic `batchUpdate` before the append.

More than one row already holding the submission id (another writer, or a late append racing the
scan) is reported as delivered with the reference `sheet <id> rows <a>, <b> (duplicate submission
id: review)`; nothing is appended again. Nobody sees that note today: the forms delivery contract has no reviewable success outcome and the ledger keeps only `ok` (the
reference is dropped), and any `ok: false` code would fail or re-try a row that is already
there. A distinct outcome needs a contract change in Jini (`@jini-ai/cms/forms`).

## Files

| file | job |
|---|---|
| `sheets.mjs` | One attempt: product check → tab by sheet id → header row + column markers → dedupe scan → one atomic column batch (grid, headers, markers) → RAW append → re-scan after a lost answer. |
| `mapping.mjs` | Field id ↔ marker / header ↔ column (`buildMapping`, `readMarkers`, `planColumns`); mapping errors; the RAW row (checkbox groups joined `", "`). |
| `dedupe.mjs` | Scans the `_tovu_submission_id` column in 5,000-row chunks; > 50,000 data rows → `destination-limit`. |
| `delivery-result.mjs` | The contract's result shape and the plugin-error → contract-code table. |

## How it fits

All HTTP goes through `../lib/sheets-client.mjs` → `../lib/http.mjs` (the one Google client:
retries, Retry-After, safe errors; quotas are the host's budgets). The host's `kit.fetch(url, init, { timeoutMs })` is
the transport. The forms ledger (outbox) owns attempts, backoff and terminal state; this module
only reports one attempt's outcome.

Not exactly-once: there are no row reservations, and a late append or another writer can race the
scan. Two bindings writing to the same tab share the id column, so the second sees the first's row
as already delivered.

## Extension points

A second destination (another product or another provider plugin) copies this shape: a
push-only descriptor, a `deliver` that maps its own errors to the nine contract codes, and its own
dedupe. Nothing here is imported by a host's core or Jini core.

## Wiring (G14b) and what is left

Wired: the host composes the OAuth connection port ahead of saved custom credentials, so a binding
whose `connectionRef` is this plugin's connection resolves through it (`additionalHosts` = the
declared `apiOrigins` after the first, as exact origins); delivery gets `optional.state` and a
per-request `getAccessToken()`.

Bindings (G14c): the destination panel saves each form's choice as its binding through the host's
admin-surface `deliveryBindings` capability (`../lib/form-destination-settings.mjs`). The binding names
the form by slug (the host stores the form's row id) and the `account` connection by id (the host
stores its own ref); an admin clicking Save on the panel is the human action. A binding whose plugin
is disabled is not delivered (`adapter-unavailable`, retryable: the host reads only active plugins'
adapters on every attempt), the same code as Sheets turned off here.
