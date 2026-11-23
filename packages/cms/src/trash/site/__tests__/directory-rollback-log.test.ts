import { describe, expect, it } from "vitest";
import { describeErrorForLog } from "@jini-ai/core/model-facing-tool-errors";
import { createDirectoryRollbackReporter } from "../directory-rollback-log.js";

describe("createDirectoryRollbackReporter", () => {
  it("writes the rollback message and the log-safe error description to the injected sink", () => {
    const calls: Array<[string, unknown]> = [];
    const report = createDirectoryRollbackReporter({ log: (message, detail) => calls.push([message, detail]) });
    const error = new Error("unhide failed");

    report({ error });

    expect(calls).toEqual([["[trash] Could not unhide the directory after a failed removal", describeErrorForLog({ err: error })]]);
  });

  it("does not call the sink until a failure is reported", () => {
    const calls: unknown[] = [];
    createDirectoryRollbackReporter({ log: (...args) => calls.push(args) });
    expect(calls).toEqual([]);
  });
});
