# GitHub Pages — implementation notes

Host-specific notes moved out of the first host's core comments (2026-10-22, vendor-to-plugins). Core describes these
behaviours generically; the vendor detail lives here.

- **Base path.** A GitHub Pages *project* site is served at `https://<owner>.github.io/<repo>/`, not the
  domain root, so a publish rewrites the export for `/<repo>` (core: `site-export/site-exporter.ts`
  base-path support; `static-publish/types.ts` echoes the base path back).
- **Publish history.** `owner`/`repo`/`branch`/`commitSha` in core's publish-history rows are this
  target's fields; its `deploymentId` is the same commit sha `commitSha` carries.
- **Account label.** The verified account label is the GitHub `login`; the assistant defaults a GitHub
  Pages publish's `owner` to it instead of guessing (2026-08-16, Defect 1).
- **Credentials.** A bare token is never enough: `owner`/`repo` are required.
- **Security headers.** GitHub Pages has no header config file, so an export carries only what HTML can
  say (core `withSecurityMeta`). Its 404 convention is `404.html` at the output root.
- **Deploy poll.** A publish blocks on the Pages build poll (up to about a minute), which is why the
  admin publish route is trigger+status.
- **Default branch.** An omitted `config.branch` publishes to `gh-pages`; core's `publish_history.branch`
  column records the branch actually used.
