<!-- Source: Addy Osmani / agent-skills / code-review-and-quality -->

# Code Inspection Discipline

## Change Sizing Guidelines

| Size | Lines Changed | Status | Notes |
|------|--------------|--------|-------|
| Ideal | ~100 lines | Good | Reviewable in one sitting; easy to understand intent |
| Acceptable | ~300 lines | Acceptable | Still reviewable; may benefit from detailed description |
| Too large | ~1000 lines | Split it | Reviewer cannot hold context; miss rate increases sharply |

"Lines changed" means total diff churn (additions + deletions), not net delta and not file count. A change that rewrites 600 lines and removes 600 lines is 1200 lines of churn — still hard to review even though the net delta is zero. A 50-file refactor that is 80 lines total churn is fine.

### Split Strategies

When a change is too large, use one of these strategies:

| Strategy | Description | When to Use |
|----------|-------------|-------------|
| **Stack (Sequential PRs)** | PR 1 lays foundation (data model, types), PR 2 builds on it (service layer), PR 3 adds UI | Feature builds on itself; each layer is useful independently |
| **By File Group** | Split by which files change together (migrations in one PR, application code in another) | Changes span independent subsystems |
| **Horizontal (same layer)** | Split one layer across multiple PRs (all models, then all services, then all routes) | Large refactors of a single architectural layer |
| **Vertical (one full slice)** | Each PR implements one complete user-facing feature slice end-to-end | Parallel feature work; minimizes merge conflicts |

No strategy is universal. The goal is that each PR is understandable and mergeable independently.

---

## Change Description Format

### First Line: Imperative, Standalone

The first line (commit message or PR title) must describe the change in the imperative mood and be meaningful without context.

```
Good:   "Add rate limiting to authentication endpoint"
Good:   "Fix order total calculation for multi-currency carts"
Good:   "Refactor user repository to use Prisma"

Bad:    "Fix bug"             — what bug?
Bad:    "Phase 1"             — phase 1 of what?
Bad:    "WIP"                 — never merge WIP
Bad:    "Updates"             — meaningless without context
Bad:    "PR feedback"         — describes process, not change
```

### Body: Why, Not What

The diff shows what changed. The body explains why.

```
Add rate limiting to authentication endpoint

Brute-force login attempts were succeeding against test accounts
in staging because there was no per-IP rate limit on /auth/login.
This adds a sliding-window limit of 5 attempts per minute per IP,
with exponential backoff on repeated failures.

No change to behavior for users who authenticate successfully.
```

Anti-pattern: describing what the code does rather than why the change was made. The reviewer can see the code — they need context for why decisions were made.

---

## Review Speed SLA

**Respond within one business day.** This is the maximum, not the target. Faster is better.

The distinction that matters in practice:
- **Fast individual responses** — respond to review requests quickly so the author can keep moving
- **Quick final approval** — do not drag out a review across multiple days of back-and-forth

A change that sits for three days waiting for a review blocks everyone downstream. Review latency is a team throughput problem.

If you cannot review within one business day, say so explicitly so the author can seek another reviewer.

---

## Multi-Model Review Pattern

Different models have different strengths and blind spots. When review quality matters:

- **Model A writes** the implementation
- **Model B reviews** independently, without seeing Model A's reasoning
- **Human decides** on any conflict between A's implementation and B's review

The value is independence — Model B has not absorbed Model A's justifications and framing. It reviews the code on its merits.

This pattern is especially useful for:
- Security-sensitive changes (auth, payments, data access)
- Architectural decisions with long-term consequences
- Changes that affect correctness of business-critical logic

---

## Dependency Discipline Checklist

Before adding a new dependency, answer all of these:

- [ ] Does the existing stack already solve this? (Check before adding)
- [ ] What is the bundle size impact? (Use `bundlephobia.com`)
- [ ] Is this package actively maintained? (Last commit, open issues)
- [ ] What is the maintenance burden? (Major version upgrades, breaking changes)
- [ ] Is the license compatible with the project? (MIT/Apache OK; GPL may not be)
- [ ] Does the package have a clear, scoped purpose? (Avoid packages that do everything)

If a package fails more than two of these checks, find an alternative or implement the functionality directly.

---

## Honesty in Review

### Do Not Soften Real Issues

A review that says "you might want to consider possibly extracting this" when the correct message is "this must be extracted to avoid a data corruption bug" fails the author. Calibrate severity accurately.

**Quantify problems** rather than describing them qualitatively:

```
Vague:    "This query might be slow."
Specific: "This query does a full table scan on the users table (no index on
          email). At 500k rows this will hit >2s latency under load."
```

### Rubber-Stamp Red Flag

A review that approves every change without Required findings across a non-trivial change is suspicious. Either the code is genuinely excellent (document why), or the review was superficial. Name the red flag explicitly:

```
Note: This review found no Required findings on a 400-line PR. I have
verified each review dimension and this reflects the quality of the
implementation, not a surface review. Specific checks performed: [...]
```

### Dead Code Hygiene

When you find dead code during review:
- List it explicitly: file, function/class name, why you believe it is unused
- Ask the author before deleting: the code may be intentionally kept for reference, feature-flagged, or used via reflection

Never silently delete dead code in a review pass — discuss it, then delete with intent.
