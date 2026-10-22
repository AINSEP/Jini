// Socket-free characterization assertions copied from daemon-auth and run-scoped-credential suites.
import assert from 'node:assert/strict';
import { test } from 'vitest';
import * as implementation from '../run-credentials.js';
const ALICE = 'principal-alice';
const AGENT_DAEMON_TOKEN_ENV_VAR = 'EXAMPLE_DAEMON_TOKEN';
const crypto = implementation.createNodeCredentialCrypto({});
const ensureAgentDaemonToken = (env: NodeJS.ProcessEnv) => implementation.ensureAgentDaemonToken({ env, envVarName: AGENT_DAEMON_TOKEN_ENV_VAR, crypto });
function createRunScopedCredentials(deps: { principalOfLiveRun(runId: string): string | undefined }) {
 const credentials = implementation.createRunScopedCredentials({ crypto, principalOfLiveRun: ({ runId }) => deps.principalOfLiveRun(runId) });
 return { mint: (runId: string) => credentials.mint({ runId }), resolvePrincipal: (token: string) => credentials.resolvePrincipal({ token }) };
}
test("ensureAgentDaemonToken mints a 64-char hex token when the env var is unset", () => {
  const env: NodeJS.ProcessEnv = {};
  const minted = ensureAgentDaemonToken(env);

  assert.match(minted, /^[0-9a-f]{64}$/, "32 random bytes, hex-encoded");
  assert.equal(env[AGENT_DAEMON_TOKEN_ENV_VAR], minted, "the token must land in the env the child will inherit");
});

test("ensureAgentDaemonToken is idempotent — a second call never rotates a token the daemon child may already hold", () => {
  const env: NodeJS.ProcessEnv = {};
  const first = ensureAgentDaemonToken(env);
  const second = ensureAgentDaemonToken(env);

  assert.equal(second, first);
  assert.equal(env[AGENT_DAEMON_TOKEN_ENV_VAR], first);
});

test("ensureAgentDaemonToken preserves an operator-supplied token and overwrites an empty one", () => {
  const operatorEnv: NodeJS.ProcessEnv = { [AGENT_DAEMON_TOKEN_ENV_VAR]: "operator-chosen-token" };
  assert.equal(ensureAgentDaemonToken(operatorEnv), "operator-chosen-token");

  const emptyEnv: NodeJS.ProcessEnv = { [AGENT_DAEMON_TOKEN_ENV_VAR]: "" };
  assert.match(ensureAgentDaemonToken(emptyEnv), /^[0-9a-f]{64}$/, "an empty value is a misconfiguration, not a token");
});

test("two mints are distinct — the token is random per boot, not a fixed constant", () => {
  assert.notEqual(ensureAgentDaemonToken({}), ensureAgentDaemonToken({}));
});
test("mint refuses a run that is not live, rather than issuing an orphan credential", () => {
  const credentials = createRunScopedCredentials({ principalOfLiveRun: () => undefined });

  assert.throws(() => credentials.mint("run-gone"), { message: 'cannot mint a credential for run "run-gone": it is not live' });
});

test("each run gets its own 256-bit token, and minting twice for one run returns the same token", () => {
  const credentials = createRunScopedCredentials({ principalOfLiveRun: () => ALICE });

  const first = credentials.mint("run-1");
  const second = credentials.mint("run-2");

  assert.match(first, /^[0-9a-f]{64}$/);
  assert.notEqual(first, second);
  assert.equal(credentials.mint("run-1"), first);
  assert.equal(credentials.resolvePrincipal(first), ALICE);
  assert.equal(credentials.resolvePrincipal("f".repeat(64)), undefined);
});

