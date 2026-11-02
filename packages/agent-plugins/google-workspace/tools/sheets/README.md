# Sheets tools A (`tools/sheets/`)

## Purpose

The Google Sheets chat tools for spreadsheets, values, data filters and search (design §D). Each
`.mjs` file is one tool module declared in `../../tovu-agent-tools.json`; the assistant sees it under
its `name` with the host's plugin prefix (in Tovu, `p_google_workspace__<name>`). Every tool takes the `connectionRef` of the Google Workspace
connection; tools on an existing file also take its `spreadsheetId`. Tab, sort, filter, format,
named-range, protection, metadata, raw batch-update, CSV export and Picker tools live in
`../sheets-admin/` (a separate lot).

## Tools

| Tool | Effect (card) | Google call | Request kind |
|---|---|---|---|
| `sheets_get` | read | `GET spreadsheets/{id}` (field mask; grid data only with ranges) | read |
| `sheets_get_by_data_filter` | read | `POST spreadsheets/{id}:getByDataFilter` | read |
| `sheets_create` | write | `POST spreadsheets` | write (never replayed) |
| `sheets_copy` | write | Drive `POST files/{id}/copy` (`lib/drive-files.mjs`) | write (never replayed) |
| `sheets_copy_tab` | write | `POST spreadsheets/{id}/sheets/{sheetId}:copyTo` | write (never replayed) |
| `sheets_values_get` | read | `GET …/values/{range}` | read |
| `sheets_values_batch_get` | read | `GET …/values:batchGet` (≤ 20 ranges) | read |
| `sheets_values_append` | write | `POST …/values/{range}:append` (`INSERT_ROWS`) | write (never replayed) |
| `sheets_values_update` | destructive | `PUT …/values/{range}` | idempotent write |
| `sheets_values_batch_update` | destructive | `POST …/values:batchUpdate` (≤ 100 ranges) | idempotent write |
| `sheets_values_clear` | destructive | `POST …/values/{range}:clear` | idempotent write |
| `sheets_values_batch_clear` | destructive | `POST …/values:batchClear` (≤ 100 ranges) | idempotent write |
| `sheets_values_by_data_filter` | destructive (all actions) | `POST …/values:batch{Get,Update,Clear}ByDataFilter` | read / idempotent write |
| `sheets_find` | read | `GET …/values:batchGet`, matched locally (plain text) | read |
| `sheets_find_replace` | destructive | `POST spreadsheets/{id}:batchUpdate` (`findReplace`) | write (never replayed) |

`write` and `destructive` tools export `describeAffectedResources`, which names the spreadsheet,
ranges and counts on the host's confirmation card (never cell values beyond what the caller typed).

## How it fits

Every module calls `lib/sheets-client.mjs`, which builds the endpoint (each id or range is ONE
encoded path segment; `.`/`..` refused), defaults values to `RAW`, enforces the bounds and sends
through `lib/http.mjs` (token right before each request, where the host charges its budgets; retries, safe errors).

| Bound | Value | At the bound |
|---|---|---|
| Values reads (shared across a batch) | 500 rows, 5,000 cells, 64 KiB | cut, with `continuation` = the exact range to read next |
| Metadata / data-filter metadata reads | 64 KiB | `limit-exceeded` (no partial) |
| Ranges per batch read / find | 20 | schema refusal |
| Entries per batch write / clear | 100 | schema refusal |
| Mutation body | 1 MiB | `limit-exceeded` before sending |
| `sheets_find` scan / matches | 50,000 cells / 100 matches | `limit-exceeded` / `truncated: true` |

## Extension points

A new Sheets tool adds one module here (or under `../sheets-admin/`) and one entry in
`tovu-agent-tools.json`; it reuses `sendSheetsRequest`, `sheetsUrl` and the bound helpers. A
second product uses `lib/http.mjs` directly with its own URL helper.
