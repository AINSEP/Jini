# Specs-As-Built Freshness Policy

This project has not declared a strict specs-as-built freshness policy yet.

When enabled, generated and hybrid artifacts should record:

- `source_scope`
- `source_fingerprint`
- `last_verified_at`
- `last_verified_commit`
- `reverse_spec_run`

Use `status: rewriting` only during active language/runtime migration. Before the rewrite is complete, update `source_scope` to the replacement files and recompute `source_fingerprint`.

Use `<AI_DEV_SHOP_ROOT>/framework/contracts/specs-as-built-freshness.md` as the contract reference.
