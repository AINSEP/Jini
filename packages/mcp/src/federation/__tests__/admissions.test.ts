import { describe, expect, test } from "vitest";
import { readFederationAdmissions, type FederationAdmissionsPorts } from "../admissions.js";

const settled = async () => ({ settled: true });
const read = (ports: Partial<FederationAdmissionsPorts>, reported: unknown[] = []) =>
  readFederationAdmissions({ ports: { report: ({ error }) => { reported.push(error); }, ...ports }, timeoutMs: 5_000 });

describe("readFederationAdmissions", () => {
  test("an unavailable report is never an empty roster", async () => {
    expect(await read({})).toEqual({ ok: false });
    expect(await read({ awaitFederation: async () => ({ settled: false }), readAdmissions: async () => ({ connections: [] }) })).toEqual({ ok: false });
    expect(await read({ awaitFederation: settled, readAdmissions: async () => ({ connections: "nope" }) })).toEqual({ ok: false });
    expect(await read({ awaitFederation: settled, readAdmissions: async () => ({ connections: [], configFailures: {} }) })).toEqual({ ok: false });
    expect(await read({ awaitFederation: settled, readAdmissions: async () => ({ connections: [] }) })).toEqual({ ok: true, connections: [] });
  });

  test("keeps configFailures only when the runtime reported them, and passes the timeout policy", async () => {
    let waited = 0;
    expect(await read({ awaitFederation: async ({ timeoutMs }) => { waited = timeoutMs; return { settled: true }; }, readAdmissions: async () => ({ connections: [1], configFailures: [2] }) }))
      .toEqual({ ok: true, connections: [1], configFailures: [2] });
    expect(waited).toBe(5_000);
  });

  test("a failed read goes to the sink only, and answers unavailable", async () => {
    const reported: unknown[] = [];
    const boom = new Error("transport said Bearer sk_secret");
    expect(await read({ awaitFederation: settled, readAdmissions: async () => { throw boom; } }, reported)).toEqual({ ok: false });
    expect(reported).toEqual([boom]);
  });
});
