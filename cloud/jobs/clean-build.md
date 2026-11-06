# Job clean-build (owner-approved 11-05)
A clean Jini checkout of cloud/combine does not build: `pnpm install --frozen-lockfile && pnpm -r --workspace-concurrency=1 run build` fails at @jini-ai/commerce with TS2307 for @jini-ai/ui/panel-kit, because commerce builds before ui, even though commerce lists @jini-ai/ui as a dev dependency. This likely means a dependency cycle or a new ordering problem from today's merges. Builds over existing dist output hide it, and it would break the next release.
A clean Tovu checkout also fails: `npm ci` stops in the packages/contracts prepare step (`tsc -p tsconfig.json`).

Base: origin/cloud/combine in both repos. Branch cloud/clean-build. Do not push to cloud/combine.
Reproduce each from a fresh clone with no existing dist or links, using a scratch directory under /workspace/work. Find the real cause, and name the cycle if there is one. Fix with the smallest change, keeping package boundaries; no build-script workarounds that merely retry. Prove it with a clean run at concurrency 1 and at the default, and say how long each took. Add a guard to the existing checks only if one small check prevents this coming back.
No skipping or weakening tests or rules. No publish, tag or main. Report at cloud/reports/clean-build.md and in your final message: shas, cause, exact files, commands and results. General wording in commits and notes.
