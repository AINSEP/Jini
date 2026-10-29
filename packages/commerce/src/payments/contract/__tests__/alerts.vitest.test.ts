import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, test } from "vitest";

import { noopAlertPort, type PaymentsAlert } from "../alerts.js";

/** @file The default alert port drops alerts (a host that wants them binds a real sink). */

describe("noopAlertPort", () => {
  test("fulfillment-blocked is an alert kind accepted by the host port", async () => {
    // The package excludes tests from tsc; compile this typed fixture during Vitest so it is enforced.
    const program = ts.createProgram([fileURLToPath(import.meta.url)], {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true, strict: true, skipLibCheck: true, esModuleInterop: true, types: ["node"],
    });
    expect(program.getSemanticDiagnostics().map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n"))).toEqual([]);
    const alert: PaymentsAlert = {
      kind: "fulfillment-blocked", workspaceId: "ws", mode: "test", paymentId: "pay_1", detail: "order association does not match",
    };
    await expect(noopAlertPort.raise({ alert })).resolves.toBeUndefined();
  });

  test("accepts every alert kind and resolves without doing anything", async () => {
    for (const kind of ["over-withdrawn", "unknown-aged", "inbox-dead-letter", "quarantine"] as const) {
      await expect(noopAlertPort.raise({ alert: { kind, workspaceId: "ws", mode: "test", paymentId: null, detail: "d" } })).resolves.toBeUndefined();
    }
  });
});
