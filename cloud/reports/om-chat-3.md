# om-chat-3 — in progress

Branch: cloud/om-chat-3. Base: origin/cloud/combine (see git history).

Discovery: selected-agent batch/stream inputs and observer cancellation reuse the existing detection cache. Shared probes survive another caller detaching.

Validation so far:
- `pnpm exec vitest run src/__tests__/detection-cache.unit.test.ts` (from packages/agent-runtime): red before implementation (2 failures).
- `pnpm exec vitest run src/__tests__/detection-cache.unit.test.ts` (from repository root): 4 passed after implementation.
- Initial `pnpm -r build` returned code 2 at agent-runtime, without a TypeScript diagnostic in the captured output; investigating before final verification.
- `JINI_PACKAGES_DIR=/workspace/Jini/packages npm run link:jini` (Tovu): passed.

Open: attachment forwarding, HTTP policy, parser limits, exact-selection/clamping review, host wiring, final checks.
