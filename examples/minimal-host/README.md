# examples/minimal-host

The **neutrality proof + CI gate**. It imports **only** `@jini-ai/*`, boots
`createLocalNodeDaemon` with no product packs, and drives a real HTTP lifecycle
scenario: create, SSE stream, reconnect with a cursor, cancel, process restart,
and durable replay. It also launches a portable Node-based ACP fixture through
the real `AgentExecutor`, including the injected permission decision; no vendor
CLI or account is needed. Its host-owned drivers are deliberately tiny and
generic — no project, design, artifact, or product concepts.

The engine-boundary lint forbids this package from importing `foundry/**`, `@open-design/*`, or `next/*`. The release-set matrix boots this from **packed tarballs** (no workspace links) as a required check. If a kernel change can't be satisfied here without inventing a product concept, the change is rejected. See the extraction plan §7 + §12.
