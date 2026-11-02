# Troubleshooting Google Workspace

| Code | What happened | What to do |
|---|---|---|
| `not-connected` | No Google account is connected. | Connect Google Workspace. |
| `reconnect-required` | Google no longer accepts the saved sign-in (expired, revoked or the password changed). Form deliveries fail at once and stay listed as failed; they are not re-sent after reconnecting. | Reconnect with the same account, then retry once. |
| `account-changed` | The connection now uses another account than the one shown when the change was confirmed. | Review the account and confirm again. |
| `missing-permission` | The person did not allow a permission this needs. | Reconnect and allow every listed permission. |
| `file-not-granted` | This site was never given this file (often a pasted link), or it was removed or trashed. Google answered "not found". | Choose the file again with the picker, or create a new spreadsheet. |
| `access-denied` | This site was given the file, but this account may not do this to it (for example view-only sharing). Google answered "forbidden". | Check sharing in Google Sheets, then pick it again. |
| `admin-policy` | A Google Workspace administrator blocks this site. | Ask the administrator to allow this site. |
| `quota-delay` | Google asked this site to slow down. | Wait (`retryAfterMs` says how long); nothing is lost. |
| `service-unavailable` / `network-error` | Google could not be reached. | Retry later. |
| `uncertain-outcome` | Google did not say whether a change was applied. | Ask the person to check the spreadsheet before retrying. Never repeat it automatically. |
| `invalid-request` | Google received the request and rejected it (bad range, tab or values). Nothing changed. | Fix the request. |
| `invalid-input` | This site refused the request before sending it: a spreadsheet id, range, field mask or option is not valid for the tool. Nothing was sent to Google. | Fix the id, range or option. |
| `limit-exceeded` | The request or its answer is larger than the tool allows. Nothing was cut short. | Ask for a smaller range, fewer rows or fewer entries. |
| `export-unavailable` | This site cannot save files from plugin tools, so a CSV export cannot be offered. Nothing was read. | Read the values in chat (`sheets_values_get`) instead. |
| `unsupported-request` | A raw batch holds a request kind this site does not allow. Nothing was sent. | Remove it, or use a listed kind (see the Sheets reference). |
| `picker-not-configured` | This site's operator has not set up Google's file picker, so an existing spreadsheet cannot be chosen here. | Ask the site operator, or create a new spreadsheet. |
| `not-a-spreadsheet` / `invalid-selection` | The chosen file is not a Google Sheets spreadsheet, or the picker returned something unusable. | Choose a spreadsheet again with the picker. |
| `unexpected-response` | Google answered in a way this site does not understand. | Report it; do not retry in a loop. |
| `product-disabled` | The product (Sheets) is turned off; products start off. | Ask the person to turn Sheets on in the Google Workspace panel, then retry. The sign-in is kept. |

**"The file picker session ended"** (`picker-expired`) can also mean the same Choose spreadsheet or
Form destinations panel was opened again in another tab or by another admin: only the most recently
opened panel can save a pick. Close the other tabs, reopen the panel, and choose the spreadsheet again.

**"Disconnected locally; Google revocation pending"** means this site stopped using the account but Google
did not confirm removing access. Retry disconnect later, or remove this site's access at
https://myaccount.google.com/connections.
