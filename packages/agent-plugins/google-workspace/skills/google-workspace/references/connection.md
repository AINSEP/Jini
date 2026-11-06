# Connecting Google Workspace

## Signing in

- **Desktop app:** the consent page opens in the system browser (never inside the admin page). Google sends
  the person back to a one-time address on this computer (`127.0.0.1`), which closes right after.
- **Hosted site:** the consent page opens in a new tab and returns to this site.
- The consent screen shows the name of the Google sign-in app in use (the host's own app, or the
  site's own one). The person should allow every permission listed; if they untick one, the
  connection is not saved and this site says which permission is missing.
- If the person cancels on Google's page, nothing is saved. Offer to try again only if they want to.
- The host's connect action answers `{ status, connectionRef }`. `connectionRef` is an opaque reference
  to this connection (not a password or token). Every tool takes it as `connectionRef`; it does not
  change on reconnect or account switch. If you lost it, run the connect action again: when
  already connected it answers at once without a new sign-in.

## Products

Each product (v1: Sheets) is turned on separately, and turning it on is a separate step from
granting its permissions. Sheets needs only `drive.file`, which the first sign-in already grants.

- Every product starts **off**. Until the person turns Sheets on in the Google Workspace panel,
  every Sheets tool answers `product-disabled` ("turn it on in the Google Workspace panel") and
  sends nothing to Google. Tell the person to enable Sheets there; you cannot turn it on from chat.
  Checking which account is connected (`account_info`) works while every product is off.
- Turning a product **off** stops its tools at once (even a call that is part way through stops
  before its next request to Google). Its form deliveries are retried for about a day (about 8
  attempts) and then marked failed; submissions stay saved in this site, but a delivery that already
  failed is not sent again when the product is turned back on. It does **not** sign the account
  out or revoke anything at Google.
- On the **desktop app**, adding a product that needs a new permission means signing in again and
  approving the full list (installed apps cannot add permissions one at a time).
- On a **hosted site**, Google adds the new permission to the existing ones.

## Where the person does it

The plugin's admin page in the host (its Google Workspace plugin page) has three tabs:

- **Google Workspace** - connect, reconnect, switch account, disconnect, and turn each product on or
  off ("Grant permission" appears when a product is on but Google has not granted it yet).
- **Choose spreadsheet** - Google's file picker. Choosing a spreadsheet there is what lets this site open
  it; the chosen spreadsheets are listed with their ids, which you can use in chat.
- **Form destinations** - which form sends its submissions to which spreadsheet tab.

The panels cannot open links themselves: when a sign-in starts, the admin page shows a
**Continue to sign-in** button above the panel (on the desktop app it opens the system browser).

## Account actions

- **Reconnect** - sign in again with the same account. The connection, its spreadsheets and its
  form bindings stay as they are. Use it when this site says "Reconnect required".
- **Switch account** - sign in with a different Google account. The panel shows the new account and
  nothing changes until the person confirms it (or keeps the current one). While the switch waits,
  the panel lists the plugin's form destinations, each with an unticked box. Only the ones the
  person ticks move to the new account, and each moves only after this site checked that the new account
  can open its spreadsheet; the panel then lists what moved and what did not (and why).
  - A destination left unticked, or one the new account could not open, keeps the old account. Its
    deliveries fail with `authorization-required` ("Reconnect required") until the person chooses
    its spreadsheet again in the **Form destinations** tab with the new account.
  - Deliveries that were already queued keep the account they were created with, so after a switch
    they fail; they are not sent again automatically.
  - The Google Workspace tools act as the new account at once.
- **Disconnect** - the panel first asks "Disconnect and revoke?" (it cannot be undone at Google);
  after the person confirms, this site stops using the account at once, then asks Google to revoke its access.
  - If Google confirms, the saved sign-in is deleted.
  - If Google does not answer or refuses, this site shows **"Disconnected locally; Google revocation
    pending"**. This site no longer uses the account, keeps the switched-off sign-in only so it can
    retry, and the person can remove this site's access at https://myaccount.google.com/connections (the panel's **Open
    Google Account page** button opens it). Never tell the person
    revocation succeeded unless this site said "confirmed".

## Advanced: your own Google OAuth client

A self-hosted site whose address the host's Google sign-in app does not list (this site then says it
"cannot sign in from this site's address"), or an organisation that wants its own Google Cloud
project, can use its own OAuth client instead of the host's. The client secret is typed only into
the host's secure credential form, never into chat. Never ask for it in chat and never accept one pasted there.

1. In their own Google Cloud project, under **Google Auth platform → Clients → Create client**, the
   person creates an OAuth client: **Web application** for a
   hosted site, with the authorized redirect URI the card names (this site's address plus the
   host's OAuth callback path); **Desktop app** for the desktop app. They enable the Google Sheets API, Google Drive API and Google Picker API there and
   set the consent screen up.
2. Open the plugin's **Use your own Google sign-in app** card (its credential card with
   `target: "google-workspace-oauth-client"`; the host guidance names the tool). It fixes the label and address; the person enters only the client ID and client secret:
   - **Label:** exactly `google-workspace/account OAuth client`
   - **Base URL:** `https://oauth2.googleapis.com/token`
   - **Username:** the OAuth client ID
   - **Token:** the client secret
   Use the host's generic custom-credential form only if the plugin card is unavailable.
3. The person reconnects in the Google Workspace panel. Until then it shows **Reconnect required**:
   a sign-in made with one client cannot be used with another. Spreadsheets chosen before must be
   chosen again with the picker, because Google ties each picked file to the Cloud project whose client picked it.

If this site says it **"cannot use your own OAuth client"**, the message names the saved credential and
what is wrong (base URL or missing client ID): fix it in the host's saved credentials, then retry. After
the client changes (saved, replaced or removed), `reconnect-required` means "reconnect once".

To go back to the host's own client, delete that saved credential and reconnect. On a hosted site the file
picker uses the site's Picker settings (browser API key and application ID):
with your own client the operator sets them to that project's browser key and project number, or the
picker cannot open the chosen files.
