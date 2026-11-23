# `@jini-ai/cms/comments/site/*` — site-runtime comments pieces

| file | holds |
| --- | --- |
| `types.ts` | `commentsDataModule({ provenance })` — the comments plugin's 2-table data-module declaration. |
| `data-module-install.ts` | `installCommentsDataModule({ db, dbPath, provenance, declareDataModule })` — boot-time idempotent declare; throws on failure. The host injects its kernel's `declareDataModule`. |
| `comment-targets.ts` | Comment target resolution. |
| `ip-hash-salt.ts` | Visitor IP hash salt. |

## Wiring

- `installCommentsDataModule` takes the host's `declareDataModule` (its database kernel's data-module installer) as a required field, so this package imports no database package.
- The host supplies the declaration's `provenance` (`sourceUrl`, `publisher`): publisher identity is
  product copy and stays in the host. It passes the same value to `commentsDataModule` (for its
  first-party data-module registry) and to `installCommentsDataModule` (at boot).
- The host injects the data-module store (`db`) and the content database path (`dbPath`).
