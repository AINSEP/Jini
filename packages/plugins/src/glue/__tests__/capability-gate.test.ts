import assert from "node:assert/strict";
import { test } from "vitest";

import { buildGlueCapabilityGate, GlueCapabilityDeniedError } from "../capability-gate.js";
import type { GlueCapability } from "../manifest.js";
import type { GlueCapabilityDelegate } from "../capability-gate.js";

const GLUE_CAPABILITIES: readonly string[] = ["content.read", "content.extend", "hooks.attach", "tools.register", "events.subscribe", "admin.nav.register", "render.contribute", "http.route.register"];



function fakeDelegates(record: Partial<Record<GlueCapability, GlueCapabilityDelegate>> = {}): Record<GlueCapability, GlueCapabilityDelegate> {
  const base: Record<GlueCapability, GlueCapabilityDelegate> = {} as Record<GlueCapability, GlueCapabilityDelegate>;
  for (const capability of GLUE_CAPABILITIES) {
    base[capability] = (..._args: readonly unknown[]) => `real:${capability}`;
  }
  for (const [key, delegate] of Object.entries(record)) if (delegate) base[key] = delegate;
  return base;
}

test("sanity: GLUE_CAPABILITIES enumerates exactly the 8-member vocabulary", () => {
  assert.equal(GLUE_CAPABILITIES.length, 8);
  assert.deepEqual(
    [...GLUE_CAPABILITIES].sort(),
    [
      "admin.nav.register",
      "content.extend",
      "content.read",
      "events.subscribe",
      "hooks.attach",
      "http.route.register",
      "render.contribute",
      "tools.register",
    ].sort()
  );
});

test("CIC-1 (ESCALATE_SECURITY) [no capabilities granted]: every one of the 8 positions is always present as a callable", () => {
  const gate = buildGlueCapabilityGate({ vocabulary: GLUE_CAPABILITIES, moduleId: "m", capabilities: [], coreDelegates: fakeDelegates() });
  for (const capability of GLUE_CAPABILITIES) {
    assert.equal(typeof gate[capability], "function", `${capability} must be callable even when ungranted`);
  }
});

test("CIC-1 (ESCALATE_SECURITY) [all capabilities granted]: every one of the 8 positions is always present as a callable", () => {
  const gate = buildGlueCapabilityGate({ vocabulary: GLUE_CAPABILITIES, moduleId: "m", capabilities: GLUE_CAPABILITIES, coreDelegates: fakeDelegates() });
  for (const capability of GLUE_CAPABILITIES) {
    assert.equal(typeof gate[capability], "function", `${capability} must be callable when granted`);
  }
});

test("CIC-1 (ESCALATE_SECURITY) [mixed grant set]: every one of the 8 positions is always present as a callable", () => {
  const mixed: readonly GlueCapability[] = ["content.read", "events.subscribe", "http.route.register"];
  const gate = buildGlueCapabilityGate({ vocabulary: GLUE_CAPABILITIES, moduleId: "m", capabilities: mixed, coreDelegates: fakeDelegates() });
  for (const capability of GLUE_CAPABILITIES) {
    assert.equal(typeof gate[capability], "function", `${capability} must be callable regardless of this module's specific grant set`);
  }
});

for (const capability of GLUE_CAPABILITIES) {
  test(`default-deny: '${capability}' throws GlueCapabilityDeniedError when NOT granted`, () => {
    const gate = buildGlueCapabilityGate({ vocabulary: GLUE_CAPABILITIES, moduleId: "m", capabilities: [], coreDelegates: fakeDelegates() });
    assert.throws(() => gate[capability]!({}), GlueCapabilityDeniedError);
  });

  test(`granted: '${capability}' delegates to coreDelegates when granted, never throwing`, () => {
    const gate = buildGlueCapabilityGate({ vocabulary: GLUE_CAPABILITIES, moduleId: "m", capabilities: [capability], coreDelegates: fakeDelegates() });
    assert.doesNotThrow(() => gate[capability]!({}));
    assert.equal(gate[capability]!({}), `real:${capability}`);
  });
}

test("REQ-4/CIC-1: a denied invocation carries the exact denied capability and moduleId, not a generic message", () => {
  const gate = buildGlueCapabilityGate({ vocabulary: GLUE_CAPABILITIES, moduleId: "my-module", capabilities: [], coreDelegates: fakeDelegates() });

  try {
    gate["admin.nav.register"]!({});
    assert.fail("expected admin.nav.register() to throw when ungranted");
  } catch (error) {
    assert.ok(error instanceof GlueCapabilityDeniedError);
    assert.equal((error as GlueCapabilityDeniedError).moduleId, "my-module");
    assert.equal((error as GlueCapabilityDeniedError).capability, "admin.nav.register");
  }
});

test("a granted capability call forwards its exact arguments to coreDelegates (capabilities by handle, no argument mangling)", () => {
  let received: readonly unknown[] | null = null;
  const coreDelegates = fakeDelegates({
    "content.extend": (...args: readonly unknown[]) => {
      received = args;
      return undefined;
    },
  });

  const gate = buildGlueCapabilityGate({ vocabulary: GLUE_CAPABILITIES, moduleId: "m", capabilities: ["content.extend"], coreDelegates });
  gate["content.extend"]!({ count: 5 });

  assert.deepEqual(received, [{ count: 5 }]);
});

test("CIC-1: a module cannot expand its own granted capability set by mutating the array passed at build time", () => {
  const capabilities: GlueCapability[] = ["content.read"];
  const gate = buildGlueCapabilityGate({ vocabulary: GLUE_CAPABILITIES, moduleId: "m", capabilities, coreDelegates: fakeDelegates() });

  // Mutate the caller's own array reference AFTER the gate is built.
  capabilities.push("http.route.register");

  // The already-built gate must not observe the mutation — the grant set was snapshotted, not
  // re-read.
  assert.throws(() => gate["http.route.register"]!({}), GlueCapabilityDeniedError);
});

test("CIC-1: the returned gate handle is frozen — no caller, including the gated module itself, can add or replace a position", () => {
  const gate = buildGlueCapabilityGate({ vocabulary: GLUE_CAPABILITIES, moduleId: "m", capabilities: ["content.read"], coreDelegates: fakeDelegates() });
  const originalPosition = gate["content.read"];

  assert.ok(Object.isFrozen(gate));

  // A frozen object's property write is a no-op (silently ignored in sloppy-mode transpiled
  // output, thrown in strict mode — the load-bearing guarantee is that the value never actually
  // changes either way, not which of the two failure shapes surfaces).
  try {
    // @ts-expect-error -- deliberately attempting a runtime mutation the type system already forbids
    gate["content.read"] = () => "hijacked";
  } catch {
    // Acceptable: strict-mode environments throw TypeError here instead of silently ignoring it.
  }
  assert.equal(gate["content.read"], originalPosition, "a write attempt must never actually replace a position, thrown or not");
});

test("buildGlueCapabilityGate builds a fresh object per call — two builds never share the same handle instance", () => {
  const first = buildGlueCapabilityGate({ vocabulary: GLUE_CAPABILITIES, moduleId: "m", capabilities: GLUE_CAPABILITIES, coreDelegates: fakeDelegates() });
  const second = buildGlueCapabilityGate({ vocabulary: GLUE_CAPABILITIES, moduleId: "m", capabilities: GLUE_CAPABILITIES, coreDelegates: fakeDelegates() });

  assert.notEqual(first, second);
});
