---
name: backup-strategy
version: 1.0.0
last_updated: 2026-06-03
description: Use when designing backup policies, retention schedules, restore procedures, verification, and monitoring for any durable system state.
---

# Skill: Backup Strategy

Use this to define how durable state is protected against loss. Covers what to
back up, how often, how long to retain, how to verify, and how to restore.

## When to Use

- A feature, architecture, deployment, or migration introduces or changes durable state (databases, object storage, queues, search indexes, uploaded files, secrets metadata, configuration stores)
- NFR Discovery identifies durability, retention, recoverability, or compliance requirements
- A system is moving to production or handling user data for the first time
- A post-mortem revealed inadequate backup coverage or restore gaps
- Periodic review of an existing backup strategy (at least quarterly)

## When Not to Use

- Restoring from backup during an active incident (use incident-response)
- Choosing database technology (use architecture-decisions)
- Schema migration planning (use change-management)
- High-availability failover design (use disaster-recovery-planning)
- Purely stateless prototypes with no committed persistence or recovery promise

## Rules

1. Backups are only valid if they can be restored.
2. Backup frequency and retention must derive from RPO, RTO, compliance, business criticality, and data-change rate.
3. If approved objectives are missing, apply provisional defaults and mark them as assumptions requiring approval:
   - Production: daily backup, 7 daily + 4 weekly + 3 monthly retention.
   - Staging: daily backup, 7-day retention.
   - Development: no retained backup unless it contains shared or irreplaceable data.
4. Store backups in a separate failure domain from the primary system (different region, account, or provider).
5. Encrypt backups at rest and in transit using key management separate from the primary instance.
6. Protect production backups from accidental or malicious deletion using immutability, object lock, retention lock, or equivalent controls.
7. Include schema, migration history, configuration needed for restore, and dependency ordering.
8. Do not dump plaintext secrets into backups unless an approved secrets recovery process requires it.
9. Retention must account for business recovery needs, legal retention, privacy deletion duties, and storage cost.
10. For privacy/GDPR "right to erasure" requests against immutable or long-retention backups, document the erasure strategy (cryptographic erasure, documented redaction upon restore, or retention-period-based expiry with access controls preventing casual retrieval).
11. For SaaS or vendor-managed services where direct backup is impossible, document the export API, export cadence, export validation, and vendor SLA for data recovery.
12. Any backup plan without a restore drill schedule is incomplete.

## Workflow

### 1. Inventory Durable State

List every stateful asset. Include databases, object buckets, file volumes, queues with durable messages, search indexes, generated documents, external managed services, configuration stores, and secrets metadata.

| Asset | Type | Data Classification | Owner | Change Rate |
|-------|------|-------------------|-------|-------------|

### 2. Capture Recovery Objectives

For each asset, capture or propose:
- RPO (max acceptable data loss)
- RTO (max acceptable downtime to restore)
- Retention duration (compliance, legal hold, business need)
- Restore granularity (full, point-in-time, single-object)

If objectives are missing, apply provisional defaults and route back to Software Architect or product owner for approval.

### 3. Select Backup Mechanism

| Method | Best For | RPO Range |
|--------|----------|-----------|
| Continuous WAL/binlog shipping or PITR | Low RPO databases | Seconds to minutes |
| Physical snapshots | Fast full-system restore | Hours |
| Logical dumps (pg_dump, mysqldump) | Portability, migration recovery | Hours |
| Object store versioning | User files and blobs | Per-object |
| Cross-account/region copies | Disaster isolation | Varies by source |
| Application-level exports | SaaS or vendor-managed systems | Varies |

### 4. Define Retention

Use approved requirements first. If missing, apply provisional baseline and mark as temporary. Specify short-term (daily), medium-term (weekly), and long-term (monthly/annual/legal-hold) as needed.

### 5. Define Isolation and Security Controls

- Storage location and failure-domain separation
- Encryption keys and key ownership
- Immutability / object lock settings
- Restore permissions (separate from read/write on live system)
- Access review cadence
- Audit logging for backup access

### 6. Define Restore Procedures

Document for each asset:
- Full restore sequence
- Point-in-time restore (if applicable)
- Single-object / partial restore
- Dependency ordering
- Credentials and access required
- Expected duration
- Post-restore validation checks

### 7. Define Verification

- Automated backup completion checks (not just "job ran" — verify output exists and is valid)
- Checksums or integrity verification
- Row counts or object counts where applicable
- Application-level smoke tests after restore
- Permission and ownership checks post-restore

### 8. Define Drill Cadence

- Production-critical: quarterly restore drill minimum
- Standard production: semi-annual
- Staging/dev: annual or after infrastructure changes
- CI/CD automated restore jobs (restore latest backup to ephemeral environment, run health checks, tear down)

Backup restore drills verify that data can be recovered and the application can function on restored state. They are distinct from DR failover drills (which verify traffic routing, promotion, and failback). Both may run together but serve different purposes.

Record: cadence, environment, data handling rules, pass criteria, owner, and results history.

### 9. Define Monitoring and Alerting

Alert on:
- Backup job failure or skip
- Backup age exceeding 2× expected interval
- Backup size deviating >50% from 7-day moving average (unless explained by known data event)
- Restore drill failure or overdue drill
- Replication lag exceeding RPO threshold

Dashboard: last successful backup time per asset, backup size trend, drill results.

### 10. Produce Artifact

The backup strategy artifact must include:
- State inventory
- RPO/RTO and retention requirements (approved or provisional)
- Backup mechanism per asset
- Storage location and failure-domain separation
- Encryption and immutability controls
- Restore procedure
- Verification checks
- Drill cadence and results
- Monitoring and alerting configuration
- Open assumptions and required approvals

## Usage Context

This skill is reusable across any pipeline, agent, or team. Typical usage:

- **During architecture:** Define recovery objectives and backup requirements alongside infrastructure design.
- **During infrastructure implementation:** Select mechanisms, configure retention, set up monitoring.
- **During operational readiness:** Verify restore procedures, schedule drills, confirm monitoring.
- **After incidents:** Review and update backup coverage based on post-mortem findings.

### Inputs

- Architecture decisions, data inventory, compliance requirements, infrastructure plan
- Durability/DR non-functional requirements (RPO, RTO, retention)

### Outputs

- Backup strategy artifact: state inventory, mechanisms, retention, restore procedures, verification checks, drill schedule, monitoring configuration
- Open assumptions requiring approval

### Risks if skipped

Unapproved RPO/RTO, untested restore path, same-failure-domain storage, missing schema/config backup, privacy erasure gap

### Relationship to other skills

- **Upstream:** Non-functional requirements discovery feeds RPO/RTO targets
- **Downstream:** Disaster recovery planning depends on backup readiness; incident response references backup policies during restore

## References

- Related skills: disaster-recovery-planning, incident-response, change-management, infrastructure-as-code
- Related NFR category: 6 (Durability / Disaster Recovery)
