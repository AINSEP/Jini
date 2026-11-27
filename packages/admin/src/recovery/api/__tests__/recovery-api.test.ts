import { expect, it, vi } from "vitest";
import { createRecoveryApi, type RecoveryApiDeps } from "../recovery-api.js";

function setup() {
  const request = vi.fn(async (_required: { path: string }, _optional?: { init?: RequestInit }) => ({}));
  return { request, api: createRecoveryApi({ request: request as unknown as RecoveryApiDeps["request"] }) };
}

it("reads recovery status and points and forwards a deep-link envelope as informational context", async () => {
  const { api, request } = setup();
  const envelope = {
    v: 2, correlationId: "corr-9", siteId: "site-7", ledgerEventId: null,
    restorePointId: "point-4", drift: "stale", intent: "view", issuedAt: "2026-04-02T12:00:00Z",
  };
  await api.listRecoveryRestorePoints();
  await api.getRecoveryStatus();
  await api.computeRecoveryDisclosure({ restorePointId: "point-4" });
  await api.resolveRecoveryDeepLink(envelope);
  expect(request.mock.calls).toEqual([
    [{ path: "/recovery/restore-points" }],
    [{ path: "/recovery/status" }],
    [{ path: "/recovery/disclosure" }, { init: { method: "POST", body: '{"restorePointId":"point-4"}' } }],
    [{ path: "/recovery/deep-link" }, { init: { method: "POST", body: JSON.stringify({ envelope }) } }],
  ]);
});

it("sends the plan hash, negative acknowledgement and execution token only to their respective restore steps", async () => {
  const { api, request } = setup();
  await api.planRestore({ restorePointId: "point-7" });
  await api.confirmRestore({ planId: "plan-3", planHash: "hash-9", disclosureAcknowledged: false });
  await api.executeRestore({ confirmationToken: "token-8", restorePointId: "point-7" });
  expect(request.mock.calls).toEqual([
    [{ path: "/recovery/restore/plan" }, { init: { method: "POST", body: '{"restorePointId":"point-7"}' } }],
    [{ path: "/recovery/restore/confirm" }, { init: { method: "POST", body: '{"planId":"plan-3","planHash":"hash-9","disclosureAcknowledged":false}' } }],
    [{ path: "/recovery/restore/execute" }, { init: { method: "POST", body: '{"confirmationToken":"token-8","restorePointId":"point-7"}' } }],
  ]);
});
