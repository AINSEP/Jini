import assert from "node:assert/strict";
import { test } from "vitest";

import type { TrashPort } from "../../index.js";
import { bindWidgetRemoval } from "../widget-removal.js";

/**
 * @file The widget removal binding forwards the restore marker to the injected trash port in the
 * original shape: `{ priorMarker }` every call, explicitly `undefined` when the widget had none.
 */

function fakePort(): { port: TrashPort; options: unknown[] } {
  const options: unknown[] = [];
  const port = { trash: async (_required: unknown, optional: unknown) => { options.push(optional); return { ok: true, version: 1 }; } } as unknown as TrashPort;
  return { port, options };
}
const record = { workspaceId: "ws", id: "w1", display: { title: "Widget" }, at: "2026-11-23T00:00:00.000Z", expectedVersion: null, actor: { kind: "system" } } as const;

test("an absent marker is forwarded as an explicit priorMarker: undefined", async () => {
  const { port, options } = fakePort();
  await bindWidgetRemoval({ trash: port })(record as never);
  assert.deepEqual(options, [{ priorMarker: undefined }]);
  assert.ok(Object.hasOwn(options[0] as object, "priorMarker"));
});

test("a supplied marker is forwarded unchanged", async () => {
  const { port, options } = fakePort();
  await bindWidgetRemoval({ trash: port })({ ...record, priorMarker: "published" } as never);
  assert.deepEqual(options, [{ priorMarker: "published" }]);
});
