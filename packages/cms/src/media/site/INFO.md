# media/site

Site-hosting media helpers, each published as its own `@jini-ai/cms/media/site/*` subpath.

## Wiring

- `access-evidence.ts` (`@jini-ai/cms/media/site/access-evidence`): `createMediaAccessEvidence()` builds
  one in-memory, per-repository cache store of derived media access evidence (member-access settings
  only, never post bodies or a visitor's entitlement decision). The host creates ONE instance at its
  media wiring and hands that same instance to its public media-rendition route
  (`evidence.getCache({ postRepo, entryRepo })`) and to every content-write owner (post repos, entry
  repos, trash service), which call `evidence.invalidate({ owner })` after a write. Two instances share
  nothing. The repository objects are only identity keys, held weakly.
