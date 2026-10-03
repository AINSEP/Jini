import assert from "node:assert/strict";
import { test } from "vitest";
import { Validator, type Schema } from "@cfworker/json-schema";

import { ASK_CHOICE_ANSWER_TICKET_PARAM } from "../index.js";
import type { AskChoiceEmission } from "../index.js";
type SurfaceEmitter = (emission: AskChoiceEmission) => Promise<void>;
import { createSurfaceExchangeStore, buildHandler, buildRegistration, SURFACE_DISMISSED_PARAM, SURFACE_EXCHANGE_ID_PARAM, TOOL_ID as ASK_CHOICE_TOOL_ID } from "./fixtures.js";

// Generalized from the source tool's round-trip characterization suite.
interface CallOptions {
  input?: unknown;
  emitSurface?: SurfaceEmitter;
  signal?: AbortSignal;
  principalId?: string;
}

function call(handler: ReturnType<typeof buildHandler>, options: CallOptions = {}) {
  return handler({ ctx: {
    principalId: options.principalId ?? "principal-1",
    input: options.input ?? {},
    signal: options.signal ?? new AbortController().signal,
    ...(options.emitSurface ? { emitSurface: ({ emission }: { emission: AskChoiceEmission }) => options.emitSurface!(emission) } : {}),
  } });
}

/** Pulls the exchange id out of the emitted surface's HTML, the way the rendered iframe would. */
function exchangeIdFromSurface(surface: unknown): string {
  const html = (surface as { payload: { resource: { resource: { text: string } } } }).payload.resource.resource.text;
  const match = html.match(new RegExp(`${SURFACE_EXCHANGE_ID_PARAM}"\\s*:\\s*"([^"]+)"`));
  assert.ok(match, "the surface must carry its exchange id, or the administrator's answer has nothing to name");
  return match[1]!;
}

/** Pulls the fallback path's answer ticket out of a directly-returned tool result's HTML, the way
 *  the rendered iframe's own submission would. */
function answerTicketFromResult(result: unknown): string {
  const html = (result as { content: Array<{ resource?: { text: string } }> }).content[1]?.resource?.text ?? "";
  const match = html.match(new RegExp(`${ASK_CHOICE_ANSWER_TICKET_PARAM}"\\s*:\\s*"([^"]+)"`));
  assert.ok(match, "the fallback surface must carry its answer ticket, or a real submission has nothing to redeem");
  return match[1]!;
}

const MOBILE_CSS_CALL = {
  title: "Apply the mobile CSS fix now?",
  description: "The warped layout is caused by a hard-coded padding-bottom in the mobile breakpoint.",
  singleSelect: {
    label: "What should I do?",
    options: [
      { value: "apply", label: "Apply the fix now" },
      { value: "wait", label: "Wait for my review" },
    ],
  },
};

test("a single-select question round-trips the model's own title and options, not a fixed sample", async () => {
  const surfaceExchanges = createSurfaceExchangeStore();
  const handler = buildHandler(surfaceExchanges);
  const emitted: unknown[] = [];

  const pending = call(handler, {
    input: MOBILE_CSS_CALL,
    emitSurface: async (surface) => {
      emitted.push(surface);
    },
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(emitted.length, 1);
  assert.equal(surfaceExchanges.size(), 1);
  assert.equal(
    await Promise.race([pending, Promise.resolve("still-waiting" as const)]),
    "still-waiting",
    "the agent's call must not return before the administrator answers",
  );

  const html = (emitted[0] as { payload: { resource: { resource: { text: string } } } }).payload.resource.resource.text;
  assert.match(html, /Apply the mobile CSS fix now\?/, "the model's own title must appear in the rendered form");
  assert.match(html, /Wait for my review/, "the model's own option label must appear in the rendered form");

  const exchangeId = exchangeIdFromSurface(emitted[0]);
  const delivered = surfaceExchanges.deliver({
    exchangeId,
    toolId: ASK_CHOICE_TOOL_ID,
    principalId: "principal-1",
    params: { [SURFACE_EXCHANGE_ID_PARAM]: exchangeId, choice: "wait" },
  });
  assert.deepEqual(delivered, { ok: true });

  assert.deepEqual(await pending, {
    submitted: true,
    choice: "wait",
    note: "Tell the administrator what you understood from their answer, in plain language, before proceeding.",
  });
});

test("a multi-select-only question has no 'choice' field at all, and an empty selection is a real answer", async () => {
  const surfaceExchanges = createSurfaceExchangeStore();
  const handler = buildHandler(surfaceExchanges);
  const emitted: unknown[] = [];

  const pending = call(handler, {
    input: {
      title: "Which extras should I enable?",
      multiSelect: {
        label: "Extras",
        options: [
          { value: "analytics", label: "Analytics" },
          { value: "backups", label: "Backups" },
        ],
      },
    },
    emitSurface: async (s) => void emitted.push(s),
  });

  await new Promise((resolve) => setImmediate(resolve));
  const exchangeId = exchangeIdFromSurface(emitted[0]);
  surfaceExchanges.deliver({
    exchangeId,
    toolId: ASK_CHOICE_TOOL_ID,
    principalId: "principal-1",
    params: { [SURFACE_EXCHANGE_ID_PARAM]: exchangeId, selections: [] },
  });

  assert.deepEqual(await pending, {
    submitted: true,
    selections: [],
    note: "Tell the administrator what you understood from their answer, in plain language, before proceeding.",
  });
});

test("a question with both fields returns both the choice and the selections", async () => {
  const surfaceExchanges = createSurfaceExchangeStore();
  const handler = buildHandler(surfaceExchanges);
  const emitted: unknown[] = [];

  const pending = call(handler, {
    input: {
      title: "Rollout plan",
      singleSelect: { label: "Plan", options: [{ value: "now", label: "Now" }, { value: "later", label: "Later" }] },
      multiSelect: { label: "Notify", options: [{ value: "email", label: "Email" }, { value: "slack", label: "Slack" }] },
    },
    emitSurface: async (s) => void emitted.push(s),
  });

  await new Promise((resolve) => setImmediate(resolve));
  const exchangeId = exchangeIdFromSurface(emitted[0]);
  surfaceExchanges.deliver({
    exchangeId,
    toolId: ASK_CHOICE_TOOL_ID,
    principalId: "principal-1",
    params: { [SURFACE_EXCHANGE_ID_PARAM]: exchangeId, choice: "now", selections: ["email", "slack"] },
  });

  assert.deepEqual(await pending, {
    submitted: true,
    choice: "now",
    selections: ["email", "slack"],
    note: "Tell the administrator what you understood from their answer, in plain language, before proceeding.",
  });
});

test("Cancel resolves the call immediately instead of stranding it until the TTL", async () => {
  const surfaceExchanges = createSurfaceExchangeStore();
  const handler = buildHandler(surfaceExchanges);
  const emitted: unknown[] = [];
  const pending = call(handler, { input: MOBILE_CSS_CALL, emitSurface: async (s) => void emitted.push(s) });

  await new Promise((resolve) => setImmediate(resolve));
  const exchangeId = exchangeIdFromSurface(emitted[0]);

  surfaceExchanges.deliver({
    exchangeId,
    toolId: ASK_CHOICE_TOOL_ID,
    principalId: "principal-1",
    params: { [SURFACE_EXCHANGE_ID_PARAM]: exchangeId, [SURFACE_DISMISSED_PARAM]: true },
  });

  const result = (await pending) as { submitted: boolean; reason: string; note: string };
  assert.equal(result.submitted, false);
  assert.equal(result.reason, "cancelled");
  assert.match(result.note, /Do not assume any answer/);
});

test("an unanswered form returns an explicit no-answer result, not a hang or a throw", async () => {
  const surfaceExchanges = createSurfaceExchangeStore({ idleTtlMs: 1 });
  const handler = buildHandler(surfaceExchanges);

  const result = (await call(handler, { input: MOBILE_CSS_CALL, emitSurface: async () => undefined })) as {
    submitted: boolean;
    reason: string;
    note: string;
  };

  assert.equal(result.submitted, false);
  assert.equal(result.reason, "expired");
  assert.match(result.note, /did not respond/);
});

test("a cancelled run closes the exchange rather than holding the handler to the deadline", async () => {
  const surfaceExchanges = createSurfaceExchangeStore();
  const handler = buildHandler(surfaceExchanges);
  const controller = new AbortController();

  const pending = call(handler, { input: MOBILE_CSS_CALL, emitSurface: async () => undefined, signal: controller.signal });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(surfaceExchanges.size(), 1);

  controller.abort();

  const result = (await pending) as { submitted: boolean; reason: string };
  assert.equal(result.reason, "abandoned");
  assert.equal(surfaceExchanges.size(), 0);
});

test("with no emit seam the tool falls back to returning the surface, and opens no exchange", async () => {
  const surfaceExchanges = createSurfaceExchangeStore();
  const handler = buildHandler(surfaceExchanges);

  const result = (await call(handler, { input: MOBILE_CSS_CALL })) as { content: Array<{ type: string }> };

  assert.equal(surfaceExchanges.size(), 0, "no emit seam means no exchange — open() requires one");
  assert.equal(result.content[0]?.type, "text");
  assert.equal(result.content[1]?.type, "resource");
});

test("the fallback's second call still echoes the administrator's selections to the agent, when it carries the real ticket", async () => {
  const surfaceExchanges = createSurfaceExchangeStore();
  const handler = buildHandler(surfaceExchanges);

  const opened = (await call(handler, { input: MOBILE_CSS_CALL })) as { content: Array<{ resource?: { text: string } }> };
  const ticket = answerTicketFromResult(opened);

  const result = await call(handler, { input: { choice: "wait", [ASK_CHOICE_ANSWER_TICKET_PARAM]: ticket } });

  assert.deepEqual(result, {
    submitted: true,
    choice: "wait",
    note: "Tell the administrator what you understood from their answer, in plain language, before proceeding.",
  });
});

test("a real fallback ticket refuses choices and selections outside its rendered options", async () => {
  const handler = buildHandler(createSurfaceExchangeStore());
  for (const answer of [
    { choice: "never-offered" },
    { choice: "wait", selections: ["never-offered"] },
    { selections: ["never-offered"] },
  ]) {
    await (async () => {
      const input = {
        title: MOBILE_CSS_CALL.title,
        ...("choice" in answer ? { singleSelect: MOBILE_CSS_CALL.singleSelect } : {}),
        multiSelect: { label: "Extras", options: [{ value: "email", label: "Email" }] },
      };
      const ticket = answerTicketFromResult(await call(handler, { input }));
      await assert.rejects(
        call(handler, { input: { ...answer, [ASK_CHOICE_ANSWER_TICKET_PARAM]: ticket } }),
        /does not match a form that is currently outstanding/,
      );
    })();
  }
});

test("a fallback ticket accepts only the choices and selections offered by its own form", async () => {
  const handler = buildHandler(createSurfaceExchangeStore());
  const input = { ...MOBILE_CSS_CALL, multiSelect: { label: "Extras", options: [{ value: "email", label: "Email" }] } };
  const ticket = answerTicketFromResult(await call(handler, { input }));
  const result = await call(handler, { input: { choice: "wait", selections: ["email"], [ASK_CHOICE_ANSWER_TICKET_PARAM]: ticket } });
  assert.equal((result as { submitted: boolean }).submitted, true);
  assert.equal((result as { choice: string }).choice, "wait");
  assert.deepEqual((result as { selections: string[] }).selections, ["email"]);
});

test("a fabricated second call with no ticket at all is refused, never reported as submitted", async () => {
  // This is the forgery the model itself could attempt: no form was ever rendered for this input,
  // so there is nothing to redeem. Before the fix this returned `{ submitted: true, choice:
  // 'media_generate_asset', ... }` — a decision the administrator never made, echoed straight into
  // the agent's next turn. The exact scenario a live incident traced a paid credential spend to.
  const surfaceExchanges = createSurfaceExchangeStore();
  const handler = buildHandler(surfaceExchanges);

  await assert.rejects(
    call(handler, { input: { choice: "media_generate_asset" } }),
    (error: Error) => {
      assert.match(error.message, /does not match a form that is currently outstanding/);
      assert.match(error.message, /never set 'choice' or 'selections' yourself/i);
      return true;
    },
  );
});

test("a second call carrying an unknown ticket is refused the same way as no ticket", async () => {
  const surfaceExchanges = createSurfaceExchangeStore();
  const handler = buildHandler(surfaceExchanges);

  await assert.rejects(
    call(handler, { input: { choice: "wait", [ASK_CHOICE_ANSWER_TICKET_PARAM]: "not-a-real-ticket" } }),
    /does not match a form that is currently outstanding/,
  );
});

test("a ticket already redeemed once cannot be replayed", async () => {
  const surfaceExchanges = createSurfaceExchangeStore();
  const handler = buildHandler(surfaceExchanges);

  const opened = (await call(handler, { input: MOBILE_CSS_CALL })) as { content: Array<{ resource?: { text: string } }> };
  const ticket = answerTicketFromResult(opened);

  const first = await call(handler, { input: { choice: "wait", [ASK_CHOICE_ANSWER_TICKET_PARAM]: ticket } });
  assert.deepEqual((first as { submitted: boolean }).submitted, true);

  await assert.rejects(
    call(handler, { input: { choice: "apply", [ASK_CHOICE_ANSWER_TICKET_PARAM]: ticket } }),
    /does not match a form that is currently outstanding/,
  );
});

test("a ticket minted for one administrator cannot be redeemed by another", async () => {
  const surfaceExchanges = createSurfaceExchangeStore();
  const handler = buildHandler(surfaceExchanges);

  const opened = (await call(handler, { input: MOBILE_CSS_CALL, principalId: "principal-1" })) as {
    content: Array<{ resource?: { text: string } }>;
  };
  const ticket = answerTicketFromResult(opened);

  await assert.rejects(
    call(handler, { input: { choice: "wait", [ASK_CHOICE_ANSWER_TICKET_PARAM]: ticket }, principalId: "principal-2" }),
    /does not match a form that is currently outstanding/,
  );
});

test("rejects a call with no title, decorated with the tool's own schema so the model can correct in one turn", async () => {
  const surfaceExchanges = createSurfaceExchangeStore();
  const handler = buildHandler(surfaceExchanges);

  await assert.rejects(
    call(handler, { input: { singleSelect: MOBILE_CSS_CALL.singleSelect } }),
    (error: Error) => {
      assert.match(error.message, /'title' is required/);
      assert.match(error.message, /retry/i);
      assert.match(error.message, /question_pick/);
      return true;
    },
  );
});

test("rejects a call with neither singleSelect nor multiSelect", async () => {
  const surfaceExchanges = createSurfaceExchangeStore();
  const handler = buildHandler(surfaceExchanges);

  await assert.rejects(
    call(handler, { input: { title: "Pick something" } }),
    /at least one of 'singleSelect' or 'multiSelect' is required/,
  );
});

test("registers unconditionally, publishing its own catalog schema", () => {
  const registrations = [buildRegistration(createSurfaceExchangeStore())];
  const registration = registrations.find((r) => r.descriptor.id === ASK_CHOICE_TOOL_ID);
  assert.ok(registration, "the tool must register");
  assert.ok(registration.descriptor.inputSchema, "the tool must publish an inputSchema");
  const schema = JSON.parse(JSON.stringify(registration.descriptor.inputSchema)) as {
    type: string;
    required: string[];
    anyOf: Array<{ required: string[] }>;
    properties: Record<string, {
      type: string;
      required: string[];
      properties: { label: { type: string }; options: {
        type: string; minItems: number;
        items: { type: string; required: string[]; properties: Record<string, { type: string }> };
      } };
    }>;
  };
  assert.equal(schema.type, "object");
  assert.deepEqual(schema.required, ["title"]);
  assert.equal(schema.properties.title!.type, "string");
  assert.deepEqual(schema.anyOf, [{ required: ["singleSelect"] }, { required: ["multiSelect"] }]);
  for (const field of ["singleSelect", "multiSelect"]) {
    const select = schema.properties[field]!;
    assert.equal(select.type, "object");
    assert.deepEqual(select.required, ["label", "options"]);
    assert.equal(select.properties.label.type, "string");
    assert.equal(select.properties.options.type, "array");
    assert.equal(select.properties.options.minItems, 1);
    const option = select.properties.options.items;
    assert.equal(option.type, "object");
    assert.deepEqual(option.required, ["value", "label"]);
    assert.equal(option.properties.value!.type, "string");
    assert.equal(option.properties.label!.type, "string");
  }
  const validator = new Validator(schema as unknown as Schema);
  const validate = (input: unknown) => validator.validate(input).valid;
  for (const valid of [
    MOBILE_CSS_CALL,
    { title: "Extras", multiSelect: MOBILE_CSS_CALL.singleSelect },
    { ...MOBILE_CSS_CALL, multiSelect: MOBILE_CSS_CALL.singleSelect },
  ]) assert.equal(validate(valid), true, "schema rejected a valid question");
  for (const invalid of [
    { singleSelect: MOBILE_CSS_CALL.singleSelect },
    { title: "No fields" },
    { title: "No options", singleSelect: { label: "Pick", options: [] } },
    { title: "No value", multiSelect: { label: "Pick", options: [{ label: "Missing value" }] } },
    { title: "Wrong value type", singleSelect: { label: "Pick", options: [{ value: 1, label: "One" }] } },
  ]) assert.equal(validate(invalid), false, JSON.stringify(invalid));
});
