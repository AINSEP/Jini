# Google Sheets

The names below are this plugin's tool names; the host may show them with its own plugin prefix
(the host guidance says which). Every spreadsheet tool takes the `connectionRef` of the
connection; tools on an existing file also take its `spreadsheetId`.

## Choosing a spreadsheet

- **Existing spreadsheet:** the person picks it with Google's file picker. That pick is what lets
  this site open the file. A pasted link is not enough.
- **New spreadsheet:** This site can create one; this site then has access to it automatically.
- If the person cancels the picker, keep the current settings.

## Reading and changing data

- Reads are bounded (about 500 rows or 5,000 cells at a time). For more, read the next range.
- Values a visitor or the person typed are written **as text exactly as given** (`RAW`); this site never
  turns them into formulas.
- Changing, clearing or deleting data shows the person a confirmation card first. Only their click
  approves it. Remote changes cannot be undone from this site.
- If a change comes back with `outcome: "unknown"`, ask the person to check the spreadsheet before
  trying again.

## Limits

Google allows each account about 60 requests a minute; this site keeps under that (about 45 per account
and 240 per site). When Google asks this site to wait, this site waits; nothing is lost.

## Spreadsheet, values and search tools

Names below are the plugin's tool names, without the host's prefix. Every call needs `connectionRef`; calls on an
existing file also need `spreadsheetId` (the id from the picker or from `sheets_create`).

| To… | Use | Asks the person first? |
|---|---|---|
| See the title, URL and tabs (tab ids for other tools) | `sheets_get` | no |
| Read one range | `sheets_values_get` with `range`, for example `'Leads'!A1:D50` | no |
| Read several ranges at once (up to 20) | `sheets_values_batch_get` | no |
| Find cells containing a text (up to 20 ranges) | `sheets_find` | no |
| Read by data filter (A1, grid range or developer metadata) | `sheets_get_by_data_filter` (metadata) or `sheets_values_by_data_filter` with `action: "get"` (values) | the second one does |
| Make a new spreadsheet | `sheets_create` | yes |
| Copy a whole spreadsheet | `sheets_copy` | yes |
| Copy one tab into another spreadsheet | `sheets_copy_tab` with the numeric `sheetId` | yes |
| Add rows after the existing table | `sheets_values_append` | yes |
| Overwrite cells | `sheets_values_update` (one range) or `sheets_values_batch_update` (up to 100) | yes, as a destructive change |
| Clear cells | `sheets_values_clear` or `sheets_values_batch_clear` | yes, as a destructive change |
| Replace a text everywhere on a tab or in every tab | `sheets_find_replace` (`sheetId` or `allSheets: true`) | yes, as a destructive change |

### Reading a lot of data

A read returns at most 500 rows, 5,000 cells or 64 KiB. When there is more, the result has
`continuation`: call `sheets_values_get` with exactly that range to read the next part. Do not guess
the next range yourself. `sheets_get` and `sheets_get_by_data_filter` have no continuation: when
their answer would be too large they fail with `limit-exceeded`; ask for fewer ranges or leave out
grid data. A `fields` mask containing `*` or `data` reads cell data too, so it is refused
(`invalid-input`) unless `includeGridData: true` is given (with `ranges` for `sheets_get`).
`sheets_find` searches at most 50,000 cells and returns at most 100 matches
(`truncated: true` means there were more); narrow the ranges when it says `limit-exceeded`.

### Writing values

- Values are stored **as text exactly as given** (`RAW`). Only pass
  `valueInputOption: "USER_ENTERED"` when the person explicitly wants Sheets to interpret the values
  (formulas, dates); never for text a visitor typed.
- One write body is at most 1 MiB; split bigger writes into several calls.
- `sheets_values_append` inserts new rows below the table, so nothing under it is written over.

### When the answer is lost

`sheets_values_append`, `sheets_create`, `sheets_copy`, `sheets_copy_tab` and `sheets_find_replace`
are never repeated automatically. If one fails with `uncertain-outcome` (`outcome: "unknown"`), ask
the person to look at the spreadsheet (or their Drive) first; repeating it could add the rows, the
file or the replacement twice.

### Errors these tools add

- `invalid-input`: the request was refused before anything was sent (for example a malformed id or
  range). Fix it and try again.
- `limit-exceeded`: the request or its answer is bigger than the tool allows. Ask for less.

## Tabs, sorting, filters, formatting and structure

Each of these tools takes `connectionRef` and `spreadsheetId`. Tabs are named by their numeric
`sheetId` (it survives renames); ranges are grid ranges with zero-based, end-exclusive indices, for
example `{ "sheetId": 0, "startRowIndex": 1, "endRowIndex": 10, "startColumnIndex": 0, "endColumnIndex": 4 }`
is rows 2-10, columns A-D.

| Tool | What it does | Confirmation |
|---|---|---|
| `sheets_tab_modify` | add, rename, delete, duplicate or move a tab | danger card (delete removes the tab's data) |
| `sheets_sort` | reorder rows of a range by up to 10 columns | danger card (the old order is gone) |
| `sheets_basic_filter` | set or clear a tab's filter (hides rows; no sorting: use `sheets_sort`). To read a filter, use `sheets_get` with `fields: "sheets(properties(sheetId),basicFilter)"` (no card) | card |
| `sheets_filter_views` | list, add, update, duplicate or delete saved filter views | danger card |
| `sheets_format` | number formats, fonts, colours, alignment, wrapping, borders, frozen rows/columns, column widths | card; never changes values |
| `sheets_named_ranges` | list, add, update or delete named ranges | danger card (formulas follow the name) |
| `sheets_protected_ranges_get` | protected ranges, editors, and whether this account may edit | none (read) |
| `sheets_developer_metadata` | get metadata by id or search with data filters | none (read) |
| `sheets_batch_update` | up to 100 raw Sheets requests in one atomic call | danger card listing every request kind |
| `sheets_export_csv` | one tab (or `A1:F500` of it) as a downloadable CSV file | none (read) |
| `sheets_open_existing` | check a picked spreadsheet, or point the person to the picker | none (read) |

- `sheets_format`: give `cellFormat` together with `fields`, the exact format properties to set
  (for example `["textFormat.bold", "numberFormat"]`). Properties not listed stay as they are.
- `sheets_open_existing` without `spreadsheetId` answers `waiting`: ask the person to choose the file
  with Google's picker in the Google Workspace plugin, or offer to create a new spreadsheet.
  `file-not-granted` means the file was never picked (or was trashed); `not-a-spreadsheet` means it is
  not a spreadsheet.
- `sheets_export_csv` reads at most 20,000 rows and 100,000 cells and writes at most 4 MiB. A bigger
  tab is refused (`limit-exceeded`), never cut short: export a range instead. It returns a file
  reference, not the data. On a site that cannot save files it refuses with `export-unavailable`
  before reading anything; read the values in chat instead.
  Text that starts with `=`, `+`, `-`, `@` (or a tab or line break) is written with a leading `'`,
  so a spreadsheet app opening the file shows it as text instead of running it as a formula (a
  visitor could have typed one into a form). The trade-off: with the default formatted values, a
  number shown as `-5` or a phone number like `+1 555` also gets the `'`. Ask for
  `valueRenderOption: "UNFORMATTED_VALUE"` when exact numbers matter: real numbers are never prefixed.
- Answers over 64 KiB are refused with `limit-exceeded`: narrow to one tab or fewer items.

## Raw batch updates (`sheets_batch_update`)

Each request object names exactly one request kind, for example
`{ "insertDimension": { "range": { "sheetId": 0, "dimension": "ROWS", "startIndex": 5, "endIndex": 7 } } }`.
Field masks (`fields`) must name the properties to change; `*` is refused because it resets
everything else. A batch is all-or-nothing at Google.

Supported request kinds. Changes data or protection (shown as destructive on the card):
`updateSheetProperties`, `repeatCell`, `deleteNamedRange`, `deleteSheet`, `autoFill`, `cutPaste`,
`copyPaste`, `mergeCells`, `updateCells`, `deleteDimension`, `deleteEmbeddedObject`,
`deleteFilterView`, `findReplace`, `pasteData`, `textToColumns`, `deleteRange`,
`deleteConditionalFormatRule`, `sortRange`, `addProtectedRange`, `updateProtectedRange`,
`deleteProtectedRange`, `deleteBanding`, `deleteDeveloperMetadata`, `randomizeRange`,
`deleteDimensionGroup`, `trimWhitespace`, `deleteDuplicates`, `deleteTable`, `setBasicFilter` (its
`sortSpecs` reorder rows).

Other changes: `updateSpreadsheetProperties`, `updateDimensionProperties`, `updateNamedRange`,
`addNamedRange`, `addSheet`, `unmergeCells`, `updateBorders`, `addFilterView`, `appendCells`,
`clearBasicFilter`, `duplicateFilterView`, `duplicateSheet`, `insertDimension`, `insertRange`,
`moveDimension`, `updateEmbeddedObjectPosition`, `updateFilterView`, `appendDimension`,
`addConditionalFormatRule`, `updateConditionalFormatRule`, `setDataValidation`,
`autoResizeDimensions`, `addChart`, `updateChartSpec`, `updateBanding`, `addBanding`,
`createDeveloperMetadata`, `updateDeveloperMetadata`, `addDimensionGroup`, `updateDimensionGroup`,
`updateEmbeddedObjectBorder`, `addSlicer`, `updateSlicerSpec`, `addTable`, `updateTable`.

Not supported: the Connected Sheets data-source kinds (`addDataSource`, `updateDataSource`,
`deleteDataSource`, `refreshDataSource`, `cancelDataSourceRefresh`) need a BigQuery permission this site
does not ask for. Any kind not listed is refused with `unsupported-request` before anything is sent.

If a batch that adds, inserts, appends, moves or deletes by position comes back with
`outcome: "unknown"`, it may already be applied: ask the person to check before sending it again.
