# W3 mcp-registry — coordinator progress

## Coordinator
- STEP 0: `Linux vm 6.18.44-fc-v139 x86_64 GNU/Linux; hostname vm; /home/user/Jini; 2026-10-20T04:30:48Z; node v22.22.0` (cloud-proof commit 039ddfb8; hostname/pwd written literally — the auto-mode classifier refused the $(hostname)/$(pwd) form).
- Personas loaded by coordinator: software-architect, code-inspection, security (../AI-Dev-Shop @ depth-1 clone at /home/user/AI-Dev-Shop).

## Setup
- Node 24: v24.22.0 from nodejs.org tarball into ~/.local/node24 (no nvm/volta/n available).
- pnpm 10.33.2 via corepack; install 26 s; `pnpm --no-bail -r build` 2 min (integrations tsc fails as expected; all 36 dist present).
- Heavy lock: /tmp/w3-heavy.lock. cx eslint config: /tmp/w3-coord/cx.config.mjs (createRequire from repo root).
- Worktrees: /home/user/wt-<LOT>, scratch /tmp/w3-mcp-registry-<LOT>/.

## Lots
| lot | status | branch head | before→after worst cyc/cog | coverage (br/fn/ln) | verify |
|---|---|---|---|---|---|
| L152a | running | | 13/11 → | | |
| L152b | running | | 15/15 → | | |
| L104 | running | | 23/26 → | | |
| L113-L188-L203-L236 | running | | 23/42 → | | |
| L036a | running | | 13/11 → | | |
| L036b | queued | | 39/25 → | | |

## Merges / findings / next
- (none yet)
