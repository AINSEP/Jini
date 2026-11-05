# Category Deepening Prompts

Load this file only during a deep pass. Jump to the relevant category headings
when practical. Prompts are intentionally generic and solution-free.

For each triggered category, collect only what is needed to produce the deep
record: requirement/target, assumption, measurement/evidence, risk if missed,
priority, unknown class, and downstream owner.

## Scale / Capacity

- What usage, data volume, or concurrency level materially changes the design?
- Which operations grow with user count, record count, or request volume?
- Is growth steady, bursty, seasonal, tenant-specific, or unknown?

## Performance / Latency

- Which user-visible or system-to-system paths have response-time sensitivity?
- Are targets hard requirements, soft expectations, or unknown assumptions?
- Which operations must remain fast as data or traffic grows?

## Availability / Uptime

- Which workflows must remain available for the product to be useful?
- What outage duration, maintenance window, or availability level is acceptable?
- Which dependencies can make the user-facing experience unavailable?

## Reliability / Fault Tolerance

- Which component failures must be tolerated without losing critical work?
- What should happen when dependencies are slow, unavailable, or inconsistent?
- Which operations require retries, fallback behavior, or manual recovery paths?

## Consistency / Freshness

- Which reads must reflect recent writes immediately, and which can lag?
- Where would stale, duplicated, or out-of-order data create user or business harm?
- Are conflicts possible across users, devices, tenants, integrations, or jobs?

## Durability / Disaster Recovery

- What data or user work must never be lost after acknowledgement?
- What recovery point and recovery time expectations are known or assumed?
- Are retention, restore, deletion, or archival behaviors material to the system?

## Security

- What identities, permissions, secrets, or trust boundaries matter?
- Which actions or data access paths require authorization decisions?
- What misuse, abuse, or privilege escalation would be material?

## Privacy

- What personal, sensitive, private, or tenant-confidential data is handled?
- Who is allowed to view, export, retain, delete, or share that data?
- Are consent, minimization, redaction, or data-subject workflows relevant?

## Data Integrity

- Which invariants, constraints, uniqueness rules, or transactional guarantees matter?
- Where would partial, duplicated, invalid, or conflicting writes create harm?
- Are idempotency, deduplication, ordering, or reconciliation requirements known?

## Compliance / Auditability

- What laws, standards, contracts, or internal policies affect the system?
- Which decisions, changes, approvals, or actions must be traceable?
- Who needs evidence, reports, retention, or review history?

## Observability

- What signals are needed to know whether the system is healthy?
- Which user journeys, dependencies, jobs, or data flows need operational visibility?
- What failures must be alertable, diagnosable, or reportable?

## Operability / Deployability

- What deployment, rollback, migration, configuration, or runbook expectations exist?
- Who operates the system, and what manual controls or support paths are needed?
- Which changes must be safe to release incrementally?

## Maintainability / Evolvability

- Which areas are expected to change frequently or support multiple variants?
- What ownership, modularity, or documentation expectations matter?
- What complexity would make future changes risky or slow?

## Cost / Resource Efficiency

- Are there hard budget, unit-cost, or resource-efficiency expectations?
- Which workloads could grow cost with usage, storage, compute, traffic, or providers?
- Is cost predictability, ceiling control, or efficiency more important than flexibility?

## Interoperability / External Integrations

- Which external systems must this system call, expose to, import from, or export to?
- What availability, contract, versioning, retry, or data-shape assumptions exist?
- Which integration failures must be visible, recoverable, or compensated?

## Portability / Environment Constraints

- Are there constraints on hosting, runtime, devices, browsers, regions, networks, or deployment environments?
- Must the system run offline, on-premises, at the edge, in multiple regions, or under restricted connectivity?
- Which environment assumptions would be expensive to reverse later?

## Usability / Accessibility

- Which users, devices, assistive technologies, languages, or contexts must be supported?
- Are there accessibility, localization, or workflow-efficiency expectations?
- Which usability failures would block adoption or critical task completion?

## Testability / Verifiability

- Which NFRs must be proven by automated tests, checks, simulations, or operational evidence?
- Are success criteria observable enough for QA/E2E, TestRunner, or monitoring to verify?
- Which claims are currently too vague to validate responsibly?
