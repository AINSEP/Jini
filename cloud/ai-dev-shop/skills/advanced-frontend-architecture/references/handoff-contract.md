# Frontend Architecture Handoff Contract

Use this contract when `advanced-frontend-architecture` finishes Selection Mode
or when Validation Mode amends an existing ADR.

The handoff is written by Software Architect for Programmer. It must be concrete
enough that Programmer can implement without reselecting the architecture.

## Required Handoff

````markdown
## Architecture Handoff

### Selected Architecture
- Combo:
- Rationale:
- Decision scope:
- Confidence:

### Rejected Alternatives
| Alternative | Strongest Disqualifier | Revisit If |
|---|---|---|

### Folder Map
```text
[concrete paths]
```

### Dependency Rules
- [rule]
- [rule]

### Public API Rules
- [which modules/slices expose index files or public contracts]
- [what imports are forbidden]

### State Ownership
| State Category | Owner | Location | Notes |
|---|---|---|---|
| Server/cache state | | | |
| Client-only UI state | | | |
| Domain/business state | | | |
| URL/navigation state | | | |
| Optimistic/transient state | | | |

### Implementation Skills to Load
- [skill path] - [why]

### Enforcement Gates
- [lint/import rule]
- [CI/test check]
- [review checklist item]

### First Validating Slice
- Slice:
- Why this proves the architecture:
- Expected files:

### Migration Plan
- Phase 1:
- Phase 2:
- Rollback:

### Reversal Triggers
- [signal that invalidates the decision]
- [signal that requires new Selection Mode]

### Programmer Decision Boundaries
| Programmer May Decide Locally | Requires Architect Review |
|---|---|
| Internal helper extraction inside an approved slice | New cross-slice dependency |
| Component split inside approved UI path | New top-level layer or folder convention |
| Local state shape for one component | Moving domain rules into UI or store |
| Adapter implementation behind approved port | New port, new external integration boundary |
| Test file placement following existing pattern | Weakening or bypassing boundary enforcement |
````

## Required Specificity

The handoff must name real paths or path templates. Avoid abstract guidance like
"separate concerns" unless it is backed by concrete import and folder rules.

Good:

```text
src/modules/billing/domain/
src/modules/billing/vertical-slices/issue-refund/
src/ui/react/billing/issue-refund/
```

Weak:

```text
Put domain logic in a clean architecture layer.
```

## Implementation Skill Mapping

| Selected pattern | Implementation skill/reference |
|---|---|
| React Orc-BASH | `skills/frontend-react-orcbash/SKILL.md` |
| Feature-Sliced Design | `skills/feature-slice-design/SKILL.md` |
| General ports/adapters | `skills/hexagonal-architecture/SKILL.md` plus frontend-specific ADR constraints |
| Backend/service implementation | `skills/backend-implementation/SKILL.md` |
| Tactical UI review | `references/frontend-implementation-patterns.md` |

Do not list `advanced-frontend-architecture` as a Programmer implementation
skill. Programmer receives the decision and follows it.

## Handoff Quality Gate

Before handing off, verify:

- selected combo is a composed stack, not just one buzzword;
- rejected alternatives include real disqualifiers;
- folder map is concrete;
- dependency rules are lint/review ready;
- state ownership separates server state, client-only state, URL state, and
  domain/business rules;
- implementation skills are named only when applicable;
- migration and reversal triggers are explicit;
- Programmer decision boundaries prevent architecture reselection.
