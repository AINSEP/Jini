# Distributed Systems Patterns

Use this reference when evaluating the main system choices after requirements and scale are clear.

## Storage Choices

### SQL

Prefer SQL when you need:

- transactions
- relational integrity
- structured queries
- clear ownership and consistency

Examples: PostgreSQL, MySQL

### NoSQL

Prefer NoSQL when you need:

- very large horizontal scale
- flexible schema
- very high write throughput
- access patterns that do not fit relational modeling cleanly

Examples: DynamoDB, Cassandra, MongoDB

## Sharding Strategies

- **Hash-based**: even distribution, harder range scans
- **Range-based**: efficient ordered scans, hotspot risk
- **Geographic**: good for locality and data residency
- **Consistent hashing**: useful when nodes change frequently

## Cache Patterns

- **Cache-aside**: simplest default
- **Write-through**: stronger cache freshness, more write cost
- **Write-behind**: higher throughput, more durability complexity

Eviction strategies:

- LRU
- LFU
- TTL

## Messaging Patterns

- **Work queue**: background job distribution
- **Pub/Sub**: one event, many downstream consumers
- **Fan-out**: one ingress path to multiple queues or topics

Use queues when latency can be decoupled from the user request. Do not add them if synchronous flow is simple and good enough.

## Scaling Patterns

### Horizontal Scaling

- stateless app servers
- load balancing
- externalized sessions
- elastic worker pools

### Vertical Scaling

- simpler operationally
- faster to ship early
- limited ceiling

## Reliability Patterns

- replication
- active-passive or active-active failover
- circuit breakers
- retries with bounded backoff
- rate limiting
- graceful degradation

## Tradeoff Areas

- consistency vs availability
- latency vs correctness guarantees
- cost vs multi-region resilience
- modular monolith vs microservices
- simplicity now vs flexibility later

## Common Mistakes

- jumping to the solution before clarifying requirements
- over-engineering simple workloads
- underestimating hotspots and failure modes
- forgetting observability
- ignoring security-sensitive flows
- treating scale as a vibe instead of a number
