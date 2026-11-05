# Planning and architecture

1. Restate the requested behavior and acceptance criteria. Separate observed facts from assumptions. Resolve only ambiguity that changes correctness, permissions, data loss or an irreversible action; continue independent safe work while clarification is pending.
2. Inspect the current owner, callers, contracts and relevant architecture decisions. Reuse the established extension point and local style. Search before creating a second owner or parallel execution path.
3. Choose the smallest reversible slice. Compare alternatives only where a real boundary or tradeoff needs a decision. Record the chosen owner, dependency direction, observable contract, important failure modes and why this choice meets the requirement. Avoid imposing a new architectural pattern on an existing system.
4. Keep reusable decisions independent of products, transports and vendors. Put I/O in adapters behind explicit dependencies; keep host-specific wiring in the host. Do not introduce a container, framework, schema table or configuration option just to organize a small change.
5. Define invariants and compatibility: input/output shapes, authorization, ordering, idempotency, cancellation, retry and partial-failure behavior where relevant. Identify concrete evidence that could disprove the design. Do not add speculative recovery branches.
6. For persisted data, use the repository's registered migration mechanism. Plan backward compatibility, bounded backfills, lock impact and a recoverable rollout. Never edit an already-applied migration or assume a destructive rollback restores data.
7. State resource costs as frequency × payload for added reads, writes and polls, including fan-out and worst-case collection sizes. Prefer no new timer or background scan. Measure a performance claim when it matters.
8. Give implementation an explicit file/owner map and a short verification plan. Record only decisions that help the next maintainer; no mandatory spec package, council, approval pipeline or report hierarchy.

For UI work, discover the host's design capability before choosing visual direction. Preserve the chosen stack's native composition and state ownership. Keep URL, client and server state distinct; define cleanup, races and invalidation where the change touches them.
