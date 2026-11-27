// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { usePluginRules } from "../rules-context.js";

it("rejects a missing host rules provider with setup guidance", () => {
  expect(() => renderHook(usePluginRules)).toThrow(
    "usePluginRules needs a PluginRulesProvider above it: the host binds the plugins rule functions.",
  );
});
