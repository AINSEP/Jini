# DR-002: Fail-closed RBAC and grant authority

Status: recorded from existing design; no runtime changes.

## Context

Human roles and machine credentials share permission vocabulary but have different grant lifecycles. Checking only attached policies during issuance lets a machine principal accumulate unbounded authority, and attaching live mutable policies lets a key's authority grow later.

Principals are audit identities and cannot be hard-deleted. Roles and policies can be removed when unreferenced, but concurrent assignment must not race deletion. Losing the final active owner would make recovery impossible through the ordinary admin surface.

## Decision

Evaluate registered dotted permissions through one fail-closed matcher with workspace/resource context. Unknown grants, disabled principals, missing resource type and uninterpretable constraints deny. Bound every grant writer to permissions the issuer holds unconstrained; an owner wildcard qualifies. Human role/policy attachment targets human principals. Machine issuance starts from a grantless principal and copies a clamped immutable policy snapshot. Never attach new permission rows to built-in or frozen policy parents.

Keep principals disable-only, protect the seeded owner, and combine active-owner counting with disable in one atomic operation. Protect the seeded owner's password from third-party reset. Keep built-in roles/policies immutable and frozen issuance policies unchanged. Delete ordinary roles/policies only after a zero-reference check inside the same transaction as deletion. Removing a permission narrows authority and is distinct from granting it.

## Consequences and current limits

Conditional/scoped authority cannot be widened into an unconditional delegation. Built-in and frozen metadata cannot be relabeled to disguise authority. Issuance snapshots prevent later legal edits to a source policy from escalating an already-issued key. Catalog filtering does not substitute for the evaluator.

Password reset does not change active-owner headcount, so it does not need the disable count guard. Reference-safe hard deletion preserves audit history because audit rows name principals, not roles/policies. Host transaction isolation must cover concurrent grant/disable/delete writers.

## Defect prevented

A key inheriting broader pre-existing grants, a shared-policy edit silently increasing issued authority, or resource-scoped permissions succeeding without a matching resource context.

Two concurrent disables leaving zero owners, a concurrent attachment pointing to a deleted policy, immutable grants disguised by renaming, or an administrator taking over the seeded recovery identity.

## Source and enforcement

Restated from inherited design and review reasoning. Historical provenance is kept outside the engine. The current behavior contract and local code establish the enforcement boundary; this record adds no runtime behavior.

Evidence: [src/server/authorize.ts](../../src/server/authorize.ts), [src/server/grant-service.ts](../../src/server/grant-service.ts), [src/server/admin-crud-service.ts](../../src/server/admin-crud-service.ts).

Related: [shared decision](../../../../docs/decisions/DR-002-single-authorization-boundary.md).
