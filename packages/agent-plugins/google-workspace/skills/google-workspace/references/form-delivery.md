# Sending form submissions to Google Sheets

The **Google Sheets** form destination adds each accepted submission as a new row.

The person picks where each form goes in the plugin's **Form destinations** tab: the form's short
name, a spreadsheet (one already chosen, or Google's file picker), and a tab. This site checks with Google
that the account can open that spreadsheet and that the tab exists before saving; a pasted id that
was never chosen is refused. Saving asks them to confirm that rows stay in the spreadsheet. Saving
turns delivery on for that form straight away: there is nothing to copy into this site's settings, and
removing the destination there stops new rows (rows already written stay in the spreadsheet).

- Each form goes to its own tab. This site remembers the tab by its id, so renaming the tab is safe.
- The first row holds the headers: `_tovu_submission_id`, `_tovu_submitted_at`, then the field
  labels. The visitor's IP address is never sent.
- Checkbox groups are joined with ", ". Values are written as plain text, never as formulas.
- A new form field becomes a new column at the end. This site tags each column it writes with the
  field's id (hidden spreadsheet metadata, not visible in cells), so existing columns never change
  meaning: editing a field's label, renaming a header, or inserting or moving columns keeps each
  field's answers in its own column. Deleting a column removes its tag; the field then gets a new
  column.
- Every submission stays saved in this site, whatever happens to the spreadsheet. A delivery that cannot
  go through yet (Google slow or asking this site to slow down, Google unavailable, Sheets turned off) is
  retried about 8 times over about a day; after that it is marked failed and is not sent again.
  A sign-in problem (`authorization-required`) fails the delivery at once.
- Delivery is **at least once with best-effort dedupe**: before every append this site looks for the
  submission id in the `_tovu_submission_id` column (and looks again if Google's answer was lost),
  so a retry normally does not add a duplicate. A duplicate is still possible in rare cases (for
  example another person or tool writing to the same tab at the same moment). When this site finds the
  same submission id on two or more rows it does not add another, and the delivery counts as done.
  This site does not show such duplicates anywhere yet: if the person suspects one, sort or filter the
  sheet by `_tovu_submission_id` and delete the extra row.
- Deleting a submission in this site does **not** delete its row in the spreadsheet. When the person
  turns this destination on, tell them: "Rows already sent to Google Sheets stay in the spreadsheet
  if you delete the submission in this site."
- Turning Sheets off does not pause deliveries indefinitely: they are retried for about a day, then
  marked failed. Turn Sheets back on within that window.

## When a delivery fails

| code | what it means | what to do |
|---|---|---|
| `authorization-required` | Google no longer accepts the sign-in (reconnect required), a permission is missing, or the destination still belongs to the account used before a switch. | Same account: reconnect Google Workspace. After a switch: choose the spreadsheet again in Form destinations (or tick it when confirming the switch). The failed delivery stays listed in this site as failed; it is not sent again. |
| `resource-not-granted` | The connected account cannot open this spreadsheet. | Choose the spreadsheet again with the file picker. |
| `configuration-invalid` | The destination does not name a tab for this form, or the tab was deleted. | Choose the tab again in the destination settings. |
| `mapping-invalid` | The columns cannot be matched: `_tovu_submission_id` or `_tovu_submitted_at` is missing from row 1, a header appears twice, two fields share a label, or one field's hidden column tag appears on two columns (another tool copied it). | Repair the headers in row 1 (or give the fields distinct labels); for a doubled tag, delete the extra column. |
| `destination-limit` | The tab has more than 50,000 rows, too many to check for duplicates. | Point the form at a new tab or spreadsheet. |
| `rate-limited` | Google asked this site to slow down. | Usually nothing; it retries after the wait, for about a day at most. |
| `outcome-unknown` | Google did not confirm the append and the row was not found. | Nothing; the next try checks again before appending. |
| `adapter-unavailable` | Sheets is turned off for the plugin. | Turn Sheets on. Deliveries still being retried (about a day) then go through; older ones stay failed. |
| `delivery-failed` | Google was unavailable or answered unexpectedly. | Usually nothing; it retries for about a day, then the delivery stays failed. |
