# Pass 5: Synthesis and Conflict Resolution

Load this file when executing the final synthesis pass. Reads ALL prior artifacts (`artifact-1` through `artifact-4`). Produces the merged spec, review digest, extraction manifest, coverage map, and intentional-changes aggregation.

## References to Load

- `references/extraction-layers.md` — output schema (for deduplication and format consistency)

## Source Context Re-Read Access

When resolving contradictions (`[NEEDS CLARIFICATION]`) between artifacts, the synthesis agent may need context beyond what the pass artifacts summarize. If a contradiction involves critical-criticality requirements and cannot be resolved from artifact text alone, the synthesis agent has explicit tool access to re-read the original source files at the `file:line` coordinates cited in the requirements' `source_evidence` fields. Do not attempt to resolve deep contradictions purely from artifact summaries.

**Requirement:** This requires the source repository to remain accessible at the commit SHA recorded in the Extraction Manifest. If extraction ran in an ephemeral environment (CI, container) that tore down the workspace, synthesis cannot honor this — flag unresolvable contradictions as `[NEEDS CLARIFICATION]` for human review instead.

## Phase 11: Conflict Resolution and Gap Marking

Merge all pass artifacts and resolve:

1. **Contradictions between passes** — Pass 3 failure matrix may contradict Pass 1 test evidence. Resolve using confidence hierarchy or mark `[NEEDS CLARIFICATION]`.
2. **Amendments from later passes** — If Pass 2, 3, or 4 discovered entrypoints/behaviors that earlier passes missed, merge them into the unified spec. `[AMENDMENT]` notes from pass artifacts are resolved here: either update existing REQs with new evidence, or create new REQs. If an amendment creates a contradiction, promote to `[NEEDS CLARIFICATION]`.
3. **Dead code verification** — Cross-reference extracted behaviors against reachability graph. Unreachable code with no test, no runtime evidence, and no registration is `[LIKELY DEAD CODE]`.
4. **Zombie flag pruning** — Cross-reference feature-flag-guarded code branches (Pass 1) against active flags from external provider (Pass 4). Code paths for deleted/inactive flags → `[LIKELY DEAD CODE]`.
5. **Data quality and legacy exceptions** — Sample existing data for schema violations, orphaned records, legacy enum values, nulls in non-nullable columns. Record as `[DATA COMPATIBILITY]`.
6. **API compatibility concerns** — Deprecated-but-active endpoints, versioned response shapes, undocumented consumers from the consumer inventory.
7. **Temporal coupling verification** — Cross-reference Phase 6 temporal invariants with Phase 8 job semantics.
8. **Concurrency vs transaction overlap** — Verify Phase 6b concurrency contracts don't duplicate Phase 6 transaction boundaries.
9. **Rate limit propagation** — Verify that every external dependency's rate-limit behavior is connected to a client-facing failure response in the failure matrix.

## Review Digest Production

Aggregate ALL human-attention markers from all passes into ONE ordered document:

**Blocking (must resolve before Software Architect proceeds):**
1. `[NEEDS CLARIFICATION]` — contradictions between sources
2. `[HUMAN DATA REQUEST]` (priority: blocking) — external data needed
3. `[CONTRACT VS IMPLEMENTATION]` — observed vs normative conflict on external behavior
4. `[DISTRIBUTED TRANSACTION RISK]` — cross-domain atomicity that may block target architecture

**Important (should resolve before implementation):**
5. `[CONCURRENCY CONTRACT]` — serialization requirements needing human verification
6. `[PRECISION CONTRACT]` — numerical/string semantics needing verification
7. `[TEMPORAL COUPLING]` — ordering dependencies needing confirmation
8. `[ENVIRONMENTAL CONTRACT]` — OS/binary dependencies needing provisioning plan
9. `[DATA COMPATIBILITY]` — legacy data exceptions needing migration strategy
10. `[CUTOVER RISK]` — dual-write/cutover window needing operational plan

**Advisory (resolve during implementation or defer):**
11. `[UNTESTED SIDE EFFECT]` — side effects without test evidence
12. `[LIKELY DEAD CODE]` — candidates for removal pending owner confirmation
13. `[SPEC AMENDMENT REQUEST]` — downstream-discovered gaps
14. `[HUMAN DATA REQUEST]` (priority: nice-to-have) — non-blocking external data

For each item: cite source, affected requirements, and recommended resolution path.

## Adversarial Verification

Before producing the final review digest, run a self-audit pass checking for:

- Requirements without source evidence citations
- `inferred` or `documented-only` confidence marked as `confirmed` (violation of Confirmation Rules)
- Missing failure cases for state-changing endpoints
- Missing access-control matrix rows for protected endpoints
- Missing transaction boundaries for multi-write operations
- `verified_none` without negative-proof citation
- Critical-criticality paths without characterization tests
- Implementation details leaking into contract text (framework-specific terms, internal method names)
- Duplicate or contradictory requirements across passes
- Consumer compatibility risks not connected to specific consumers in the inventory

Promote any findings to the appropriate review digest tier. This is a verification gate, not a new extraction pass — it produces no new requirements, only flags quality issues in existing ones.

**Confidence immutability rule:** The synthesis pass is strictly forbidden from upgrading a requirement's `confidence` label to bypass confirmation gates. Confidence is tied to source evidence types — it can only change if new `source_evidence` citations of higher priority are added. An `inferred` requirement remains `inferred` unless a test, runtime trace, or contract is discovered and cited. Relabeling without new evidence is a framework violation.

## Extraction Manifest

Every extraction run must produce a frozen source-of-truth header:

```markdown
## Extraction Manifest

- Repository: <git remote URL>
- Commit SHA: <HEAD at extraction time>
- Branch: <branch name>
- Dependency lockfile hash: <sha256 of Gemfile.lock / package-lock.json / etc>
- Database schema version: <migration version or schema hash>
- Runtime environment inspected: <production / staging / local / none>
- Test command run: <exact command>
- Test results: <passing / failing / skipped counts>
- Runtime evidence time window: <start–end dates of logs/traces inspected>
- Feature flag snapshot: <list of active flags at extraction time>
- Config source snapshot: <env file hash or config dump reference>
- Extraction date: <ISO-8601>
- Extraction agent: <model/version>
- Pass artifacts produced: <list of artifact files>
```

Without this, you cannot know whether the spec describes current production, last week's code, or a half-updated branch.

## Coverage Map

Produce per-module:

| Entrypoint | Status | Confidence Distribution | Missing Layers | Blocking Items |
|------------|--------|------------------------|----------------|----------------|
| `POST /users` | fully_specified | 3 tested, 1 observed | — | — |
| `GET /reports/:id` | partially_specified | 1 tested, 2 inferred | failure matrix | `[NEEDS CLARIFICATION]`: auth rule |
| `ProcessInvoiceJob` | unspecified | — | all | `[HUMAN DATA REQUEST]`: billing config |

**Coverage status definitions:**
- **fully_specified**: all applicable layers extracted; non-applicable layers explicitly marked `not_applicable` with evidence (per `extraction-layers.md` Coverage Map Applicability Rules); `confirmed` status; high-confidence evidence where criticality requires it; failure/ACL/transaction matrices complete or marked `not_applicable` with evidence
- **partially_specified**: some layers extracted, some `needs_clarification` or low-confidence gaps, or missing matrices without `not_applicable` justification
- **unspecified**: identified in inventory but extraction not yet attempted

## Parity Verification Recommendation

The reverse-spec skill produces specs. It does NOT verify the rewrite matches the original. However, the coordinator owns the pipeline end-to-end and should know:

After implementation, verify parity using:
- Characterization tests (from Phase 1b) run against both old and new systems
- Contract test suites generated from the failure matrix
- Shadow traffic comparison (if infrastructure supports)
- Consumer inventory regression checks (each consumer's contract still satisfied)

This is not in-scope for extraction but MUST be planned before implementation begins. Note it in the handoff to Software Architect.

## Intentional Changes Aggregation

Aggregate all requirements where `preservation_decision` is NOT `preserve` into a single artifact:

```markdown
# Intentional Changes

Behaviors the rewrite should deliberately change from the current system.

| Requirement | Current Behavior | New Desired Behavior | Decision | Criticality | Owner Approval | Tests Needed |
|---|---|---|---|---|---|---|
| REQ-billing-012 | Rounds half-up on refunds | Round half-to-even (banker's) | fix | critical | pending | characterization + new unit |
| REQ-auth-003 | Allows expired tokens for 5min | Reject immediately | fix | high | pending | integration test |
| REQ-admin-041 | CSV export includes SSN | Remove SSN column | remove | critical | pending | regression test |
```

This artifact prevents "we accidentally fixed a bug and broke a client" or "we preserved a bug we meant to remove."

## Merged Spec Output

The synthesis pass produces:
1. **merged-requirements.md** — all requirements unified, deduplicated, cross-referenced
2. **review-digest.md** — all human-attention items in one place
3. **extraction-manifest.md** — frozen source-of-truth header
4. **coverage-map.md** — per-entrypoint status table
5. **consumer-inventory.md** — all known consumers (from Pass 4)
6. **intentional-changes.md** — aggregated non-preserve decisions for explicit human review
7. **characterization-tests/** — golden fixtures and contract tests (from Pass 1b)

These seven artifacts constitute the complete extraction output handed to the Spec Agent for normalization.
