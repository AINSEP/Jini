# Pass 4: External Systems and Human Workflows

Load this file when executing Pass 4. Reads `artifact-1-core-logic.md`, `artifact-2-data-access.md`, and `artifact-3-boundaries.md`. Produces `artifact-4-external.md`.

## References to Load

- `references/extraction-layers.md` — output schema for all requirements produced in this pass

## Why All Three Prior Artifacts

The consumer inventory maps WHO calls WHAT. "What" lives across:
- artifact-1: API endpoints, entrypoint map
- artifact-2: access-control matrix (who has permission to call what)
- artifact-3: integration boundaries, async events, webhook contracts (what external systems interact with)

## Phase 10: External Control Plane and Infrastructure Behavior

Code is not the full system. In a 5-year-old production SaaS, ~40% of behavior lives outside the repo.

### Tool-Gating Rule (Anti-Hallucination)

For each external system, classify access before extracting:

1. **Tool-accessible** (MCP server, API access, CLI available): extract directly, mark `observed` or `runtime-observed`
2. **Config-file-accessible** (infrastructure-as-code, committed config, env files): extract from files, mark `observed`
3. **Inaccessible** (dashboard-only, no API, no MCP): generate `[HUMAN DATA REQUEST]`:

```
[HUMAN DATA REQUEST]
System: <provider name>
What's needed: <specific config items>
Why it matters: <what breaks if wrong>
Suggested source: <dashboard URL, API, or person to ask>
Priority: blocking | important | nice-to-have
```

Do NOT guess. Do NOT invent plausible configurations from industry defaults.

### External SaaS Configuration

- **Billing provider**: plans, coupons, trials, dunning rules, tax settings, webhook endpoints, grandfathered products, **account API version** (payload shapes are version-dependent)
- **Identity provider**: claim mappings, group-role rules, SCIM provisioning, redirect URIs, token lifetimes, per-customer SSO config, logout behavior
- **Email/SMS provider**: templates, subjects, merge variables, sender identities, unsubscribe behavior, localization variants
- **Search provider**: synonyms, ranking rules, typo tolerance, analyzers, replicas, reindex cadence
- **Feature flag service**: active flags, targeting rules, rollout percentages, per-customer overrides, stale flags. **Zombie flag pruning:** cross-reference code branches guarded by feature flags against the active flags from the provider. If a flag exists in code but NOT in the external provider (deleted from dashboard but never cleaned from source), mark the inactive code path as `[LIKELY DEAD CODE]` and extract only the default fallback behavior as the requirement.
- **Analytics/CDP**: event names, payload schemas, identity stitching, downstream consumers

### Infrastructure-as-Behavior

- **CDN/WAF/proxy**: redirects, rewrites, cache TTLs, WAF rules, header normalization, upload limits, rate limits, IP allowlists, bot rules
- **Cookie/session config**: domain, SameSite, Secure, TTL, CORS (may be split across app + proxy + CDN)
- **Production environment variables**: behavior-changing values (timeouts, enabled providers, limits, regions)
- **Per-environment drift**: prod vs staging vs test differences

### Cache Contract Extraction

Cache behavior is cross-cutting — it can live at multiple layers simultaneously. Extract each cache independently:

| Cache Instance | Layer | Key Structure | Vary Dimensions | TTL | Invalidation Trigger | Stale Tolerance | Stampede Protection | Warm-up | Consistency Model | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|

**Cache layers to check:**
- **HTTP headers**: Cache-Control, ETag, Last-Modified per endpoint (from Pass 3)
- **CDN/edge**: CDN cache rules, origin shielding, purge mechanisms
- **Reverse proxy**: Nginx/Varnish cache rules, vary headers
- **Application**: Redis/Memcached keys, in-process cache (request-scoped vs process-scoped)
- **Database/query**: ORM query cache, materialized views, computed columns
- **Client/browser**: service worker cache, localStorage, IndexedDB
- **Mobile offline**: offline-first cache, sync queue

For each cache:
- Key structure (what makes it unique — tenant, user, role, locale, feature flag, auth state?)
- TTL and whether it varies by content type or endpoint
- Invalidation trigger (what event purges/updates the cache?)
- Stale-data tolerance (is stale-while-revalidate acceptable? for how long?)
- Stampede/thundering-herd protection (lock, probabilistic early refresh, request coalescing?)
- Warm-up requirements (does the system preload on deploy or on first request?)
- Consistency model (eventual, read-your-writes, strong?)

Cross-reference with Pass 3's Cache-Control headers and client-state invalidation contracts to avoid duplication.

### Consumer Inventory

| Consumer | Type | Version | Contract Used | Evidence | Break Risk |
|----------|------|---------|---------------|----------|-----------|
| <mobile app> | mobile client | <version> | <endpoints/shapes relied on> | access logs | <high/med/low> |
| <partner X> | webhook consumer | <unknown/version> | <payload shape> | webhook delivery logs | high |
| <internal tool> | direct DB query | current | <tables/columns> | config/code | medium |
| <no-code automation> | API consumer | current | <endpoints> | token audit | medium |
| <BI/warehouse> | replica reader | current | <tables/events> | query logs | medium |

Inventory ALL consumers of the system's outputs — not just the ones you control.

### Durable Links and Historical Outputs

- Old emails, PDFs, invoices, exports contain URLs still receiving traffic
- Public URLs indexed by search engines or bookmarked by users
- Deep links in mobile apps targeting specific routes
- Partner integrations hardcoded to specific URL patterns

Sample historical outbound links from email logs, export archives, and access logs. Preserve compatibility routes for active durable links.

### Human Workflows and Operational Procedures

- **Support procedures**: account repair, refunds, impersonation, unlocks, backfills (often via console/admin panel/SQL)
- **Operational runbooks**: incident procedures that mutate data, replay jobs, disable features
- **Scheduled manual processes**: monthly reconciliations, CSV uploads, partner data exchanges, compliance exports
- **Approval chains**: discounts, refunds, data restores, abuse appeals requiring human approval
- **Account lifecycle outside code**: onboarding/offboarding involving spreadsheets, tickets, billing ops, manual provisioning
- **Data corrections and backfills**: scripts that periodically fix bad state (system assumes these run)
- **Alert-triggered remediation**: feature disable, queue drain, scaling actions users experience indirectly

### Customer-Specific Behavior

- Account/customer-level overrides from billing, admin, CRM, or entitlement stores
- Customer contracts and SLA promises (retention, export format, uptime, regional hosting, custom limits)
- Data residency rules enforced by infrastructure, DNS, or cloud accounts
- Partner-specific quirks: custom date formats, field casing, payload transformations
- Grandfathered products or pricing no longer available to new customers

### Client-Side Implicit Contracts

- Frontend validation the server relies on (server accepts invalid states because JS validates first)
- Undocumented response quirks mobile/web clients depend on
- Pinned client versions still in active use
- "No-op" compatibility: ignored fields, accepted-but-unused params, duplicate submits being harmless
- Offline behavior assumptions

### Frontend/Client Behavior (for full-stack rewrites)

If the rewrite includes frontend, extract:
- Route map and navigation flow
- Auth redirects and session behavior
- Form fields, validation, and error display per form
- Loading/empty/error states per screen
- Local storage/session storage keys and their lifecycle
- Cookies read/written by client code
- API calls per screen/action (not just per endpoint)
- Feature flag usage in client
- Optimistic updates and their rollback behavior
- Analytics events emitted by UI
- Accessibility-critical behavior (screen reader, keyboard nav)
- Deep link handling

## Handoff Artifact: artifact-4-external.md

Produce:
- External SaaS config (extracted or `[HUMAN DATA REQUEST]`)
- Infrastructure behavior inventory
- Consumer inventory table
- Durable links inventory
- Human workflow inventory
- Customer-specific behavior inventory
- Client-side contracts
- Frontend behavior (if full-stack)
- All `[HUMAN DATA REQUEST]` items aggregated
- Open questions from this pass
