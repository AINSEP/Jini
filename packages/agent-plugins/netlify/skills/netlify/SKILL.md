---
name: netlify
description: Publish the site's static export to Netlify with the workspace's own saved token. Covers the token, the site name, which files upload, and what each failure means in plain words.
---

# Netlify

## Connection card

Choose the card yourself from its `usedFor` list. Reuse a saved key or working sign-in for that
task. Never offer a replacement unless the person asks.

Open the plugin’s **Connect Netlify** card through the host. It links to token creation and explains team SSO access. The hosting save flow verifies and seals the token.

The workflow applies to any host: `inspect static-publishing capabilities` shows whether a
token is saved, `preview static publishing` comes first, and `publish the static site with confirmation`
publishes once the person confirms. `ok: "partial"` means not reachable yet: never call it failed or live.
This file is what is particular to Netlify.

- **No hosting account yet?** Netlify is the quickest free start: one token, no config fields.
- **Token:** a personal access token from https://app.netlify.com/user/applications#personal-access-tokens.
  No config fields: the host finds or creates the Netlify site from the project name.
- **Site name:** `jini-<project-name>` (lowercase, hyphens). Publishing the same project again updates the
  same site. The prefix is kept for sites published before this plugin existed.
- **Only changed files upload.** Netlify compares file fingerprints and asks only for what it lacks.
- **Security headers:** this plugin writes them into a root `_headers` file; a `_headers` file in the
  site itself is replaced.

## Failure messages and what to tell the person

| Message | Meaning | Next step |
|---|---|---|
| `Netlify token is required.` | No token in the saved credential. | Open the plugin card above. |
| `Invalid token` / `Access Denied` (401/403) | The token is wrong, expired, or revoked. | Explain the refusal; replace the token only if asked. |
| `Name has already been taken` | Another Netlify account owns that site name. | Publish under a different project name. |
| `Netlify deployment error.` / `rejected.` | Netlify refused the deploy after upload. | Retry once; if it repeats, check the Netlify dashboard's deploy log. |
| `Payload too large` | One file is over Netlify's size limit. | Find and shrink the large file (usually a video or image). |
| `Netlify returned a non-JSON response.` | Netlify or the network had a hiccup. | Retry in a minute. |
| `fetch timed out after ...` | Netlify did not answer in time. | Retry in a minute. |
