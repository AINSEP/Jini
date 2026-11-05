---
name: disaster-recovery-planning
version: 1.0.0
last_updated: 2026-06-03
description: Use when designing proactive disaster recovery strategy — RTO/RPO targets, failover architecture, failback procedures, and DR drill planning.
---

# Skill: Disaster Recovery Planning

Use this to define how a system survives and recovers from major failure
scenarios while meeting business recovery objectives. This is proactive
architectural planning — not active incident handling.

## When to Use

- NFR Discovery identifies RTO, RPO, failover, regional resilience, or disaster recovery requirements
- Designing or changing production architecture for a business-critical system
- Planning multi-region or multi-cloud deployments
- Before production launch for any system with uptime commitments
- After an incident where recovery objectives were missed or unclear
- Compliance requires documented DR plans (SOC2, ISO 27001, FedRAMP)

## When Not to Use

- During an active incident (use incident-response for immediate recovery)
- Implementing data backups (use backup-strategy for retention and restore)
- Choosing deployment strategy (use devops-delivery)
- Applications with no significant business continuity requirements

## Rules

1. Start with business impact, not infrastructure preference.
2. RTO and RPO must be defined per business capability, not only per application or service.
3. RPO cannot be lower than the actual data protection mechanism supports. Verify against backup frequency, replication lag, queue durability, and export cadence.
4. RTO cannot be lower than the tested recovery procedure supports. Untested estimates must be labeled as ASSUMPTIONS.
5. Multi-region or multi-writer designs must explicitly prevent split-brain. Define conflict handling, write ownership, idempotency, and consistency expectations.
6. DR planning must include data corruption and bad deployment recovery, not only infrastructure outages.
7. Incident Response may execute the DR plan, but Software Architect owns the plan design.
8. A DR plan without drills is incomplete.
9. Automated failover must include guardrails, health criteria, rollback conditions, and alerting.
10. Manual failover is acceptable only when the RTO allows it and the runbook is clear enough for an on-call operator to execute under stress.

## Required Failure Scenarios

Evaluate at minimum:

| Scenario | Example |
|----------|---------|
| Single instance failure | App server crash, disk failure |
| Availability zone failure | Zone networking or power loss |
| Region failure | Full regional provider outage |
| Data corruption | Silent data loss, dropped tables, bad migration |
| Bad deployment | Destructive code or config change |
| Provider service outage | Managed DB, auth provider, CDN unavailable |
| Credential or secret loss | Key rotation failure, compromised credentials |
| Operator error | Accidental deletion, misconfiguration |
| Dependency outage | Third-party API, payment processor down |
| Security event | Breach requiring isolation, rebuild, or credential rotation |

## Strategy Selection

Use the lowest-cost pattern that meets approved RTO/RPO:

| Pattern | Typical Use | Tradeoff | Approx. Cost vs Single-Region |
|---------|-------------|----------|-------------------------------|
| Backup/Restore | Low-criticality, long RTO acceptable | Lowest cost, slowest recovery | ~1.1x (storage only) |
| Pilot Light | Core data replicated, minimal standby compute | Moderate cost, faster than backup/restore | ~1.2-1.3x |
| Warm Standby | Important production systems | Faster recovery, ongoing cost | ~1.3-1.5x |
| Active-Passive | High-criticality, low RTO required | Fast failover, operational complexity | ~1.5-1.8x |
| Active-Active | Highest availability, near-zero RTO | Highest cost, split-brain complexity | ~2x+ |

### Provisional Tiers (when NFRs are missing)

If approved RTO/RPO targets do not exist, propose provisional tiers and mark them as assumptions requiring owner approval:

| Tier | Example Systems | Provisional RTO | Provisional RPO |
|------|----------------|-----------------|-----------------|
| Gold | Revenue-critical, payment, auth | < 15 minutes | < 5 minutes |
| Silver | Core product API, user-facing workflows | < 1 hour | < 15 minutes |
| Bronze | Internal tools, batch reporting, analytics | < 24 hours | < 24 hours |

## Workflow

### 1. Define Business Impact

Identify critical user journeys, internal operations, contractual commitments, compliance duties, revenue impact, safety implications, and maximum tolerable downtime.

### 2. Map Dependencies

Identify all components required for recovery: services, databases, object stores, queues, identity providers, DNS, CDN, payment processors, secrets systems, observability, CI/CD, and external vendors.

Pay special attention to:
- **Secrets and certificates:** Regional key management (KMS) may be unavailable during regional failure. Plan cross-region secret replication or multi-region key access.
- **DNS TTLs:** Propagation time directly affects actual RTO. Pre-lower TTLs before planned drills; document expected propagation delay for unplanned failover.

### 3. Set Recovery Objectives

Produce an RTO/RPO matrix by business capability. Include owner approval status for each target.

### 4. Evaluate Failure Scenarios

Walk through each required scenario. For each, document: detection method, blast radius, recovery mechanism, expected recovery time, and data loss exposure.

### 5. Select DR Pattern

Choose per component or business workflow. Document rationale against RTO/RPO and cost.

### 6. Design Failover

- Disaster declaration authority (who can authorize failover — on-call engineer, engineering lead, or automated system)
- Trigger conditions (automated health checks, manual declaration, or both)
- DNS, load balancer, service mesh, and CDN behavior (including expected propagation time given current TTLs)
- Database promotion or replication cutover
- Queue and cache behavior during transition
- Data consistency expectations and acceptable staleness window

### 7. Design Failback

- Conditions for returning to primary
- Data reconciliation (what was written to DR during outage)
- Replication reversal
- Stale data and cache invalidation
- Verification before traffic return
- Rollback criteria if failback fails

### 8. Define Split-Brain Prevention (multi-writer systems)

- Write ownership and fencing
- Conflict detection and resolution strategy
- Idempotency requirements
- Consistency guarantees during partition

### 9. Define DR Drills

| Tier | Drill Type | Cadence |
|------|-----------|---------|
| Gold | Full failover | Quarterly |
| Gold | Table-top | Monthly |
| Silver | Full failover | Semi-annual |
| Silver | Table-top | Quarterly |
| Bronze | Full failover | Annual |
| Bronze | Table-top | After major architecture changes |

For each drill, define: scope, participants, pre-checks, execution steps, abort criteria, evidence to capture, expected vs actual RTO/RPO, and follow-up actions.

### 10. Define Observability

Monitor and alert on:
- Replication lag vs RPO threshold
- Backup freshness (from backup-strategy)
- Regional health and availability
- Dependency status
- Failover readiness (can we fail over right now?)
- DR drill status and results

### 11. Produce Artifact

Create or update a DR plan document containing:
- Business impact summary
- Critical workflows and their tier
- RTO/RPO table (approved or provisional with assumption labels)
- Dependency map
- Failure scenario analysis
- Selected DR pattern per component with rationale
- Failover procedure (step-by-step)
- Failback procedure (step-by-step)
- Split-brain prevention (if applicable)
- Drill schedule and results history
- Monitoring and alerting configuration
- Open risks and untested assumptions
- Communication plan (who to notify during failover)

## Usage Context

This skill is reusable across any pipeline, agent, or team. Typical usage:

- **During architecture:** Select DR pattern, define failover/failback, set recovery objectives.
- **During infrastructure implementation:** Build DR infra, configure replication, set up failover automation.
- **During operational readiness:** Execute drills, validate RTO/RPO, confirm monitoring.
- **After incidents:** Update DR plan based on actual recovery performance and gaps discovered.

### Inputs

- Architecture decisions, backup strategy, infrastructure topology, dependency map
- Durability/DR non-functional requirements (RTO, RPO, availability targets)

### Outputs

- DR plan: recovery objectives, failure scenario analysis, failover/failback procedures, drill schedule, observability requirements
- Open risks and untested assumptions

### Risks if skipped

Unapproved RTO/RPO, untested failover path, missing failback, secrets unavailable in DR region, DNS propagation exceeding RTO, split-brain in multi-writer

### Relationship to other skills

- **Upstream:** Non-functional requirements discovery feeds tier classification and RTO/RPO
- **Downstream:** Infrastructure-as-code implements DR resources; incident response executes the DR plan during actual events; backup-strategy provides the data protection that DR depends on

## References

- Related skills: backup-strategy, incident-response, infrastructure-as-code, change-management
- Related NFR category: 6 (Durability / Disaster Recovery)
