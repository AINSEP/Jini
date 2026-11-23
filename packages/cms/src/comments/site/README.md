# `@jini-ai/cms/comments/site/*` — site-runtime comments pieces

| file | holds |
| --- | --- |
| `types.ts` | `commentsDataModule({ provenance })` — the comments plugin's 2-table data-module declaration. |
| `data-module-install.ts` | `installCommentsDataModule({ db, dbPath, provenance })` — boot-time idempotent declare; throws on failure. |
| `comment-targets.ts` | Comment target resolution. |
| `ip-hash-salt.ts` | Visitor IP hash salt. |

## Wiring

- The host supplies the declaration's `provenance` (`sourceUrl`, `publisher`): publisher identity is
  product copy and stays in the host. It passes the same value to `commentsDataModule` (for its
  first-party data-module registry) and to `installCommentsDataModule` (at boot).
- The host injects the data-module store (`db`) and the content database path (`dbPath`).
