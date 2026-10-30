---
"@jini-ai/plugins": minor
---

Release standalone provider distributions and a metadata-only plugin catalog in the
fixed 0.7.0 release group. Hosts explicitly select @jini-ai/plugin-<id> packages
instead of the @jini-ai/provider-plugins aggregate; installing a package never
installs another plugin. Existing artifact IDs, contracts, integrity verification,
installers and loaders are preserved, including commerce Phase 1's Stripe API.

The aggregate becomes private build tooling. After rc.2 consumers migrate, deprecate
its last verified published version with the standalone mapping; keep old tarballs.
See docs/plugin-packages-migration.md for host migration and first publication.
