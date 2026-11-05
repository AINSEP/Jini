# Proposed persona additions — DRAFT ONLY

For tomorrow's installation in the source AI-Dev-Shop repo, followed by its normal sync. No persona or registry has been edited. Add the following under Base Skills in each of `agents/programmer/skills.md`, `agents/software-architect/skills.md`, and `agents/code-inspection/skills.md`:

```markdown
- `<AI_DEV_SHOP_ROOT>/skills/memory-performance-discipline/SKILL.md` — recurring work, payload/retention bounds, timer ownership, physical query cost and evidence for resource budgets; apply to relevant changed paths.
```

Add the corresponding line under each persona's existing Output Format (Code Inspection: Report contents). Repeat per materially affected path; use `Cost: N/A — <reason>` when none applies. Status describes cost evidence, not an overall quality verdict.

## Programmer

```markdown
- Cost: <path>; <trigger/rate> × <payload/copies or I/O> × <concurrency>; retained <bound + overflow/cleanup policy>; fallback <remaining full work>; tradeoff <durability/latency>; <ESTIMATED|MEASURED|UNVERIFIED + evidence/budget result>; next <check or none>.
```

## Software Architect

```markdown
- Cost: <path + owner>; <design rate × worst supported size × concurrency>; retained <capacity/lifetime + loss policy>; budget <metric/units/limit + source or proposed>; tradeoff <recovery window/latency/isolation>; validation <production workload + acceptance criteria>; <ESTIMATED|MEASURED|UNVERIFIED + evidence>.
```

## Code Inspection

```markdown
- Cost: <path:line>; verified <trigger/rate × actual reads/copies/writes × consumers>; retained <bound + teardown>; checked <query plan/cache fallback/timer races as applicable>; <ESTIMATED|MEASURED|UNVERIFIED + evidence/budget result>; findings <existing disposition + reference or none>; next <missing evidence or none>.
```
