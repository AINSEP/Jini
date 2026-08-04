# Taxonomy's content-type allow-list is permanent, not a stopgap

## The invariant

`packages/cms/src/taxonomy/write-service.ts`'s `TAXONOMY_ALLOWED_CONTENT_TYPES` is a small,
hardcoded `Set(["post", "page"])`. It looks like exactly the kind of thing a refactorer would
"clean up" into a data-driven registry, or treat as a placeholder pending a more general
content-type mechanism landing. It is neither. This engine's originating design record is explicit
that `post`/`page` opting into taxonomy via this hardcoded set is **permanent for as long as they
remain on this write-service's shape** — a prior draft framed it as "until a more general
content-type registry ships" and that framing was deliberately corrected during review, precisely
because it invited the "temporary, will be replaced" reading this note now heads off.

A separate, unrelated mechanism (an operator-defined content-type registry, used by a different
subsystem entirely) carries its **own** per-type taxonomy allow-list for content types it defines.
That registry is not an extension of `TAXONOMY_ALLOWED_CONTENT_TYPES` and does not fold into it —
the two are intentionally parallel, not layered. Don't merge them on sight; if a future content type
needs taxonomy support, decide per-type which mechanism it belongs to rather than assuming
`TAXONOMY_ALLOWED_CONTENT_TYPES` should simply grow.

(One pre-existing wrinkle worth flagging, not resolved here: the inline comment directly above the
`TAXONOMY_ALLOWED_CONTENT_TYPES` declaration still says "no other content type is eligible ... until
a future [mechanism] extends this," which is the older, superseded framing living side-by-side with
the corrected one a few lines above it. This predates the citation sweep and is a documentation
inconsistency in the source material, not something this note is introducing — worth a follow-up
cleanup, out of scope here.)

## The workspace-mismatch branch that looks dead but isn't

`assignTerms`' term-assignment validation resolves both the term's workspace and the target
content's real workspace and compares them. In every adapter this codebase ships today
(`SqliteTermRepo`/`SqliteEntryTermRepo`), both values are provably always equal — those adapters are
workspace-bound at construction (one workspace per underlying database), so the mismatch branch is
currently unreachable through them.

It stays in the code anyway, on purpose: this engine's production-readiness design record commits to
single-node (one process, one SQLite database) as the deliberate scaling target, not a stopgap
pending horizontal scaling — but a *future* adapter (a shared multi-tenant store, a different repo
implementation) would not be workspace-bound the same way, and would make this branch reachable
again. The check costs nothing to keep and closes a cross-workspace data-leak path the moment any
non-workspace-bound adapter exists. Removing it because "the two values are always equal" would be
removing a correctness guarantee based on an adapter-specific fact that isn't a language-level
invariant.
