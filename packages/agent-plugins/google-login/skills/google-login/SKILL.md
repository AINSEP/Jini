---
name: google-login
description: Set up Google member sign-in for site members or Google via an app's existing Supabase Auth.
---

# Google login

This integration is marked **soon** and has not been tested with a real Google account. Tell the person this before configuring it; do not claim it works until the real sign-in has been checked.

## Choose the destination first

Ask whether the site uses **site members** or **Supabase Auth**, or check whether the supabase plugin is active at runtime. An active plugin is a clue; confirm which authentication system the target app actually uses. Never import the supabase plugin or add a Supabase runtime dependency. Its branch below is instructions only.

Site member login and Google Workspace have separate credentials and activation. Use this plugin for visitor sign-in; Google Workspace owns operator file access. Never replace a working client unless asked. Never ask for the Client Secret in chat, tool arguments, pasted configuration, screenshots, or logs. The person enters it in the secure card or Supabase dashboard themselves.

## Prepare the Google client

1. Open [Google Cloud Console](https://console.cloud.google.com/auth/clients) and select or create the app's project.
2. In Google Auth Platform, configure **Branding** (app identity and support contact), **Audience**, and **Data Access**. Choose External unless access is intentionally restricted to one Workspace organization. Request only `openid email profile`; do not add Drive, Sheets, Gmail, offline access, or refresh-token permissions.
3. Under **Clients → Create client**, choose **Web application**. The older navigation is **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
4. Add the exact authorized redirect URI for the chosen branch below. HTTPS is required for production; Google permits localhost development exceptions. Scheme, host, port, path and any configured base path must match exactly. A JavaScript origin is not a replacement for a redirect URI.
5. Check Audience's Testing/Production status before rollout. Identity-only `openid email profile` requests have an exception to the usual testing-user restrictions. Additional permissions can change those rules. Publishing and verification are separate; consult [Google's production readiness guidance](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview) for the app's current requirements.

## Site members

Enable Google Login through the host's plugin controls. Use the host's configured canonical
address and exact member sign-in callback URI, including any configured base path. Open the
secure connection card for the client ID and secret; never receive either secret in chat.
The host owns browser binding, state, PKCE, token validation, linking, unlinking and member
sessions. Verify sign-in, sign-out and unlinking through the host's existing member flow.

## Google via Supabase Auth

1. Open the target project's **Supabase dashboard → Authentication → Providers → Google** and enable Google.
2. The person enters the **same Google Client ID and Client Secret** directly in that Supabase panel themselves, never in chat. The host's credential card is unnecessary unless this site also uses site members.
3. Copy the exact **Callback URL (for OAuth)** shown on that panel. Add it to the Google OAuth client's **Authorized redirect URIs**. A hosted callback commonly looks like `https://<project-ref>.supabase.co/auth/v1/callback`; use the displayed value, including a custom domain if configured. For local Supabase, use the callback shown by that instance.
4. One Google Web application client can list both the Supabase callback and the host's callback when both systems are used. Keep both exact URIs in Google; do not substitute one for the other.
5. In Supabase **Authentication → URL Configuration**, configure the app's own allowed return URL. The Google-to-Supabase callback and the Supabase-to-app return URL serve different steps.
6. Test through the app's existing Supabase sign-in flow. These instructions do not automatically associate Supabase users with site members or replace the app's session system. See [Supabase's Google setup](https://supabase.com/docs/guides/auth/social-sign-in/auth-google).

## Troubleshooting without exposing secrets

- `redirect_uri_mismatch`: compare the exact configured callback with Google's authorized list, including scheme, port and base path.
- Missing sign-in button: check plugin activation, the saved Client ID/Secret card and configured canonical address. Do not switch to Workspace credentials.
- Browser/state failure: restart from `/signin` in the same browser; do not forward an authorization URL, bypass binding, weaken validation or add issuer aliases.
- Google access denied: check Audience restrictions and the selected account; request only identity permissions. Never copy callback query strings, codes, state, verifier, tokens, claims or upstream error bodies into chat or logs. Report fixed outcome codes only.

## Embed the sign-in button on a public page

Use the host's public plugin-component capability to embed this plugin's sign-in button.
Choose an explicit light, dark or neutral variant, keep an authored fallback when sign-in is
unavailable, and follow Google's branding rules. The host owns its sign-in routes and secure
member-session flow; use its exact callback URI and activation controls.
