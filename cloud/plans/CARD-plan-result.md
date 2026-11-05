Software Architect(Direct): I loaded and applied the Software Architect, Programmer, and TDD skills you named.

**1. Goal**

Move the three approved connection-card pieces into existing Jini packages so Open Marketing can reuse them, while preserving Tovu’s current behavior and security fixes.

**2. Findings**

- Both clones report branch `merge-1029`, with uncommitted work. This was static inspection only; no files changed and no project tests, builds, installations, or servers ran.
- The callback extraction is now at [T/assistant/mcp-ui-tool-calls-route.ts:218](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/assistant/mcp-ui-tool-calls-route.ts:218). It includes restoration before returning 409. Preserve its 202 acknowledgment and existing restoration responses.
- Reuse checked: Jini already provides [surface restoration](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/daemon/src/http/surface-restoration.ts:9), [shared exchange contracts](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/core/src/surface-exchanges.ts:141), `buildOutcomeSurface`, and `secret-card`. A new exchange store or card framework is unnecessary.
- The typed-answer fix is visible: only choice cards accept composer answers, including when an exchange ID accompanies them. Both HTTP hops share that policy. See [permit:69](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/assistant/mcp-ui-tool-calls.ts:69) and [proxy:461](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/runtime/composition/modules/assistant.ts:461).
- **Do not replace the host proxy with the terminal delivery helper.** Its local miss must continue through restoration and daemon forwarding. See [proxy:467](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/runtime/composition/modules/assistant.ts:467).
- The sign-in lifecycle is only [56 lines](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/agent-plugins/connect-sign-in-wait.ts:10). It registers receipt before emission, aborts only its watcher on Skip, closes exchanges, and tolerates failed final-card updates.
- Hosted completion requires **connected status and a newer credential generation**. Preserve both checks and the baseline read before starting authorization. See [connect:67](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/api-connections/connect.ts:67) and [connect:178](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/api-connections/connect.ts:178).
- Handoffs already wrap Jini’s bounded cache; move that wrapper rather than create storage. Consumption precedes actor checking. See [browser-binding:53](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/api-connections/browser-binding.ts:53).
- MCP browser binding changes and regression assertions are present. **UNVERIFIED:** security-job completion, passing tests, measured complexity, and actual Open Marketing wiring. Its repository was not supplied.
- Graph tools were unavailable; bounded source reads supplied evidence. The architecture chapters were absent from the clone, so I consulted their `/Users/la/Programming/Tovu` copies.

**3. Ordered plan**

Paths below use `T = apps/website/src` and `J = packages` in their respective clones. Line estimates include moved code; test estimates are additional.

1. **Capture the fixed baseline in the cloud — no production edits.**
   - Record both revisions and relevant uncommitted security changes; run their targeted regression suites before extraction.
   - Reuse existing tests instead of inventing a second specification: callback secret forms/restoration, connect Skip/API lifecycle, browser binding, and MCP OAuth.
   - **Tests:** [typed-answer bypass assertions:48](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/assistant/__tests__/mcp-ui-tool-calls-route.secret-forms.test.ts:48), [MCP browser-proof assertions:144](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/external-mcp/__tests__/external-mcp-oauth.test.ts:144), and existing hosted sign-in security integration.
   - **Why it cannot be smaller:** otherwise extraction failures cannot be distinguished from concurrent security work. Any newly discovered bug starts with a failing test.

2. **Move exchange delivery and its exchange-only permit.**
   - Add `J/daemon/src/http/surface-callback.ts`; export through the existing HTTP barrel.
   - Move delivery/restoration/response handling from `T/assistant/mcp-ui-tool-calls-route.ts`.
   - Supply the shared store, verified principal, tool ID, exchange ID, parameters, and host admission predicate. Typed answers require explicit host opt-in; default denies them.
   - Keep host tool membership and namespace recognition in `T/assistant/mcp-ui-tool-calls.ts`; delegate exchange admission there so both HTTP hops reuse it.
   - Keep request parsing, typed-target resolution, authentication, route mounting, proxy forwarding, and legacy execution in Tovu. The shared delivery API receives no arbitrary tool executor.
   - **Size:** production approximately **+65–95 / −30–45**; tests **+100–160**.
   - **Tests:** real-store delivery; wrong principal/tool; unknown/closed exchange; explicit restore and late-answer restoration; typed secret submission with/without ID; no fresh execution; unchanged status/body. Retain existing route and proxy suites.
   - **Why it cannot be smaller:** exporting delivery alone leaves the typed-answer admission boundary duplicated across hosts. Moving the whole route exports unrelated legacy execution.

3. **Move the sign-in card and lifecycle beside `secret-card`.**
   - Add `J/ui/src/features/mcp-ui/sign-in-card.ts` and its universal package subpath.
   - Move the lifecycle and three-state renderer from `T/features/agent-plugins/connect-sign-in-wait.ts` and `connect-card-ui.ts`.
   - Inject `SurfaceExchangeStore` from core; avoid a UI dependency on the daemon runtime. Reuse `buildOutcomeSurface`.
   - Accept neutral identity, display copy, tool ID, URI/app metadata, connection callback, and skipped-result projection. Do not import `PluginCredentialCard` or Tovu result types.
   - Keep thin Tovu adapters supplying today’s URI, app identity, wording, error text, and skipped result. Preserve same-URI replacement and open-link behavior.
   - **Size:** production approximately **+120–155 / −95–115**; tests **+120–180**.
   - **Tests:** waiting → connected/skipped; immediate Skip during emission; watcher aborted while parent remains live; parent abort closes immediately; missing emitter; timeout; failed final emission; identical Tovu copy/theme/link behavior.
   - Reuse [connect-skip tests:15](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/agent-plugins/__tests__/unit/connect-skip.unit.test.ts:15) and existing card/API-connect suites.
   - **Why it cannot be smaller:** renderer-only extraction leaves cancellation and exchange ordering duplicated; lifecycle-only extraction leaves product naming in the reusable card.

4. **Move hosted waiting and handoffs into integrations.**
   - Add `J/integrations/src/api-connections/hosted-sign-in.ts`; export from its existing index.
   - Move `waitForCallback`, its private abortable pause, and `createSignInHandoffs`.
   - Wait inputs: workspace/ref, baseline generation, existing status/generation reader ports, signal, interval, timeout. Use existing fake timers for deterministic tests.
   - Preserve the current status check, generation fence, error propagation, timeout result, cache expiry/capacity, entropy, and consume-before-owner-check ordering.
   - Replace Tovu implementations with imports/adapters in `connect.ts`, `browser-binding.ts`, and `host.ts`. Routes, link construction, cookies, desktop loopback, and MCP-specific waiting stay put.
   - **Size:** production approximately **+65–90 / −55–70**; tests **+100–150**, mostly relocating existing handoff cases.
   - **Tests:** connected with unchanged generation keeps waiting; newer generation succeeds; timeout/abort/error; expiry boundary; wrong actor burns ID; replay; capacity eviction; independent instances.
   - Retain [hosted connect tests:80](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/api-connections/__tests__/connect.unit.test.ts:80) and [cookie/handoff tests:22](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/api-connections/__tests__/browser-binding.unit.test.ts:22).
   - **Why it cannot be smaller:** moving only polling leaves generic handoff security in Tovu; moving the host would unnecessarily export routing and cookie policy.

5. **Verify package delivery and Tovu compatibility in Node 24.**
   - Test built, packed Jini packages in a disposable Tovu installation; shipping manifests/lockfile use published versions through the normal release process.
   - Add one neutral consumer fixture using different tool IDs, URI/copy, and connection ports. Assert changed rendered output and actual delivery—not merely compilation.
   - Run package-local daemon/UI/integrations suites, targeted Tovu suites above, boundary/complexity checks, and the existing PostgreSQL vault parity regression. That PostgreSQL suite proves storage compatibility, not a full browser sign-in journey.
   - **Size:** production metadata/import adjustments **+15–30 / −5–15**; fixture **+50–90**. No new test harness.
   - **Why it cannot be smaller:** package-local tests cannot prove exports or consumer compatibility. Tovu explicitly [rejects linked Jini release builds](/Users/la/Programming/tovu-integration-clones/prov2-tovu/development/scripts/check-no-linked-jini.mjs:22).

All new public APIs use `(requiredObject, optionalObject)`. Keep changed functions within complexity 10; desktop is untouched. Preserve existing instrumentation and payload secrecy.

**4. Cost**

**Added production I/O: 0 reads, 0 writes, 0 polls, 0 provider requests.** The extraction relocates existing effects.

| Retained operation | Frequency × payload |
|---|---|
| Exchange delivery | One submission × parameter payload `P`; ordinary acknowledgment is 18 JSON bytes |
| Card emission | One waiting + at most one final update × generated HTML size `H` |
| Restoration heartbeat | One per 15 seconds while streaming × 21 body bytes; existing behavior |
| Hosted API polling | Default every 3 seconds for 5 minutes: nominally up to 100 status calls |
| Poll reads | Each poll reads one connection record; connected status also loads tokens, then checks generation separately |
| Handoff storage | One issue + one consume per attempt; ≤256 entries per host, each holding URL, actor, expiry, 43-character binding and 43-character key |

Defaults: [connect-tool:73](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/agent-plugins/connect-tool.ts:73). Status may load credentials: [status:38](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/integrations/src/api-connections/status.ts:38). **UNVERIFIED:** actual `P`, `H`, record/token byte sizes, and database wire overhead. Preserve call counts; do not add reads to simplify the API.

**5. Exclusions and CUT-CANDIDATES**

- No legacy-path deletion, OAuth redesign, schema change, new persistence, background worker, event bus, polling optimization, new package, or broad refactor.
- No `secret-card` rewrite or new plugin imports. Any future plugin work remains under `@jini-ai/agent-plugins/<id>`.
- **CUT-CANDIDATE:** real-browser end-to-end expansion beyond existing behavior tests.
- **CUT-CANDIDATE:** dedicated PostgreSQL card-flow harness; reuse existing PostgreSQL regression coverage.
- Park durable/multi-instance handoffs and additional card states for later.

**6. Effort and dependencies**

Approximately **8–12 hours of Codex work**, including tests and cloud integration: baseline 0.5–1h; callback 2–3h; card 2–3h; hosted helpers 1.5–2h; packaging/verification 2–3h.

Security baseline comes first. The three extractions are otherwise independent; consumer verification depends on all three. No implementation is authorized by this read-only plan.

**7. Owner questions**

None required. Recommendation: proceed with these bounded extractions after the security baseline passes; keep the listed candidates parked.