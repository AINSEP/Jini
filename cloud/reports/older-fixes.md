# older-fixes — in progress

Branch: `cloud/older-fixes`. Base: `f4e3b18a5ea67fc7531357aae05c4495dd593bea`.

O01–O08 pending; C11–C30 pending focused traces. C01–C10 excluded as instructed.

Setup: rebuilding Jini from the specified base before relinking Tovu; focused baselines follow.

## Bugs found

- O01: static options use allocated archive folder names.
- O02: export history has no type label.

O03 fixed: collapsed targets include an explicitly supplied nonnegative integer offset, including zero. Chrome follow-up: compare two file reads at different offsets in collapsed chat rows.
Tests: `pnpm --filter @jini-ai/chat exec vitest run src/react/components/__tests__/ToolCard.batch-target.test.tsx` — 11 pass after red (8 pass, 3 fail).
Baseline `pnpm -r build` fails in provider-plugins (fix-round scope). Build excluding provider-plugins also fails in chat on existing test import of @jini-ai/ui-kit/react.

- O03: collapsed targets omit read offsets.
