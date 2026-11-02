# S3-compatible — implementation notes

Host-specific notes moved out of the first host's core comments (2026-10-22, vendor-to-plugins). Core describes these
behaviours generically; the vendor detail lives here.

- **Publish history.** An S3-compatible publish has no `deploymentId`; the "uploaded, not yet confirmed
  reachable" outcome records `false` reachability.
- **Account label.** No account field exists to read; the account-label heal skips these credentials.
- **Security headers.** Buckets have no header config file here, so an export carries only what HTML can
  say (core `withSecurityMeta`). With a CDN such as CloudFront, `404.html` at the output root is the
  convention it looks for.
