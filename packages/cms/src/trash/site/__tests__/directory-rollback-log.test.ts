import { describe, expect, it } from "vitest";
import { createDirectoryRollbackReporter } from "../directory-rollback-log.js";

describe("createDirectoryRollbackReporter", () => {
  it("hands the sink the rollback message and the raw error, formatting nothing itself", () => {
    const calls: Array<{ message: string; error: unknown }> = [];
    const report = createDirectoryRollbackReporter({ log: required => calls.push(required) });
    const error = new Error("unhide failed");

    report({ error });

    expect(calls).toEqual([{ message: "[trash] Could not unhide the directory after a failed removal", error }]);
    expect(calls[0]!.error).toBe(error);
  });

  it("does not call the sink until a failure is reported", () => {
    const calls: unknown[] = [];
    createDirectoryRollbackReporter({ log: (...args) => calls.push(args) });
    expect(calls).toEqual([]);
  });
});
