# Architecture Spec Template

Use this when turning a system-design discussion into a formal architecture document.

```md
# Technical Architecture: [System Name]

**Version**: 1.0.0
**Last Updated**: [Date]
**Status**: Draft / In Review / Approved
**Owner**: [Architect / Team]
**Scope**: [Bounded context or product area]

---

## 1. Architecture Overview

### 1.1 Selected Pattern
- Selected pattern:
- Alternatives considered:
- Why this pattern fits the actual system drivers:

### 1.2 High-Level Topology
- Core components:
- Data stores:
- Messaging or async boundaries:
- External dependencies:

### 1.3 Key Decisions
| Decision | Choice | Alternative Considered | Rationale |
|---|---|---|---|

## 2. Requirements and Constraints

### 2.1 Functional Requirements
- [List]

### 2.2 Non-Functional Requirements
- latency
- availability
- consistency
- durability
- privacy/compliance

### 2.3 Constraints
- budget
- timeline
- team expertise
- mandated vendors or stack constraints

## 3. Capacity and Scale Assumptions

- users
- QPS / throughput
- storage growth
- bandwidth
- peak behavior

## 4. Domain Boundaries and Module Breakdown

- bounded contexts
- ownership lines
- public interfaces between modules/services
- internal vs external contracts

## 5. Data Flow and State Flow

- request path
- async path
- background processing path
- failure and retry paths

## 6. Technology Choices

### 6.1 Runtime / Frameworks
- [List]

### 6.2 Data and Messaging
- primary database
- cache
- queue or stream
- object/blob storage

### 6.3 Third-Party Dependencies
- dependency
- why needed
- alternative considered
- operational/security implications

## 7. Security and Compliance

- authn/authz
- secret handling
- encryption
- auditability
- privacy/compliance constraints

## 8. Performance and Reliability

- scaling strategy
- replication/failover
- rate limiting
- backpressure
- SLO/SLA assumptions

## 9. Testing and Verification Strategy

- unit/integration/E2E focus
- contract tests
- load or resilience testing
- rollout verification

## 10. Deployment and Operations

- environments
- CI/CD expectations
- observability
- on-call/incident implications

## 11. Risks and Mitigations

| Risk | Impact | Probability | Mitigation | Fallback |
|---|---|---|---|---|

## 12. Future Breakpoints

- what breaks first at 10x scale
- likely future extractions or redesigns
- deferred complexity
```

## Quality Bar

- Every decision should tie back to a requirement, constraint, or risk.
- Unknowns should be labeled explicitly.
- If the document is platform-specific, keep generic system-design sections intact and move platform specifics into dedicated subsections.
