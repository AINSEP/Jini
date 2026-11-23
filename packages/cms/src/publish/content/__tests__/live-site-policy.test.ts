import assert from "node:assert/strict";
import { test } from "vitest";

import { canPublishToLive, type RuntimeModeEnvOptions } from "../live-site-policy.js";

/** The live-site verdict comes only from the host's injected runtime-mode resolver. */
function recordingResolver(mode: string) {
  const calls: Array<RuntimeModeEnvOptions | undefined> = [];
  return { calls, resolveRuntimeMode: (options?: RuntimeModeEnvOptions) => { calls.push(options); return mode; } };
}

test("an omitted env asks the resolver with no options and a production answer refuses", () => {
  const resolver = recordingResolver("production");
  assert.equal(canPublishToLive({ resolveRuntimeMode: resolver.resolveRuntimeMode }), false);
  assert.deepEqual(resolver.calls, [undefined]);
});

test("an explicit env is forwarded to the resolver and a non-production answer allows", () => {
  const resolver = recordingResolver("development");
  const env = { NODE_ENV: "production" };
  assert.equal(canPublishToLive({ env, resolveRuntimeMode: resolver.resolveRuntimeMode }), true);
  assert.deepEqual(resolver.calls, [{ env }]);
});
