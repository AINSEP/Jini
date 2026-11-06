# om-chat-3 — in progress

Branch: cloud/om-chat-3. Base: origin/cloud/combine (see git history).

Discovery: selected-agent batch/stream inputs and observer cancellation reuse the existing detection cache. Shared probes survive another caller detaching.

Validation so far:
- `pnpm exec vitest run src/__tests__/detection-cache.unit.test.ts` (from packages/agent-runtime): red before implementation (2 failures).
- `pnpm exec vitest run src/__tests__/detection-cache.unit.test.ts` (from repository root): 4 passed after implementation.
- Initial `pnpm -r build` returned code 2 at agent-runtime, without a TypeScript diagnostic in the captured output; investigating before final verification.
- `JINI_PACKAGES_DIR=/workspace/Jini/packages npm run link:jini` (Tovu): passed.

Open: attachment forwarding, HTTP policy, parser limits, exact-selection/clamping review, host wiring, final checks.

Checkpoint: ff855bf367cbbd49b84d223ad278ae040ea60fd4 pushed to Jini cloud/om-chat-3.
Attachment handler now forwards host-prepared pixels and read-only directories separately from writable grants.
HTTP injection supports an explicit required policy; absence retains the prior prelaunch stdio fallback.
- `pnpm exec vitest run src/continuation/__tests__/run-start-handler.test.ts` (packages/daemon): red 1 failing, green 8 passed.
- `pnpm exec vitest run src/agent-executor/__tests__/http-mcp.test.ts` (packages/daemon): red 3 failing, green 11 passed as part of the HTTP check.
BUG: existing http-mcp-launch.integration.test.ts has 4 failures due to personal-MCP native access policy in its fixture; baseline comparison pending.
- Existing runtime `detection.test.ts`: 47 passed; runtime typecheck and detection complexity passed.
Initial full build overlapped newly authored tests, so it is not valid unchanged-tree baseline evidence. Focused builds/checks replace that evidence.

Checkpoint: 2fb58885920c14a1c049fa40f41b3eb21cf5f696 pushed to Jini cloud/om-chat-3.
Exact launch effort validation now shares the picker's existing pure model/effort rules. Codex argv forwards explicit effort without historical model-prefix clamping; the legacy helper remains available for API compatibility.
- `pnpm exec vitest run src/defs/__tests__/codex.test.ts src/__tests__/model-discovery-policy.test.ts` (packages/agent-runtime): red 2 failures.
- `pnpm exec vitest run src/defs/__tests__/codex.test.ts src/defs/__tests__/shared.test.ts src/__tests__/models.test.ts src/__tests__/model-discovery-policy.test.ts` (packages/agent-runtime): 228 passed.
- Updated runtime, daemon and MCP builds passed after correcting exact-optional-property typing in the new test/API.

Parser bounds: physical JSON lines retain at most 8 Mi UTF-16 code units; overflow is explicit and discards through newline. ACP multiline limits are checked before parse and report errors to transport failure paths. Existing parser/protocol tests plus new overflow cases: 797 passed across 9 files. Strict parser complexity lint passed.
