# Enterprise Spec Reference: Work Management and Approvals

## Requirement-to-Work-Item Mapping

When enterprise work tracking is in scope, every `REQ-*` maps to a work item in `work-items.md`.

```markdown
# Work Items

| REQ-ID | Work Item ID | System | URL | Status | Owner |
|--------|--------------|--------|-----|--------|-------|
| REQ-01 | PROJ-1423    | Jira   | https://jira.example.com/browse/PROJ-1423 | In Progress | @alice |
| REQ-02 | PROJ-1424    | Jira   | https://jira.example.com/browse/PROJ-1424 | To Do | @bob |
| REQ-03 | GH-892       | GitHub Issues | https://github.com/org/repo/issues/892 | Open | @carol |
```

Rules:

- missing mapping is blocking
- multiple REQ IDs may share a work item only when delivery is inseparable
- newly discovered scope or defects must produce explicit work-item changes

## Pipeline-to-Status Synchronization

| Pipeline Transition | Work Item Status |
|---|---|
| Spec approved | In Progress |
| TDD complete | In Review |
| Implementation complete | Done |
| Bug routed back | Reopened |
| Spec rejected | Blocked |

If tooling integration exists, the Coordinator should read-before-write and log transitions.

If tooling integration does not exist, emit a required transition block:

```text
WORK ITEM TRANSITIONS REQUIRED:
  PROJ-1423 -> In Progress
  PROJ-1424 -> In Progress
```

## Approval Gate Table

| Phase Transition | Required Approvers | Blocking Effect |
|---|---|---|
| Discover -> Spec | Product Manager and Tech Lead | Spec dispatch blocked |
| Spec -> Design | Software Architect and Security Lead | Software Architect dispatch blocked |
| Design -> Tasks | Engineering Lead | TDD dispatch blocked |
| Tasks -> Implementation | Tech Lead | Programmer dispatch blocked |
| Implementation -> Review | QA Lead | Review dispatch blocked |
| Review -> Ship | Security Lead and Engineering Manager | Ship blocked |

## approvals.md

```markdown
# Approvals

| Phase | Role | Approver | Date | Decision | Notes |
|-------|------|----------|------|----------|-------|
| Discover -> Spec | Product Manager | Jane Doe | 2026-02-18 | Approved | |
| Discover -> Spec | Tech Lead | Ali Hassan | 2026-02-18 | Approved | |
| Spec -> Design | Software Architect | Marco Ricci | 2026-02-20 | Needs Revision | ADR missing |
| Spec -> Design | Security Lead | Priya Singh | 2026-02-21 | Approved | |
```

Rules:

- rejection reasons must be preserved
- approval history is append-only
- approved rows are immutable
- the Coordinator halts until all required roles are present and approved
