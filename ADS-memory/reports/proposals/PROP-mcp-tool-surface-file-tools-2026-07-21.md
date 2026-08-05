# Proposal: a generic, host-injected file-tool primitive for `@jini/mcp` (and beyond)

**Status:** Proposal only — not implemented. Requires Coordinator/Software-Architect review before any code change. No new kernel package, port, or route was built as part of writing this document; `packages/mcp/src/**` contains no file-tool code.

**Finding:** `packages/mcp/source-map.md`'s `## 2026-07-21 (second pass)` section, written while auditing OD's 13 excluded MCP tools for a genuine kernel equivalent (task: port OD's `apps/daemon/src/mcp.ts` stdio MCP tool surface onto Jini's kernel primitives).

**Do not implement from this document without a follow-up decision.** This is a design question, not a spec.

## The problem

Six of OD's 18 original MCP tools — `get_file`, `list_files`, `search_files`, `write_file`, `delete_file`, `get_artifact` — are, on their face, generic file operations: "read a file at a path," "list files," "write a file," "search file contents," "bundle an entry file plus its referenced siblings." None of them name a product noun (`Project`/`DesignSystem`/`Skill`/`Plugin`) the way the other 7 excluded tools do (`list_projects`, `get_project`, `delete_project`, `create_project`, `list_skills`, `list_plugins`, `create_artifact` — all unambiguously excluded, see the source-map's verdict table). A future Jini consumer building an agentic coding tool, a docs generator, or anything that manipulates files on disk will very plausibly want exactly this kind of tool surface — it is one of the most common tool shapes in the entire agent-tooling ecosystem (compare Claude Code's own `Read`/`Write`/`Edit`/`Grep` tools).

But today, every one of these six OD tools resolves "which files" against a `Project` — a daemon-managed, database-backed, named/UUID'd entity with its own on-disk directory, resolvable by substring match against a live project list (`resolveProjectArg`/`resolveProjectId` in `mcp.ts`, lines 1406-1466). That resolution mechanism is 100% OD product surface. Stripped of it, none of these six tools have anywhere to point.

## What already exists in the kernel (checked, not assumed)

This proposal is not "build this from nothing" — a survey of the current codebase found one genuinely relevant, already-built primitive and two near-misses that turned out not to help:

1. **`@jini/platform`'s `BlobStorage`** (`packages/platform/src/blob-storage.ts`) — a real, tested, product-neutral port: `readFile`/`writeFile`/`listFiles`/`deleteFile`/`statFile`, keyed by an opaque `namespace` string plus a `relpath`, with a traversal guard (`LocalBlobStorage.resolvePath` rejects `..`/absolute-looking `namespace`/`relpath` segments) and both a local-disk (`LocalBlobStorage`) and S3-compatible (`S3BlobStorage`) implementation. Its own module doc is explicit that `namespace` "carries no domain meaning... a tenant id, a workspace id, a project id, whatever the host application scopes storage by." This is the right *shape* for a file-tool foundation. But:
   - It has exactly one consumer today, `packages/capability-providers/src/storage.ts`, and `@jini/capability-providers`'s own source-map describes the whole package as "greenfield, no OD source... built speculatively per an explicit human decision with no current consumer."
   - No `@jini/http` route exposes it. No `@jini/core` `ToolRegistry` entry wraps it. No daemon composition wires a `namespace` to anything a request could supply.
   - In short: the storage *primitive* exists; the *tool* — something an MCP client, an HTTP route, or a `ToolExecutor.execute()` call could actually invoke — does not.
2. **`@jini/core`'s `ToolRegistry`/`ToolExecutor`** (`packages/core/src/tool-registry.ts`, `packages/daemon/src/tool-executor.ts`) — the kernel's real, general tool-execution boundary (extraction-plan.md §2.5): `{descriptor, handler, policy}` triples, `ToolExecutor.execute(principal, run, tool, input, signal)`, deny-by-default via `ToolPolicy.authorize`. This is *exactly* the mechanism a generic file-read/write tool should be registered through — but it is empty. No product in this repo registers any tool into it yet, file-shaped or otherwise. Using it for file tools is straightforward once the storage question below is answered; it does not itself resolve the storage question.
3. **`@jini/registry`/`@jini/memory`** — checked as possible existing "content" abstractions a file tool could ride on. Neither fits: `@jini/registry`'s `RegistryEntry` is versioned publishable content (npm-package-shaped), not an arbitrary file tree; `@jini/memory`'s note-store is an AI-fact-extraction log, not general file storage. Both are also unwired to any route/tool surface today, same as `BlobStorage`.

## Why this is a design decision, not a mechanical port

Building "MCP tools `get_file`/`list_files`/`write_file`/`delete_file`/`search_files`/`get_artifact`, backed by `BlobStorage`" sounds mechanical, but it requires answering several questions this task's author has no standing to decide unilaterally:

1. **What does "workspace root" mean at the kernel level?** A single fixed directory per daemon process (matching how e.g. an editor extension scopes to one open folder)? Multiple named roots (closer to OD's multi-project model, but then we're most of the way back to inventing a `Project`-shaped noun under a different name — the exact trap the task brief warned against)? Something keyed off `contextRef` (the kernel's existing opaque run-scoping identity, already used by `start_run`/`get_run`)?
2. **Where does the root get injected?** `@jini/node-host`'s `createLocalNodeDaemon` composition? A new required binding token (`RunStore`/`EventLog`-style, per extraction-plan.md §2.2)? An MCP-server-construction-time option, orthogonal to the daemon entirely (i.e. `@jini/mcp` itself takes a `workspaceRoot` and never touches the daemon/HTTP layer for file ops)? Each has different security and multi-tenancy implications.
3. **Security model.** `BlobStorage`'s traversal guard handles path escape within one `namespace`, but nothing today enforces *which* namespaces a given MCP session/principal may address, size/count limits on `list_files`/`get_artifact` (OD's own version caps at 200 files / 1.5MB, `mcp.ts` lines 1553-1555 — deliberate product policy this proposal does not assume should carry over verbatim), or whether a write/delete tool needs `ToolDescriptor.requiresConfirmation`/a `ToolPolicy` deny-by-default posture (the task brief's own instruction: "deny-by-default where authorization matters" — file writes are exactly where it would).
4. **Is this an `@jini/mcp`-local concern or a kernel-wide one?** A generic file-tool primitive registered in `ToolRegistry` would be usable by *any* transport (HTTP route, CLI command, agent tool call), not just MCP — which argues for building it once at the `@jini/core`/`@jini/daemon` layer rather than bespoke inside `@jini/mcp`. That's a bigger scope than "port OD's MCP tool surface" and deserves its own spec.

Any one of these picked ad hoc risks becoming exactly the failure mode `ADS-memory/reports/jini-port/extraction-plan.md` §7 and this repo's own architecture-review process exist to prevent: a kernel-adjacent decision made by whichever task happened to touch it first, rather than reviewed as a kernel-wide contract.

## What this proposal recommends (for architect review, not a decision)

1. Treat this as its own spec-worthy unit of work — "a generic file-tool capability for the Jini kernel" — separate from any single transport (MCP, HTTP, CLI). `@jini/mcp`'s eventual `get_file`/`list_files`/etc. tools would then be a thin proxy layer over that capability, exactly matching how `run-tools.ts`'s existing 5 tools proxy `@jini/http`'s already-decided `runs.ts`/`active-context.ts`/`agents.ts` routes rather than making their own policy calls.
2. If approved, `@jini/platform`'s `BlobStorage` is a reasonable storage-layer starting point (it already has the right shape and is already tested) — but the *addressing* model (item 1 above) needs an explicit decision before any `namespace` value is chosen at a call site.
3. Whatever shape is chosen, register it through `@jini/core`'s `ToolRegistry`/`ToolExecutor` (not a bespoke `@jini/mcp`-internal authorization mechanism) so HTTP/CLI/agent callers get the identical policy enforcement an MCP caller would — consistent with extraction-plan.md §2.3's "packs own app-services; kernel owns orchestration only."

## Open questions for the architect

1. Single-root-per-process vs. multi-root vs. `contextRef`-scoped addressing — which matches the kernel's actual multi-tenancy story (if any is planned) for a headless daemon?
2. Does this belong in `@jini/core`/`@jini/daemon` (a new kernel-wide tool capability) or scoped narrower (e.g. `@jini/node-host`-only, opt-in per composition)?
3. Should size/count caps (OD's 200-file/1.5MB `get_artifact` bundle limits) be a kernel-level default, a per-binding configuration, or left to each tool's own policy?
4. Confirm `ToolDescriptor.requiresConfirmation` is the right mechanism for gating `write_file`/`delete_file`-shaped tools, or whether file-write tools need a stronger default posture than what `requiresConfirmation` currently provides.
