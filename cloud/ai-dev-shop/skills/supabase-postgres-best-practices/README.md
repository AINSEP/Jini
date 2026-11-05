# Supabase Postgres Best Practices (Official Upstream)

Source: https://github.com/supabase/agent-skills
Installed via: `npx skills add supabase/agent-skills --skill supabase-postgres-best-practices`
License: MIT

Do not hand-edit SKILL.md, CHANGELOG.md, or references/ in this directory. They are maintained by Supabase. This README is a local addition.

## Updating

Run from the repo root:

```bash
npx skills add supabase/agent-skills --skill supabase-postgres-best-practices
```

The installer may place files in a temporary `.agents/skills/supabase-postgres-best-practices/` staging directory instead of here. If that happens, move them:

```bash
mv skills/.agents/skills/supabase-postgres-best-practices/SKILL.md skills/supabase-postgres-best-practices/SKILL.md
mv skills/.agents/skills/supabase-postgres-best-practices/CHANGELOG.md skills/supabase-postgres-best-practices/CHANGELOG.md 2>/dev/null
cp -r skills/.agents/skills/supabase-postgres-best-practices/references/ skills/supabase-postgres-best-practices/references/ 2>/dev/null
rm -rf skills/.agents
```

Then update the hash in `skills/skills-lock.json` if it changed.

## Relationship to skills/postgresql/ and skills/supabase/

Our custom `skills/postgresql/` and `skills/supabase/` are the canonical skills with hard gates, index selection matrix, and runtime verification. This upstream directory provides 31 individual rule files with incorrect-vs-correct SQL examples covering connection management, monitoring, concurrency, data access patterns, and RLS performance. Loaded only on demand via progressive disclosure references in the custom skills.

## Categories (31 rules)

| Priority | Category | Files |
|---|---|---|
| Critical | Query Performance | query-missing-indexes, query-partial-indexes, query-composite-indexes, query-covering-indexes, query-index-types |
| Critical | Connection Management | conn-pooling, conn-limits, conn-idle-timeout, conn-prepared-statements |
| Critical | Security & RLS | security-privileges, security-rls-basics, security-rls-performance |
| High | Schema Design | schema-constraints, schema-data-types, schema-foreign-key-indexes, schema-lowercase-identifiers, schema-partitioning, schema-primary-keys |
| Medium-High | Concurrency & Locking | lock-advisory, lock-deadlock-prevention, lock-short-transactions, lock-skip-locked |
| Medium | Data Access Patterns | data-batch-inserts, data-n-plus-one, data-pagination, data-upsert |
| Low-Medium | Monitoring & Diagnostics | monitor-explain-analyze, monitor-pg-stat-statements, monitor-vacuum-analyze |
| Low | Advanced Features | advanced-full-text-search, advanced-jsonb-indexing |
