import assert from "node:assert/strict";
import { test } from "vitest";

import { parseVisitorToolsConfigure, visitorToolsNeedsApproval } from "../visitor-tools-configure.js";
import type { VisitorToolChoice, VisitorToolDescriptor, VisitorToolsHostContract } from "../visitor-tools-contract.js";

/**
 * @file The visitor-tools management code reads every host policy value through the injected
 * `visitorTools` contract: the host's validation error class, its closed-object guard and its default
 * limits. These tests bind a fake contract and prove each value comes from it, not from a package copy.
 */

class HostValidationError extends Error {}

function fakeContract(overrides: Partial<VisitorToolsHostContract> = {}): VisitorToolsHostContract {
  return {
    setting: { namespace: "test.visitor", key: "policy" },
    permission: "test.visitor.manage",
    defaultLimits: { perIpPerHour: 5, perSitePerDay: 50 },
    callsPerTurn: 3,
    ValidationError: HostValidationError,
    object: ({ value, keys }) => {
      if (typeof value !== "object" || value === null || Array.isArray(value)) throw new HostValidationError("not an object");
      const record = value as Record<string, unknown>;
      if (keys && Object.keys(record).some(key => !keys.includes(key))) throw new HostValidationError("unknown field");
      return record;
    },
    parsePolicy: ({ value }) => value as never,
    resolveChoice: () => ({ mode: "off", limits: { perIpPerHour: 5, perSitePerDay: 50 } }),
    ...overrides,
  };
}

const plugin: VisitorToolDescriptor = {
  id: "lookup", source: "plugin", sourceRevision: "1", title: "Lookup", description: "d", effect: "read", availability: { available: true },
};
const choice = (mode: VisitorToolChoice["mode"], perIpPerHour: number, perSitePerDay: number): VisitorToolChoice => ({ mode, limits: { perIpPerHour, perSitePerDay } });

test("invalid input throws the host's injected ValidationError class", () => {
  const visitorTools = fakeContract();
  assert.throws(() => parseVisitorToolsConfigure({ value: { toolId: "Bad", expectedRevisionSeq: 0, mode: "off" }, visitorTools }), HostValidationError);
  assert.throws(() => parseVisitorToolsConfigure({ value: { toolId: "site", expectedRevisionSeq: 0, mode: "sometimes" }, visitorTools }), HostValidationError);
  assert.throws(() => parseVisitorToolsConfigure({ value: { toolId: "site", expectedRevisionSeq: 0, limits: { perIpPerHour: 0 } }, visitorTools }), HostValidationError);
});

test("closed-object checks run through the injected `object` guard with the transport's keys", () => {
  const seen: (readonly string[] | undefined)[] = [];
  const base = fakeContract();
  const visitorTools = fakeContract({ object: (required) => { seen.push(required.keys); return base.object(required); } });
  const parsed = parseVisitorToolsConfigure({ value: { toolId: "site", expectedRevisionSeq: 2, limits: { perSitePerDay: 9 } }, visitorTools });
  assert.deepEqual(parsed, { toolId: "site", expectedRevisionSeq: 2, limits: { perSitePerDay: 9 } });
  assert.deepEqual(seen, [["toolId", "expectedRevisionSeq", "mode", "limits"], ["perIpPerHour", "perSitePerDay"]]);
  assert.throws(() => parseVisitorToolsConfigure({ value: { toolId: "site", expectedRevisionSeq: 0, mode: "off", approved: true }, visitorTools }), HostValidationError);
});

test("raising a limit needs approval only above the host's injected default limits", () => {
  const visitorTools = fakeContract();
  // Raised, but still at/below the injected default (5/hour): runs directly.
  assert.equal(visitorToolsNeedsApproval({ tool: plugin, previous: choice("auto", 2, 50), next: choice("auto", 5, 50), visitorTools }), false);
  // Raised above the injected default: a fresh card.
  assert.equal(visitorToolsNeedsApproval({ tool: plugin, previous: choice("auto", 2, 50), next: choice("auto", 6, 50), visitorTools }), true);
  // A different host default moves the line: the same change is now within defaults.
  assert.equal(visitorToolsNeedsApproval({ tool: plugin, previous: choice("auto", 2, 50), next: choice("auto", 6, 50),
    visitorTools: { defaultLimits: { perIpPerHour: 10, perSitePerDay: 50 } } }), false);
});

test("raising mode rank needs approval except for reviewed built-in reads", () => {
  const visitorTools = fakeContract();
  assert.equal(visitorToolsNeedsApproval({ tool: plugin, previous: choice("off", 5, 50), next: choice("ask", 5, 50), visitorTools }), true);
  assert.equal(visitorToolsNeedsApproval({ tool: { ...plugin, source: "builtin" }, previous: choice("off", 5, 50), next: choice("auto", 5, 50), visitorTools }), false);
  assert.equal(visitorToolsNeedsApproval({ tool: plugin, previous: choice("auto", 5, 50), next: choice("ask", 5, 50), visitorTools }), false);
});
