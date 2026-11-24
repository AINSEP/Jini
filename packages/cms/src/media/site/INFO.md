# media/site

Site-hosting media helpers, each published as its own `@jini-ai/cms/media/site/*` subpath.

## Wiring

- `access-evidence.ts` (`@jini-ai/cms/media/site/access-evidence`): an in-memory, per-repository
  cache of derived media access evidence (member-access settings only, never post bodies or a
  visitor's entitlement decision). The host's public media-rendition route calls
  `getMediaAccessEvidenceCache({ postRepo, entryRepo })` with its own post/entry repository objects
  as cache keys; every content-write owner (post repos, entry repos, trash service) calls
  `invalidateMediaAccessEvidence({ owner })` after a write. The host injects nothing else: the
  repository objects are only identity keys, held weakly.
