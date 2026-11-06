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
