# Wave B Jini runtime source bugs (branch fix/wave-b-jini-runtime, base fix/wave-b-jini-tests-rest)

| # | Bug | Status | RED | GREEN | Mutation | SHA |
|---|---|---|---|---|---|---|
| 1 | federate-mcp `forWorkspace` positional (TypeError `toLowerCase`) | FIXED | `federate-mcp-layout-args.unit.test.ts` fails (TypeError at federate-mcp.ts:327) | passes | reverting the call to positional fails the test | c5693455 |
| 2 | mail catalog `createSmtpTransport` `sendMail(mail)` positional | FIXED | `catalog-smtp-transport-args.unit.test.ts` fails (host got bare payload) | passes; mail dir 3 files / 8 tests pass; tsc clean | re-adding the positional adapter fails the test | 0bf88306 |
| 3 | `createFormDestinationPort` `loadRegistry(workspaceId)` | NOT A JINI BUG | n/a | n/a | n/a | The symbol exists only in Tovu `apps/website/src/features/form-destinations/port.ts:17`; no `loadRegistry` anywhere in Jini. Tovu-side fix. |
| 4 | plugins `host/contributions.ts` missing imports | ALREADY FIXED on base | `plugins` tsc --noEmit: 0 errors | | | |
| 5 | provider-plugins `./observability-opentelemetry/port` export | ALREADY FIXED on base | export present in package.json; `dist/observability-opentelemetry/otel-port.d.ts` built | | | |
| 6 | ui build tsc aborts before CSS copy | ALREADY FIXED on base | `packages/ui` builds fully; `dist/features/interactive-ui/interactive-ui.css` produced | | | |

## Sweep
- `forWorkspace(` callers across packages/examples (ts/tsx/mjs/js): all use `{ workspaceId }` now; only doc comments mention the old form.
- AST scan: collected every function/method/property-signature in non-test TS whose first param is object-typed, minus names also declared positionally and builtin names; checked all non-test .ts/.mjs/.js calls passing a literal/identifier first arg. After removing bundled vendor code (opentelemetry/sentry/posthog/echarts/recharts), standalone web-clone scripts and local-only helpers, no further positional leftovers: `git.postJson`, `kit.*`, `wait` in the github/google-workspace plugins are consistently positional on both sides.
- Limits: name-based matching, so it cannot prove a typed-`any` caller is absent; test files were not swept.

## Full `pnpm --no-bail -r build` tsc error count
before: 15, after: 15. All 15 are outside these bugs (`daemon` http/xai.ts exactOptionalPropertyTypes x6, routines.test x2, tool-execution-routes x1; `chat` StorageKernel/KyselyKernel x6 and TS2742 x1), and are the target of branch fix/wave-b-chat-daemon. The Tovu-reported "104 vs 19" figure does not apply to this base.

Not done: package-wide test runs beyond the touched dirs (agent-plugins mail dir and the new connect test run green).
