# Enterprise Spec Reference: Program Rollup

Use program rollup when the work belongs to a named initiative spanning multiple features, teams, or time horizons.

## program.spec.md

Location:

```text
<AI_DEV_SHOP_ROOT>/specs/programs/<program-id>/program.spec.md
```

Example structure:

```markdown
# Program Spec: <Program Name>

Program ID:    PROG-004
Version:       1.0
Last Edited:   <ISO-8601 UTC>
Hash:          sha256:<hash>
Owner:         <Program Manager>
Initiative:    <OKR or program>
Target Date:   <ISO-8601 date>

## Initiative Goal
...

## Feature Inventory
...

## Cross-Feature Dependencies
...

## Shared Contracts
...

## Overall Status
...
```

## Coordinator Rollup View

```text
PROGRAM ROLLUP — PROG-004 — <date>

Feature              | Status        | Completion | Blocking Issues
---------------------|---------------|------------|----------------
SPEC-042             | In Progress   | 40%        | None
SPEC-043             | Spec Approved | 0%         | Waiting on SPEC-042 integration contract
SPEC-044             | Discover      | 0%         | Spec not written
```

## Feature Metadata Link

Program-linked feature specs include:

```text
Spec ID:      SPEC-042
Program:      PROG-004
Version:      1.2
Last Edited:  2026-02-21T14:00:00Z
Hash:         sha256:<hash>
```

Without the `Program` field, the feature is treated as standalone.
