# Requirements and Capacity

Use this reference when the system shape is still open and you need to ground the design in concrete drivers.

## Requirements Framing

Start with these categories:

- **Functional requirements**
  - core user actions
  - key entities and workflows
  - inputs, outputs, and external integrations
- **Non-functional requirements**
  - latency targets
  - availability target
  - consistency needs
  - durability needs
  - privacy/compliance constraints
- **Constraints**
  - budget
  - timeline
  - team expertise
  - existing stack or vendor constraints

Useful questions:

- How many daily or monthly active users?
- What is the read-to-write ratio?
- What is the peak load versus average load?
- Do we need real-time updates?
- Can the system tolerate stale reads?
- Can the system tolerate data loss?
- What parts must keep working during dependency failure?

## Back-of-the-Envelope Estimation

Estimate enough to choose sane architecture, not to cosplay precision.

### Traffic

```text
DAU = 100M users
Requests per user per day = 10
Average QPS = 100M * 10 / 86400 ≈ 11,574
Peak QPS ≈ 2-3x average
```

### Storage

```text
100M records * 1KB each = 100GB
3x replication = 300GB
Annual growth = daily growth * 365
```

### Bandwidth

```text
QPS * average payload size = transfer rate
```

### Cache Sizing

Use the hot-set estimate, not total dataset size. A simple starting heuristic is that a minority of records often serves most traffic.

## High-Level Topology

Default components to reason about:

1. Clients
2. Edge or CDN
3. Load balancer or API gateway
4. Application services
5. Cache
6. Primary database
7. Queue or stream
8. Background workers
9. Object storage
10. Observability stack

Example:

```text
[Clients] -> [CDN]
             |
       [Load Balancer]
             |
      [Application Tier]
       /      |       \
  [Cache]   [DB]   [Queue] -> [Workers]
                           \
                         [Object Storage]
```

## Output Checklist

- functional and non-functional requirements are separated
- scale assumptions are numeric
- peaks and growth are stated
- core components and responsibilities are named
- unknowns are called out explicitly
