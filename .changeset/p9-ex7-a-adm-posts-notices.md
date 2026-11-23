---
"@jini-ai/admin": patch
---

Move four Posts editor pieces from the host (A-adm-posts-2 / A-K2-posts-1 slice): `@jini-ai/admin/posts/editor/notices/{PostAutosaveRecoveryBanner,PostAutosaveStaleBanner,PostVersionConflictBanner}` and `@jini-ai/admin/posts/editor/toolbar/ToolbarOverflowMenu`. Message builders arrive as required props from the host.
