import assert from "node:assert/strict";
import { test } from "vitest";
import type { ToolExecutionContext } from "@jini-ai/core";
import { ForbiddenError } from "../../../core/commands/command.js";
import { buildUiLocalesRegistrations, uiLocalesDerivedRisk, type UiLocaleOption } from "../ui-locales-tool.js";

/**
 * @file Characterization of supported admin-language discovery (n05), written when the tool moved
 * from the host. The offered locales are the host's product copy and arrive through the tool's deps;
 * the tool only gates on settings.read and hands back a copy plus the existing preference-write
 * coordinates. Tool metadata is the host's and is not bound here.
 */

const LOCALES: readonly UiLocaleOption[] = [
  { code: "en", label: "English" },
  { code: "pt-BR", label: "Português (Brasil)" },
  { code: "zz", label: "Test Language" },
];

const context = (input?: unknown): ToolExecutionContext => ({
  executionId: "exec", principal: { id: "operator" }, run: { id: "run" }, input,
  signal: new AbortController().signal,
} as ToolExecutionContext);

function fixture(allow = true) {
  const calls: unknown[] = [];
  const registrations = buildUiLocalesRegistrations({
    workspaceId: "ws",
    locales: LOCALES,
    authorize: async (input: unknown) => {
      calls.push(input);
      return { allowed: allow, reason: allow ? "matched" : "insufficient_permission" };
    },
  } as Parameters<typeof buildUiLocalesRegistrations>[0]);
  assert.deepEqual(registrations.map((r) => r.descriptor.id), ["settings_list_ui_locales"]);
  return { tool: registrations[0]!, calls };
}

test("lists exactly the injected locales and existing setter coordinates after checking permission", async () => {
  const { tool, calls } = fixture();
  const result = await tool.handler(context());
  assert.deepEqual(result, { locales: LOCALES.map((l) => ({ ...l })), setting: "core.language.locale", scope: "user", writeTool: "settings_set_ui_preference" });
  assert.deepEqual(calls, [{ principalId: "operator", workspaceId: "ws", permission: "settings.read", entityType: "setting-value" }]);
});

test("denied permission returns no locale data", async () => {
  const { tool, calls } = fixture(false);
  await assert.rejects(tool.handler(context()), (error: unknown) => {
    assert.ok(error instanceof ForbiddenError);
    assert.equal(error.message, "principal 'operator' is not authorized for 'settings.read' (insufficient_permission)");
    assert.equal(error.permission, "settings.read");
    return true;
  });
  assert.equal(calls.length, 1);
});

test("rejects arguments and malformed input before authorization", async () => {
  const { tool, calls } = fixture();
  for (const input of [{ locale: "pt" }, { principalId: "other" }, [], "es", null, 1, false]) {
    await assert.rejects(tool.handler(context(input)), { name: "ToolInputError", message: "this tool accepts no input — omit 'input' or pass {}" });
  }
  assert.deepEqual(calls, []);
  assert.deepEqual(await tool.handler(context(undefined)), await tool.handler(context({})));
});

test("returned options cannot mutate the injected list used by later calls", async () => {
  const { tool } = fixture();
  const first = await tool.handler(context()) as { locales: { code: string; label: string }[] };
  first.locales[0]!.code = "unsupported";
  first.locales[0]!.label = "Changed";
  first.locales.pop();
  const second = await tool.handler(context()) as { locales: { code: string; label: string }[] };
  assert.equal(second.locales.length, LOCALES.length);
  assert.deepEqual(second.locales[0], { code: "en", label: "English" });
  assert.deepEqual(LOCALES[0], { code: "en", label: "English" });
});

test("registration is read-only with derived risk none, an empty closed schema, and no host metadata bound", () => {
  const { tool } = fixture();
  assert.equal(tool.descriptor.readOnly, true);
  assert.equal(uiLocalesDerivedRisk.get("settings_list_ui_locales"), "none");
  assert.deepEqual(tool.descriptor.inputSchema, { type: "object", properties: {}, additionalProperties: false });
  assert.equal(tool.descriptor.metadata, undefined);
  const { description } = tool.descriptor;
  assert.ok(description, "the tool must describe itself");
  assert.match(description, /public.*content/i);
  assert.match(description, /coverage/i);
});
