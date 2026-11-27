# P8 Jini SOL commit plan

Base: `010c8cd874f709ffa2c61de0de4e1dde4f808aad` on `codex/b-p8bj`.
Changes are in the working tree only; the coordinator commits them.

## 1. P8-T6.J — refuse campaign writes to archived lists

Implementation completed; cloud verification pending.

Files:
- `packages/user-management/src/newsletter/__tests__/campaign-archived-list.test.ts` (new)
- `packages/user-management/src/newsletter/campaign-write-service.ts`
- `.changeset/newsletter-campaign-archived-list.md` (new; user-management patch)

Test authored before the production edit:
`saveCampaign refuses an archived list before writing a campaign or revision`,
parameterized over create and edit. Checks `NewsletterValidationError`, its field,
reason and message, zero campaign/revision writes, zero transaction entries, and
the stored campaign's unchanged version and contents.

Mutation: `allow-archived-campaign-list` removes the new archived-list branch.
Expected failure: the rejected-save assertion instead receives a successful save.
The mutation was not applied or executed.

The existing workspace-scoped list lookup and signatures are retained. Creator
kind, version checks, archived-campaign reads and package exports are unchanged.
No host wiring or API-baseline update.

## 2. P8-V2.J — inventory false/absent capability witness

Test-only implementation completed; cloud verification pending.

File:
- `packages/agent-runtime/src/inventory/__tests__/inventory.test.ts`

Added `inventory preserves explicit false capability flags as well as true flags`
using the existing `def`, `ports` and `createAgentInventory` fakes. Two injected
definitions distinguish an explicit `false` from an omitted key, using
`assert.deepEqual` for the explicit summary. The existing true-case witness stays.

Mutation: `drop-false-capability-flags` changes
`def.supportsCustomModel === undefined ? {} :` to
`!def.supportsCustomModel ? {} :` in `packages/agent-runtime/src/inventory/index.ts`.
Expected failure: deep equality detects the missing explicit-false key.
The mutation was not applied or executed. This is an inventory witness only;
it makes no claim about live Test agent authentication copy.

No production change, new export, changeset or API-baseline update for this sheet.

## Handoff and review

- Include this new `COMMIT-PLAN.md` with the coordinator's commits.
- Both Jini SOL anchors match the supplied base. No sheets stopped.
- Jini OPUS sheets left: P8-T7.J, P8-T8.J, P8-T13.J, P8-L2.J, P8-V1.J.
- Tovu OPUS sheets left: P8-T8.T, P8-T9.T, P8-T10.T, P8-L1.T, P8-V1.T, P8-V2.T.
- Tovu SOL sheets are outside this dispatch's repository scope:
  P8-T6.T, P8-T11.T, P8-L1.T-C036.
- Tovu needs no new Jini subpaths or exports from these changes. P8-T6.T remains
  responsible for the subscription guards.
- Static scope/architecture review: PASS against the supplied sheets; existing
  DI and the pre-transaction validation boundary are preserved.
- Function assessment: `requireEditableListId` retains one workspace-scoped read,
  adds one constant-time status guard, and uses constant auxiliary space; no
  findings from static review. Test assertions directly cover the new refusal
  before effects. Variable names and error fields match their values.
- Added three test cases (two parameterized campaign cases, one inventory case);
  no existing tests or assertions deleted or weakened.
- No tests, mutations, builds, installs, type-checks, linters or runtime
  self-validation ran, as explicitly required by the dispatch. No green/red or
  coverage result is claimed. Cloud execution must verify both named mutations.
- Final diff review found no unrequested changes to delete. Deletions: none.
