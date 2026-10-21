import { describe, expect, test } from "vitest";

import { noopAlertPort } from "../alerts.js";

/** @file The default alert port drops alerts (a host that wants them binds a real sink). */

describe("noopAlertPort", () => {
  test("accepts every alert kind and resolves without doing anything", async () => {
    for (const kind of ["over-withdrawn", "unknown-aged", "inbox-dead-letter", "quarantine"] as const) {
      await expect(noopAlertPort.raise({ alert: { kind, workspaceId: "ws", mode: "test", paymentId: null, detail: "d" } })).resolves.toBeUndefined();
    }
  });
});
