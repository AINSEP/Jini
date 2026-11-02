---
name: google-login
description: Set up Google member sign-in in Tovu or Google via an app's existing Supabase Auth.
---

# Google login

This integration is marked **soon** and has not been tested with a real Google account. Tell the person this before configuring it; do not claim it works until the real sign-in has been checked.

## Choose the destination first

Ask whether the site uses **Tovu members** or **Supabase Auth**, or check whether the supabase plugin is active at runtime. An active plugin is a clue; confirm which authentication system the target app actually uses. Never import the supabase plugin or add a Supabase runtime dependency. Its branch below is instructions only.

Tovu member login and Google Workspace have separate credentials and activation. Use this plugin for visitor sign-in; Google Workspace owns operator file access. Never replace a working client unless asked. Never ask for the Client Secret in chat, tool arguments, pasted configuration, screenshots, or logs. The person enters it in the secure card or Supabase dashboard themselves.

## Prepare the Google client

1. Open [Google Cloud Console](https://console.cloud.google.com/auth/clients) and select or create the app's project.
2. In Google Auth Platform, configure **Branding** (app identity and support contact), **Audience**, and **Data Access**. Choose External unless access is intentionally restricted to one Workspace organization. Request only `openid email profile`; do not add Drive, Sheets, Gmail, offline access, or refresh-token permissions.
3. Under **Clients → Create client**, choose **Web application**. The older navigation is **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
4. Add the exact authorized redirect URI for the chosen branch below. HTTPS is required for production; Google permits localhost development exceptions. Scheme, host, port, path and any configured base path must match exactly. A JavaScript origin is not a replacement for a redirect URI.
5. Check Audience's Testing/Production status before rollout. Identity-only `openid email profile` requests have an exception to the usual testing-user restrictions. Additional permissions can change those rules. Publishing and verification are separate; consult [Google's production readiness guidance](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview) for the app's current requirements.

## Tovu members

1. Enable Google Login in this site's Agent Plugins. It is bundled but starts disabled.
2. Read the site's **configured canonical address** and the actual bound workspace ID. Do not infer the address from request Host or forwarded headers. Compute and show the exact callback using the URL API, preserving any configured base path:

   ```js
   const callback = new URL(configuredSiteAddress);
   callback.pathname = callback.pathname.replace(/\/$/, '')
     + '/api/members/v1/workspaces/' + encodeURIComponent(workspaceId) + '/oidc/google/callback';
   callback.search = '';
   callback.hash = '';
   callback.href;
   ```

   For example, `http://localhost:3000/api/members/v1/workspaces/<workspaceId>/oidc/google/callback`. Replace the placeholder before showing it to the person. Copy the resulting URI into Google's **Authorized redirect URIs**. Use separate local and deployed clients when appropriate.
3. Open the existing secure card with `credential_save { kind: "plugin-provider", target: "google-login-oauth-client" }`. The person pastes the Client ID into **Google client ID** (`username`) and the Client Secret into the masked secret field (`token`). The existing vault seals it; the assistant never receives it. No extra callback field is needed on the card.
4. Visit `/signin` and try **Sign in with Google**. Success returns to `/account`. This creates or links a site member, with no administrator privileges. Tovu core owns state, browser binding, PKCE, token validation and member sessions; do not implement a second flow in this plugin.
5. Explain initial linking: Google-verified `@gmail.com`/`@googlemail.com` addresses and verified Google Workspace accounts with an `hd` claim auto-link directly. Other Google addresses require **one emailed code** to the member's address before the first auto-link, because Google's email verification can outlive mailbox ownership. Later sign-ins use issuer + subject, even if email changes. Disabled or trashed members cannot sign in.
6. Check sign-out and `/account` **Unlink Google**. Unlink requires a recent sign-in and another usable sign-in method; set a password if directed. Unlink must remain effective on the next Google sign-in. Reconnect deliberately with **Connect Google** from the signed-in `/account` page. It does not revoke Google Workspace file access.

## Google via Supabase Auth

1. Open the target project's **Supabase dashboard → Authentication → Providers → Google** and enable Google.
2. The person enters the **same Google Client ID and Client Secret** directly in that Supabase panel themselves, never in chat. Tovu's credential card is unnecessary unless this site also uses Tovu members.
3. Copy the exact **Callback URL (for OAuth)** shown on that panel. Add it to the Google OAuth client's **Authorized redirect URIs**. A hosted callback commonly looks like `https://<project-ref>.supabase.co/auth/v1/callback`; use the displayed value, including a custom domain if configured. For local Supabase, use the callback shown by that instance.
4. One Google Web application client can list both the Supabase callback and Tovu's callback when both systems are used. Keep both exact URIs in Google; do not substitute one for the other.
5. In Supabase **Authentication → URL Configuration**, configure the app's own allowed return URL. The Google-to-Supabase callback and the Supabase-to-app return URL serve different steps.
6. Test through the app's existing Supabase sign-in flow. These instructions do not automatically associate Supabase users with Tovu members or replace the app's session system. See [Supabase's Google setup](https://supabase.com/docs/guides/auth/social-sign-in/auth-google).

## Troubleshooting without exposing secrets

- `redirect_uri_mismatch`: compare the exact configured callback with Google's authorized list, including scheme, port and base path.
- Missing Tovu button: check plugin activation, the saved Client ID/Secret card and configured canonical address. Do not switch to Workspace credentials.
- Browser/state failure: restart from `/signin` in the same browser; do not forward an authorization URL, bypass binding, weaken validation or add issuer aliases.
- Google access denied: check Audience restrictions and the selected account; request only identity permissions. Never copy callback query strings, codes, state, verifier, tokens, claims or upstream error bodies into chat or logs. Report fixed outcome codes only.

## Embed the sign-in button on a public page

Use the existing `content_read.plugin` export contract for `tovu/google-login` → `sign-in-button`.
The plugin must be enabled and its Google client configured. `host-unavailable` means finish
setup first; `props-required` means the host is configured and the author must choose a variant.
The required `variant` is `light`, `dark`, or `neutral`; no template defaults or logic are added.
Use the marker owner to serialize config; do not construct a second JSON attribute escaper.

```html
<div data-embed-config='{"type":"plugin","plugin":"tovu/google-login","component":"sign-in-button","version":1,"props":{"variant":"light"}}'>
  <p>Google sign-in is currently unavailable.</p>
</div>
```

Keep a useful authored fallback. Disabled/unconfigured plugins render that fallback without a
button. Static exports always render the fallback, while bundling the stylesheet and mark.
The action is a native link to the host's same-origin start route; Tab focuses it and Enter
starts sign-in, including with JavaScript off. Do not replace the host link or add OAuth JavaScript.
The Interactive editor uses a protected card; Preview and the published page render the real UI.
The card's availability is a page-load snapshot; reload after changing plugin/client setup.

Theme hooks are `.plugin-google-login-sign-in-button`, its `__mark` and `__label` parts,
and its `--light`, `--dark`, `--neutral` variant classes. Defaults live in `@layer plugin-exports`,
so ordinary theme CSS wins. Set inherited custom properties on the authored wrapper or a theme:
`--plugin-signin-bg`, `--plugin-signin-fg`, `--plugin-signin-border`, `--plugin-signin-radius`,
`--plugin-signin-height`, `--plugin-signin-padding`, `--plugin-signin-gap`, `--plugin-signin-font`,
`--plugin-signin-font-size`, `--plugin-signin-font-weight`, `--plugin-signin-line-height`,
`--plugin-signin-letter-spacing`, `--plugin-signin-hover-shadow`, `--plugin-signin-active-shadow`,
`--plugin-signin-focus-color`, `--plugin-signin-focus-width`, `--plugin-signin-focus-offset`.

Keep Google's fixed sign-in wording, approved palette, spacing, visible focus, and full-color G.
Do not stretch, recolor, filter or replace the mark. The mark stays on white in all variants.
Prefer Google Sans Medium when the host theme supplies it; the offline fallback is Arial.
Check the current [Google branding rules](https://developers.google.com/identity/branding-guidelines)
before visual acceptance. The unchanged gradient SVG is bundled from
[SVGL](https://github.com/pheralb/svgl/blob/main/static/library/google.svg)
(Git blob `8ab1351b939a780aa05645d31e5bed3fcf5c5493`); Google's trademarks remain Google's.
