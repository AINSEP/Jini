import { describe, expect, it } from "vitest";
import { ConnectionBudgetExceededError, createConnectionBudgets, HOST_BUDGET_MAXIMUM, parseConnectionBudgets } from "../budgets.js";

describe("parseConnectionBudgets", () => {
  const parse = (value: unknown) => parseConnectionBudgets({ value, at: "budgets" });

  it("defaults to the host's instance maximum and adds it when only a connection budget is declared", () => {
    expect(parse(undefined)).toEqual([{ scope: "instance", perMinute: 240, burst: 40 }]);
    expect(parse([{ scope: "connection", perMinute: 10 }])).toEqual([{ scope: "instance", ...HOST_BUDGET_MAXIMUM }, { scope: "connection", perMinute: 10, burst: 0 }]);
  });
  it("clamps declared numbers to the host maximum", () => {
    expect(parse([{ scope: "instance", perMinute: 1000, burst: 99 }])).toEqual([{ scope: "instance", perMinute: 240, burst: 40 }]);
  });
  it("names exactly what is wrong", () => {
    expect(parse("x")).toBe("budgets must be a list of at most 2 budgets");
    expect(parse([{ scope: "instance", perMinute: 1 }, { scope: "connection", perMinute: 1 }, { scope: "connection", perMinute: 1 }])).toBe("budgets must be a list of at most 2 budgets");
    expect(parse([null])).toBe("budgets[0] must be an object");
    expect(parse([{ scope: "user", perMinute: 1 }])).toBe('budgets[0].scope must be "instance" or "connection"');
    expect(parse([{ scope: "instance", perMinute: 0 }])).toBe("budgets[0].perMinute must be a whole number of at least 1, and burst a whole number of at least 0");
    expect(parse([{ scope: "instance", perMinute: 5, burst: -1 }])).toBe("budgets[0].perMinute must be a whole number of at least 1, and burst a whole number of at least 0");
    expect(parse([{ scope: "connection", perMinute: 5 }, { scope: "connection", perMinute: 6 }])).toBe('budgets[1].scope "connection" is declared twice');
  });
});

describe("createConnectionBudgets.charge", () => {
  const target = { workspaceId: "ws", pluginId: "plug", connectionId: "acct", connectionRef: "ref-1" };

  it("checks the connection budget before the instance one, keyed per scope, sharing one limiter per profile", async () => {
    const checked: string[] = [];
    const created: unknown[] = [];
    const budgets = createConnectionBudgets({ clock: { nowMs: () => 0 }, createLimiter: ({ profile }) => {
      created.push(profile);
      return { check: async ({ key }) => { checked.push(key); return { allowed: true }; } };
    } });
    const both = [{ scope: "instance" as const, perMinute: 5, burst: 1 }, { scope: "connection" as const, perMinute: 5, burst: 1 }];
    await budgets.charge({ ...target, budgets: both });
    await budgets.charge({ ...target, budgets: both });
    expect(checked.slice(0, 2)).toEqual(["ws\u0000plug\u0000acct\u0000ref-1", "ws\u0000plug\u0000acct\u0000"]);
    expect(created).toEqual([{ windowSeconds: 60, max: 5, burst: 1 }]);
  });

  it("refuses with the retry wait in milliseconds when a limiter says no", async () => {
    const budgets = createConnectionBudgets({ clock: { nowMs: () => 0 }, createLimiter: () => ({ check: async () => ({ allowed: false, retryAfterSeconds: 3 }) }) });
    const error = await budgets.charge({ ...target, budgets: [{ scope: "instance", perMinute: 1, burst: 0 }] }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectionBudgetExceededError);
    expect(error).toMatchObject({ code: "rate-limited", retryable: true, retryAfterMs: 3000, outcome: "not-applied", name: "ConnectionBudgetExceededError",
      message: "This plugin reached its per-minute request budget for this service. Nothing was sent; retry after the wait." });
  });
});
