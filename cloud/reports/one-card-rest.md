# one-card-rest — in progress

Started 2026-11-06 16:41 UTC; hard stop 18:41 UTC. Branch in both repositories: `cloud/one-card-rest`.

Bases: Jini `f07ae3d6ff55cf4da480acac44cc6f4b7686966b`; Tovu `74fedc1320d31431ab4a13d1e38af03a402ca28b`.

Authority: fetched `origin/cloud-plans-1105`, read `cloud/jobs/COMMON.md`, `cloud/jobs/one-card-rest.md`, and `cloud/reports/one-card.md`. Loaded software-architect, programmer, TDD personas from `/workspace/cloud/ai-dev-shop`.

## Work in progress

- Convert automatic plugin choice and mail provider cards through the existing common access lifecycle; preserve presentation and existing effect owners.
- Correct secret-setting writability in discovery listings.
- Check the provider catalog for Formspree; add only if absent.
- Inventory approval tools from current source with plain reasons.
- Leave consent cards and historical form answer copies unchanged.

## Verification

Jini base rebuild and Tovu relink underway. Focused test results will be recorded here.

## Bugs found

OPEN: Definition listings can advertise secret settings as agent-writable although generic execution refuses them (confirmed prior-job report; current-source verification underway).
