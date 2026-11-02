---
name: google-workspace
description: Connect one Google account to this site with Google's own sign-in, then work with the Google Sheets the person picks or this site creates (the drive.file permission, never the whole Drive), and send form submissions to a spreadsheet. Explains connecting, products, the account actions (reconnect, switch, disconnect) and what each error means.
---

# Google Workspace

One sign-in covers every Google product this plugin ships. Version 1 ships **Google Sheets**.
Docs, Slides, Drive, Gmail and Calendar come later on the same sign-in.

Say it simply: "Connect Google Workspace, then choose or create a spreadsheet."

**Follow the host guidance first.** It names the host's exact tools for turning the plugin on,
connecting, and opening the own-client card. Where it is more specific than this skill, it wins.

## Choose the connection for the task

For the tasks on its `usedFor` list, use **Connect Google Workspace**: start the host's connect
action for the plugin `google-workspace`. It reuses a working sign-in. Choose it yourself; never ask
the person to pick between sign-in and a key. There is no API-key route.

Only if sign-in fails from a self-hosted site's address, or the person asks to use their own
Google Cloud project, open the plugin's **Use your own Google sign-in app** card (target
`google-workspace-oauth-client`). It saves the client ID and secret; then the person signs in as
usual. See [connection](references/connection.md).

Never ask for a secret in chat. Never offer to replace a working sign-in or saved app unless asked.

## What this site can and cannot see

- This site asks only for **`drive.file`**: the files the person picks with Google's file picker or
  that this site creates. It cannot browse or read the rest of their Drive.
- **A pasted spreadsheet link grants nothing.** If the person pastes a link, explain that they need
  to choose the file with the picker (or let this site create a new spreadsheet).
- Never ask for a password, a token, a client secret or an API key in chat, and never accept one.
  Sign-in always happens on Google's own page. A site that cannot use the host's own Google client
  can use its own OAuth client, saved only through the host's secure credential form: see
  [connection](references/connection.md), "Advanced: your own Google OAuth client".

## Before working on a spreadsheet

1. The plugin ships **switched off**. Offer to turn it on, or the person turns it on in the host's
   plugin settings.
2. Connect with the host's connect action. If sign-in is needed and starts successfully, it shows a
   card; Google's consent page opens in the system browser. Its result carries `connectionRef`: keep
   it and pass it unchanged as `connectionRef` to every tool below. See
   [connection](references/connection.md).
3. Check who is signed in with this plugin's `account_info { connectionRef }` tool and name that
   account before you change anything.
4. Sheets itself starts **off**: until the person turns Sheets on in the Google Workspace panel,
   every Sheets tool answers `product-disabled`. Ask them to turn it on there; chat cannot.
5. To use an existing spreadsheet, the person chooses it in the plugin's **Choose spreadsheet** tab
   (Google's file picker); then `sheets_open_existing` with its id works. Or create a new one.

Load [connection](references/connection.md) for sign-in, products and account actions,
[sheets](references/sheets.md) before any spreadsheet work, [form delivery](references/form-delivery.md)
when the person wants form submissions in a sheet, and [troubleshooting](references/troubleshooting.md)
when a call fails.

## Errors

Every failure has a `code`, a plain `message`, `retryable`, `outcome` and a `nextAction`. Follow the
next action; do not retry on your own when `retryable` is false. When `outcome` is `"unknown"` (for
example `uncertain-outcome`), the change may already be in the spreadsheet: ask the person to look
before trying again. Never repeat an append, create or copy just because the answer was lost.

## Sheets tools (spreadsheets, values, search)

Read [sheets](references/sheets.md) first. In short: read with `sheets_get`, `sheets_values_get`,
`sheets_values_batch_get` or `sheets_find`; create or copy with `sheets_create`, `sheets_copy` or
`sheets_copy_tab`; add rows with `sheets_values_append`; overwrite or clear with the
`sheets_values_*update` / `*clear` tools or `sheets_find_replace`. Every change shows a
confirmation card; only the person's click approves it.

## Tabs, filters, formatting and raw batch updates

The Sheets reference also covers tab changes, sorting, filters and filter views, formatting, named
and protected ranges, developer metadata, raw batch updates (and which request kinds are allowed),
CSV export and opening a picked spreadsheet (`sheets_open_existing`). Errors `limit-exceeded`
(narrow the request), `unsupported-request` (use a listed request kind), `invalid-input` (fix the id,
range or option) are raised by the plugin before anything is sent to Google; `not-a-spreadsheet`
means the chosen file is not a spreadsheet (pick one).
