---
name: vercel
description: Publish the site's static export to Vercel with the workspace's own saved token. Covers the token, the optional team, the project name, how a publish reaches the live address, Deployment Protection, and what each failure means in plain words.
---

# Vercel

## Connection card

Choose the card yourself from its `usedFor` list. Reuse a saved key or working sign-in for that
task. Never offer a replacement unless the person asks.

Open the plugin’s **Connect Vercel** card through the host. It links to token creation and explains account/team access. The hosting save flow verifies and seals the token.

The steps are the same for every host: `deployment_get_static_publish_capabilities` shows whether a
token is saved, `deployment_preview_static_publish` comes first, and `deployment_execute_static_publish`
publishes once the person confirms. `ok: "partial"` means not reachable yet: never call it failed or live.
This file is what is particular to Vercel.

- **Token:** an access token from https://vercel.com/account/tokens. Save it with the plugin card above.
- **Share links (optional):** to share a site export as a download link with no S3, the person adds a
  Vercel Blob store's read-write token (Vercel > Storage > Blob store > `BLOB_READ_WRITE_TOKEN`) in the
  card's optional **Blob read-write token** field. They type it into the card, never into the chat.
  Without it, a share is a private download only. A revoked link can keep serving for up to a minute
  (Blob's edge cache); if revoke says deletion is not verified yet, retry it after a minute.
- **Team (optional):** the publish config's `teamId` puts the project under a Vercel team instead of the
  personal account. Leave it out for a personal account; a blank one is refused.
- **Project name:** the project name, lowercased with hyphens (up to 80 characters). Publishing again
  updates the same project.
- **Security headers:** this plugin writes them into a root `vercel.json`; a `vercel.json` in the site
  itself is replaced.
- **Production, every time:** each publish is a production deployment, so it updates the live
  `<project>.vercel.app` address, not a preview.
- **Only changed files upload.** Files go up one by one, keyed by their fingerprint. If Vercel says some
  are missing when the deployment is created, the host sends exactly those and tries once more.
- **Deployment Protection:** new Vercel projects often require a Vercel login to view. The host detects that
  and reports the link as protected rather than live.

## Failure messages and what to tell the person

| Message | Meaning | Next step |
|---|---|---|
| `Vercel token is required.` | No token in the saved credential. | Open the plugin card above. |
| `You don't have permission to create a project.` | The token cannot create projects (often the wrong team). | Check the token's scope or the `teamId`. |
| `Deployment is protected by Vercel. ...` | The site is up but behind Vercel's login. | In Vercel, turn off Deployment Protection for the project, or add a custom domain. |
| `Vercel deployment failed.` | Vercel refused the build after upload. | Retry once; if it repeats, check the deployment log in the Vercel dashboard. |
| `... attempted to redirect an authenticated request ...` | Something between the host and Vercel redirected the call; the host refused to send the token on. | Retry later; if it repeats, check the server's network or proxy. |
| `Vercel returned a non-JSON response.` / `fetch timed out after ...` | Vercel or the network had a hiccup. | Retry in a minute. |
