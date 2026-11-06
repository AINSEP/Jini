---
name: github-pages
description: Publish the site's static export to GitHub Pages with the workspace's own saved token. Covers the token, the owner, repo and branch fields, the address and base path, and what each failure means in plain words.
---

# GitHub Pages

## Connection card

Choose the card yourself from its `usedFor` list. Reuse a saved key or working sign-in for that
task. Never offer a replacement unless the person asks.

Open the plugin’s **Connect GitHub Pages** card through the host. Select only the destination repository and grant Contents and Pages **Read and write**. The card links to token creation; the hosting owner verifies and seals it.

The workflow applies to any host: `inspect static-publishing capabilities` shows whether a
credential is saved, `preview static publishing` comes first, and `publish the static site with confirmation`
publishes once the person confirms. `ok: "partial"` means not reachable yet: never call it failed or live.
This file is what is particular to GitHub Pages.

- **Token:** a fine-grained personal access token (https://github.com/settings/personal-access-tokens)
  for the repository, with **Contents: Read and write** and **Pages: Read and write**. Save it with the plugin card above.
- **Config fields:** `owner` (user or organization), `repo`, and optional `branch` (default `gh-pages`).
  The host commits the site to that branch and switches GitHub Pages on for it if it is off.
- **Owner:** never guess it from the person's name or email address. Use the verified token's login
  (`accountLabel` in the capabilities result) and confirm it with the person. If `accountLabel` is null,
  say the account is not known and ask for the GitHub user or organization. Do not offer an example
  name: an invented one was once read back as a real suggestion and published to a repo nobody owned.
- **Address:** `https://<owner>.github.io/<repo>/`. The site is built with every link under `/<repo>`,
  so previewing shows that base path.
- **`.nojekyll`:** this plugin adds it, so GitHub does not run Jekyll and drop files whose names start
  with `_`.
- **Security headers:** GitHub Pages cannot set custom response headers, so none are sent.

## Failure messages and what to tell the person

| Message | Meaning | Next step |
|---|---|---|
| `GitHub token is required.` | No token in the saved credential. | Open the plugin card above. |
| `invalid GitHub owner '...'` / `invalid GitHub repo '...'` / `invalid branch name '...'` | A config field has a typo or bad characters. | Correct the owner, repo, or branch name. |
| `Bad credentials` / `Resource not accessible by personal access token` (401/403) | The token is wrong, expired, or lacks the permissions above. | Check this repo's Contents and Pages access; replace the token only if asked. |
| `Not Found` (404) | The repo does not exist, or the token cannot see it. | Check the owner and repo names and the token's repository access. |
| `GitHub Pages build errored.` | GitHub accepted the files but its Pages build failed. | Retry once; if it repeats, check the repo's Pages settings. |
| `... attempted to redirect an authenticated request ...` | Something redirected the call; the host refused to send the token on. | Retry later; if it repeats, check the server's network or proxy. |
| `GitHub returned a non-JSON response.` / `fetch timed out after ...` | GitHub or the network had a hiccup. | Retry in a minute. |
