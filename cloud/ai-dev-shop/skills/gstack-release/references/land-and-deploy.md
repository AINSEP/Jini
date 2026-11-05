# Land and Deploy

## When

Use after a branch or PR appears ready and the user wants merge, deploy, and post-deploy verification guidance.

## Workflow

1. Confirm merge target, PR/review status, CI status, deployment target, and rollback path.
2. Check for blockers: failing checks, unresolved review, security findings, migration risk, or version drift.
3. Preview the merge/deploy plan and the exact commands or platform actions required.
4. Ask for explicit approval before merge or deploy.
5. After approved deployment, verify health endpoint, key URL, logs or CI/deploy status, and user-critical smoke path.
6. Report stable, unstable, or blocked with evidence.

## Output

- Pre-merge readiness
- Deploy plan and gates
- Verification evidence
- Rollback recommendation if unstable

## Guardrails

- CRITICAL: You MUST STOP and request explicit user confirmation before executing any commands that merge branches, push commits, delete branches, or trigger external deployments. Do not proceed until the user says "yes" or "approved".
- Do not deploy around failed checks or unresolved high-risk findings.
- Do not trigger rollback automatically; recommend and wait for approval.
