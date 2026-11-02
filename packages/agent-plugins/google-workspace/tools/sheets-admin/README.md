# Sheets admin tools (`tools/sheets-admin/`)

## Purpose

The structural and formatting half of the Google Sheets chat tools: everything beyond reading and
writing values. Each file is one tool module declared in `../../tovu-agent-tools.json` and reached
by the assistant under its `name` with the host's plugin prefix (in Tovu, `p_google_workspace__<name>`).

| Module | Tool | Effect |
|---|---|---|
| `tab-modify.mjs` | `sheets_tab_modify` | destructive |
| `sort.mjs` | `sheets_sort` | destructive |
| `basic-filter.mjs` | `sheets_basic_filter` | write |
| `filter-views.mjs` | `sheets_filter_views` | destructive |
| `format.mjs` | `sheets_format` | write |
| `named-ranges.mjs` | `sheets_named_ranges` | destructive |
| `protected-ranges-get.mjs` | `sheets_protected_ranges_get` | read |
| `developer-metadata.mjs` | `sheets_developer_metadata` | read |
| `batch-update.mjs` | `sheets_batch_update` | destructive |
| `export-csv.mjs` | `sheets_export_csv` | read |
| `open-existing.mjs` | `sheets_open_existing` | read |

## How it fits

- Every change is ONE `spreadsheets.batchUpdate`: named tools build reviewed requests and call
  `runBatchUpdate` (`../../lib/sheets-client.mjs`), the same path as `sheets_batch_update`, so
  every request passes the inventory in `../../lib/sheets-admin-request-kinds.mjs` first. A batch
  holding a non-replayable kind is a `write` for the shared client (`../../lib/http.mjs`): an
  unknown outcome is `uncertain-outcome` and is never replayed.
- The host confirms `write` and `destructive` calls with the card built from each module's
  `describeAffectedResources` (spreadsheet first, then what changes; for a raw batch, every kind).
- Tokens come from the host capability inside the shared client; no module sees or returns one.
- Bounds: tool answers at most 64 KiB (refused, not cut); batches at most 100 requests, 1 MiB and
  48 different kinds; CSV export at most 20,000 rows, 100,000 cells and 4 MiB, read in 10,000-cell
  chunks through `values.batchGet` (ranges in the query, never the path), written through the host
  `artifacts` capability (which refuses until the host binds a store).
- `open_existing` verifies a picked file through Drive `files.get` (granted, not trashed, a
  spreadsheet) and returns metadata only; the Picker itself is a later lot.

## Extension points

A new request kind is one reviewed row in `REQUEST_KINDS` (effect, replay class, required fields)
plus a line in `skills/google-workspace/references/sheets.md`. A new named wrapper is a module here
that builds inventory requests and calls `runBatchUpdate`, plus a declaration appended to
`tovu-agent-tools.json`. Phase B may fold the shared helpers into `lib/sheets-client.mjs`.
