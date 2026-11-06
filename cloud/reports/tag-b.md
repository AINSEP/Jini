# tag-b — in progress

Branch: `cloud/tag-b`. Base: `origin/cloud/combine` at `3a86f98ba03380651c8bf64b8fc18c4f90a122fd`.

Owner-approved scope: TAG plan steps 2, 3, 4 and remaining step 6, with TRIM TAG constraints. Default handles at existing shared owners, forwarding, Composer/picker, Tovu adoption; preserve secret/human approval exclusions and host driving boundaries.

Loaded Software Architect, Programmer, TDD personas from `/workspace/cloud/ai-dev-shop`. Baseline rebuild and targeted test setup in progress. Final commands, results, pushed SHAs and open findings will be recorded here.

No deploy, publish, main push, force-push, new schema, polling or registry.

## Checkpoint — implementation and verification in progress

Current commits on `cloud/tag-b` (periodic pushes confirmed through Jini `82b94c528` and Tovu `37d724980`):

```text
e39166479cf29a83df239abe010ced3485b6b3a5 docs: record tag-b scope and combined base
14210c73445c01a3d25e57e6296a8c90c1c21044 feat(ui): tag shared controls with stable default handles
5354a0d22629c3ce364f1aaaec22c4d35fef7f72 feat(chat): default composer and runtime picker agent handles
369daf83bf9cd83f27a0df13b04bb65db663a29f fix(agentic): warn when duplicate handles refuse an action
3ce2828bc73536d756b06fc96985af727f7b9277 feat(ui-kit): default shared control handles and forward composite leaves
ee3e9583ddb6371d667a26c1b8b4fc82e5c94fd6 feat(ui): preserve field handles through shadcn and entity controls
9dc44e28ba3d13bf4e71f24c4ae6970abc32746c test(chat): verify pane handle forwarding and keep tray opt-out
761e64c237782eb8bc3608c075e56e83dc05ce84 fix(ui-kit): preserve opt-outs and metadata across native forwarding
cbea94d3ca318faffa0b98b35406dc874d26f69a feat(ui): default existing widget and tab controls to agent handles
57488eefc4aabc9cb53a239a9844fa240f2a229e test(chat): preserve attachment handle identity across reorder
82b94c528f827142804aa45d4551a005b99b16df fix(ui-kit): keep tab identities stable and preserve generated defaults
8042f6be0937e310a60865a9a09132e2798da7b7 fix(chat): forward composer handles to folder controls
fa50039d04165a6ae7ac448279cec1ac97d05e4b feat(ui-kit): tag ordinary confirmations while preserving human-only decisions
```

Setup: frozen pnpm install refreshed stale links using a workspace-local store; original home-backed cache was read-only. Contracts, Jini dependencies and touched packages rebuilt; local Tovu link refreshed. PostgreSQL not needed. Initial recursive build failed before refresh because provider-plugins could not resolve declared jsdom/cms dependencies; direct refreshed provider typecheck passes. Initial Tovu test resolution failure disappeared after contracts rebuild. No source changes were used to hide setup failures.

Verified so far: Jini driver baseline 117 and updated 118 tests green; ui-kit React matrix 196 tests green before final confirmation additions; chat nine new primary regressions plus seven attachment tests green. Tovu untouched targeted baseline 48 tests green, direct backup/menu controls 36 green, corrected password/privacy and scoped overlay 19 green, App/WebMCP/secrets boundary 84 green. Admin tsc passes. Remaining final rebuilding and affected test evidence will replace this checkpoint.

BUG — Pre-existing chat history-remount regression: affected run 174/175, interrupted accepted message recalls first instead of accepted text; reproduced from unchanged origin/cloud/combine source archive. No source fix or test weakening.

BUG — Pre-existing Tovu AdminShell complexity 11 exceeds 10; baseline source stdin lint and current lint report the identical function/count. Other touched Tovu production paths pass strict complexity.

Open limitation — inherited very long explicit base handles can overflow agentHandleProps after suffixing; automatic generated bases are bounded. Listed only.
