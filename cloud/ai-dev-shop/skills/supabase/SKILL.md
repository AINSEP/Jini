---
name: supabase
version: 1.1.3
last_updated: 2026-04-10
description: Use when implementing Supabase-specific features including Row Level Security, PostgREST API conventions, realtime subscriptions, storage buckets, edge functions, auth integration, and typed client setup.
---

# Skill: Supabase

Supabase is PostgreSQL plus platform services: PostgREST, realtime, storage, edge functions, and auth.

The core rule is simple: **RLS is the security layer for almost everything.** If RLS is wrong, database queries, PostgREST requests, realtime subscriptions, and storage behavior will be wrong, often silently.

This skill owns runtime verification when a live Supabase project exists. Design-time scalability checks for schema and general PostgreSQL behavior stay in `sql-data-modeling` and `postgresql`.

Current provider boundary:

- AI Dev Shop capability name: `supabase_mcp`
- Current provider mapping: a configured `supabase` MCP server on the current host
- Ownership split: the client installs the MCP server; the repo detects and uses it when present

Keep this file lean. Read it for the operational contract, then load only the reference files needed for the task at hand.

## Version Notes

- `1.1.3` adds explicit MCP capability preflight so live verification runs only when both generic MCP support and a configured `supabase` MCP server are proven on the current host.
- `1.1.2` makes the runtime-verification boundary explicit and adds a live-project performance gate for query-layer work.
- `1.1.1` backfills deeper reference coverage for multi-tenant policy patterns, policy debugging, RPC conventions, and edge-function auth context.
- `1.1.0` converted the old monolithic skill into a map-plus-references structure so agents can load platform depth selectively instead of carrying every Supabase topic at once.

## Core Model

```text
Postgres schema + policies
        |
        +--> PostgREST / RPC
        +--> Realtime
        +--> Storage policies
        +--> Auth-linked access
        +--> Edge Functions using caller or service context
```

Platform rules:

1. Browser clients use the public URL plus anon key and must respect RLS.
2. `service_role` bypasses RLS and must never reach browser code.
3. Realtime visibility depends on the table's `SELECT` policy.
4. Storage access depends on `storage.objects` policies, not just bucket visibility.
5. `SECURITY DEFINER` functions can bypass RLS and therefore require explicit authorization checks.

## Load Strategy

Start here, then load only the reference you need:

- `references/rls-and-policies.md` for table policies, ownership rules, and RLS testing
- `references/postgrest-and-rpc.md` for REST exposure, views, functions, filtering, and RPC behavior
- `references/client-and-types.md` for client initialization, env vars, type generation, and typed querying
- `references/realtime-and-storage.md` for publications, subscriptions, presence, buckets, and storage policies
- `references/edge-functions-and-auth.md` for edge functions, secrets, `auth.users`, profiles, and custom claims
- `references/performance-and-gotchas.md` for indexing, pagination, planning, and silent-failure traps

## Upstream References (Progressive Disclosure)

When the task requires depth beyond what this skill's own references provide, load selectively from the official Supabase agent-skills (installed in `<AI_DEV_SHOP_ROOT>/skills/` — never hand-edit those directories):

**Supabase CLI, migrations, and operational safety:**
- `<AI_DEV_SHOP_ROOT>/skills/supabase-upstream/SKILL.md` for CLI workflow (`supabase migration new`, `db pull`, `db advisors`), MCP server troubleshooting, security checklist (BOLA/IDOR, views-bypass-RLS, `auth.role()` deprecation, JWT freshness), and changelog verification

**Postgres performance and operations (load by concern):**
- `<AI_DEV_SHOP_ROOT>/skills/supabase-postgres-best-practices/references/conn-pooling.md` — connection pooler configuration
- `<AI_DEV_SHOP_ROOT>/skills/supabase-postgres-best-practices/references/conn-limits.md` — connection limit tuning
- `<AI_DEV_SHOP_ROOT>/skills/supabase-postgres-best-practices/references/conn-idle-timeout.md` — idle connection timeout
- `<AI_DEV_SHOP_ROOT>/skills/supabase-postgres-best-practices/references/conn-prepared-statements.md` — prepared statement behavior with poolers
- `<AI_DEV_SHOP_ROOT>/skills/supabase-postgres-best-practices/references/monitor-pg-stat-statements.md` — query statistics monitoring
- `<AI_DEV_SHOP_ROOT>/skills/supabase-postgres-best-practices/references/monitor-vacuum-analyze.md` — vacuum and analyze tuning
- `<AI_DEV_SHOP_ROOT>/skills/supabase-postgres-best-practices/references/lock-deadlock-prevention.md` — deadlock prevention patterns
- `<AI_DEV_SHOP_ROOT>/skills/supabase-postgres-best-practices/references/lock-skip-locked.md` — skip-locked queue pattern
- `<AI_DEV_SHOP_ROOT>/skills/supabase-postgres-best-practices/references/data-n-plus-one.md` — N+1 query detection
- `<AI_DEV_SHOP_ROOT>/skills/supabase-postgres-best-practices/references/data-batch-inserts.md` — batch insert patterns
- `<AI_DEV_SHOP_ROOT>/skills/supabase-postgres-best-practices/references/data-upsert.md` — upsert patterns
- `<AI_DEV_SHOP_ROOT>/skills/supabase-postgres-best-practices/references/security-rls-performance.md` — RLS performance optimization

Do not load these by default. Load only when the specific task requires that topic.

## Preflight

Run this preflight before claiming live Supabase verification:

1. Resolve the current host.
2. Verify MCP surface support:

```bash
bash harness-engineering/validators/probe_host_capabilities.sh --host <detected-host> --capability mcp_surface
```

3. If `mcp_surface` is not `enabled`, stop there and report that live Supabase verification cannot be proven on this host.
4. Verify Supabase MCP availability:

```bash
bash harness-engineering/validators/probe_host_capabilities.sh --host <detected-host> --capability supabase_mcp
```

5. Interpret the result exactly:
   - `enabled`: the current host can use the configured Supabase MCP provider on this machine; this proves provider presence, not project reachability or authentication
   - `unavailable`: the current host supports MCP, but no `supabase` MCP server is configured
   - `unverified`: the repo cannot prove live Supabase verification on this host

If `supabase_mcp` is not `enabled`, do not bluff. Fall back to static `sql-data-modeling` and `postgresql` checks plus any manual verification instructions that fit the task.
If `supabase_mcp` is `enabled` but the actual runtime verification path fails because the provider is unreachable, unauthenticated, or not attached to the expected project, report that explicitly and fall back to static checks plus manual follow-up guidance.

## When to Use

Use this skill when the task involves:

- Row Level Security
- PostgREST table, view, or RPC behavior
- Supabase browser or server client setup
- realtime subscriptions or presence
- storage buckets or storage policies
- edge functions
- Supabase auth integration
- Supabase-specific operational gotchas

Do not use this skill as a substitute for:

- general schema design -> use `sql-data-modeling`
- non-trivial SQL features and deeper Postgres mechanics -> load `postgresql`
- platform choice decisions -> those should already be made before dispatch

## Required Context

Before implementing, confirm:

- which tables or views are in scope
- which roles need access: `anon`, `authenticated`, `service_role`, or app-defined roles
- whether the caller is browser, server, background job, or edge function
- whether realtime, storage, or auth claims are required
- whether the change targets a local Supabase instance or a remote project

## Contract by Concern

| Concern | Contract |
|---|---|
| RLS | Enable it explicitly. Define `SELECT`, `INSERT`, `UPDATE`, and `DELETE` access intentionally. Never rely on defaults. |
| PostgREST | API shape comes from schema objects and function names. Keep naming predictable and document filters and pagination. |
| RPC | Prefer `SECURITY INVOKER` unless privilege elevation is explicitly required. |
| Client Setup | Browser code uses URL + anon key. Admin/service clients remain server-only. |
| Types | Regenerate TypeScript types after schema changes and keep them committed. |
| Realtime | Add tables to `supabase_realtime` publication and verify `SELECT` policy coverage. |
| Storage | Model access through `storage.objects` policies; public buckets do not remove the need for write/delete policies. |
| Edge Functions | Use for external APIs, webhooks, secrets, or non-SQL server logic. |
| Auth | User-owned data should usually reference `auth.users(id)` and align with policy ownership rules. |

## Security Hard Gates

- Never expose `SUPABASE_SERVICE_ROLE_KEY` to client-side code.
- Never ship user-data tables without intentional RLS and a matching `SELECT` policy.
- Never use `SECURITY DEFINER` without explicit auth checks inside the function.
- Never assume a public bucket removes the need for object policies.
- Never bypass RLS accidentally through admin clients imported into shared code.

## Runtime Verification Gate

- When a live Supabase project is connected, `mcp_surface = enabled`, `supabase_mcp = enabled`, and the task changes query-layer behavior, do not mark the work complete without verifying the critical path with the available project tooling. At minimum, confirm actual versus expected query-plan shape and inspect for obvious index, pagination, or RLS-predicate regressions. Express this verification as intent; resolve the exact MCP, advisor, SQL, or dashboard path at runtime.

## Implementation Defaults

- Prefer `auth.uid()` for user ownership checks.
- Prefer explicit per-operation policies over vague `FOR ALL` policies unless the rule is truly identical.
- Prefer `SECURITY INVOKER` SQL functions for browser-callable RPC paths.
- Prefer cursor/keyset pagination for large tables.
- Prefer the typed Supabase client over untyped querying.
- Prefer SQL functions over edge functions when the work is purely database logic.
- Prefer edge functions when secrets, webhooks, or external APIs are involved.

## Common Failure Modes

- RLS silently returns empty rows instead of errors.
- Realtime appears "broken" because `SELECT` policy does not allow the subscribed rows.
- Storage reads work but uploads/deletes fail because `storage.objects` policies are incomplete.
- RPC seems too permissive because the function is `SECURITY DEFINER`.
- Frontend code accidentally imports an admin client.
- Types drift after migrations because generated types were not refreshed.

## Compliance Checklist

- RLS is enabled intentionally on user-data tables.
- Policy coverage is explicit for the required roles and operations.
- Browser and server clients are separated correctly.
- Realtime tables are in the publication and policy-checked.
- Storage policies cover the required operations.
- RPC functions use the correct security mode.
- Schema changes are followed by type regeneration.
- Any service-role usage is server-only and justified.

## References

- `references/rls-and-policies.md`
- `references/postgrest-and-rpc.md`
- `references/client-and-types.md`
- `references/realtime-and-storage.md`
- `references/edge-functions-and-auth.md`
- `references/performance-and-gotchas.md`
