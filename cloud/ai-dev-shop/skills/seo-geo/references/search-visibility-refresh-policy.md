---
name: search-visibility-refresh-policy
description: Defines freshness windows, staleness handling, source precedence, and update procedure for search visibility claims.
last_updated: 2026-05-19
---

# Search Visibility Refresh Policy

SEO, GEO, AEO, and AI crawler behavior changes quickly. This policy prevents old research or platform behavior from becoming framework law.

## Refresh Ownership

The Skills Librarian owns scheduled refreshes of the source ledger and skill guidance. The Coordinator may trigger or run an unscheduled refresh when a user requests current SEO/GEO/AEO guidance, when an audit depends on platform-specific crawler or AI-search behavior, or when the source ledger's `last_verified` dates exceed the freshness gate. Observer may surface stale claims during maintenance, but does not own the refresh.

## Source Precedence

Use sources in this order:

1. Official platform documentation or standards documents.
2. Official platform announcements with dated publication.
3. Peer-reviewed research.
4. Vendor studies with transparent methodology.
5. Community reports, SEO blogs, social posts, and anecdotal measurements.

Only sources in categories 1 and 2 can produce Required platform-specific findings. Research and community sources can guide Advisory recommendations.

## Freshness Windows

| Claim Tier | Refresh Window | Stale Behavior |
|---|---|---|
| T1 Durable | 12 months | Re-check before broad framework rewrites; can still guide implementation if no contradiction is known |
| T2 Platform | 90 days | Downgrade to Recommended or Advisory until re-verified |
| T3 Research | 180 days | Advisory only; remove exact-effect language unless re-verified |
| T4 Emerging | 60 days | Awareness only; never Required |

## Staleness Rules

1. Every platform-specific or research-backed claim needs a source-ledger row.
2. A claim past its refresh window is stale.
3. Stale T2 claims cannot produce Required findings.
4. T3 and T4 claims cannot produce Required findings even when fresh.
5. If more than half of the T2 claims needed for an audit are stale, the Search Visibility agent must pause the platform-specific portion and request a refresh.
6. If the ledger contradicts older reference files, the ledger wins.

## Refresh Procedure

1. Identify the claim IDs needed for the current audit or skill update.
2. Open each source URL and verify whether the claim still appears and still means the same thing.
3. Update `Last Verified`, `Refresh Due`, and `Audit Use`.
4. If a source changed, rewrite the claim and add a note to the update log.
5. If a source disappeared, find a same-authority replacement. If none exists, retire the claim.
6. If a new claim is added, include claim ID, summary, tier, source URL, verification date, refresh due date, and allowed audit use.
7. Preserve retired claims so future agents do not reintroduce them from memory or old references.

## Full Refresh Triggers

Run a broader refresh when:

- the user explicitly asks for current SEO/GEO/AEO guidance
- a major search engine or AI platform announces crawler, retrieval, indexing, or answer-surface changes
- a new AI search or answer platform becomes important to the project
- more than half of T2/T3 claims are stale
- six months have passed since the last full Search Visibility research report
- an audit finds repeated mismatches between source-code checks and live crawler behavior

## Promotion And Demotion

- T4 -> T3: repeatable evidence or published research exists.
- T3 -> T2: the claim appears in official platform documentation.
- T2 -> T1: the claim is based on stable web standards rather than platform policy.
- T2 -> T3: official documentation is removed or behavior becomes inconsistent.
- Any tier -> retired: the claim is contradicted, obsolete, or no authoritative source remains.

## Report Requirement

Every retained Search Visibility report must include:

- `last_verified`
- ledger status
- stale claims used or excluded
- sources consulted
- which findings are Required, Recommended, and Advisory
- which recommendations need future refresh before becoming hard guidance
