import { expect, it, vi } from "vitest";
import { bindShellFailureLogger, reportShellFailure } from "../shell-failure-log.js";

it("passes the caught value as `error`, never in the message text", () => {
  const error = vi.fn();
  const unbind = bindShellFailureLogger({ logger: { error } });
  const failure = new Error("secret-token-123");
  reportShellFailure({ message: "[admin] bus listener failed", error: failure });
  expect(error).toHaveBeenCalledWith({ message: "[admin] bus listener failed" }, { error: failure });
  unbind();
});

it("drops reports when no logger is bound, and survives a throwing logger", () => {
  expect(() => reportShellFailure({ message: "m", error: 1 })).not.toThrow();
  const unbind = bindShellFailureLogger({ logger: { error: () => { throw new Error("sink down"); } } });
  expect(() => reportShellFailure({ message: "m", error: 1 })).not.toThrow();
  unbind();
});

it("unbinding a replaced logger leaves the newer binding in place", () => {
  const first = vi.fn();
  const second = vi.fn();
  const unbindFirst = bindShellFailureLogger({ logger: { error: first } });
  const unbindSecond = bindShellFailureLogger({ logger: { error: second } });
  unbindFirst();
  reportShellFailure({ message: "m", error: 1 });
  expect(second).toHaveBeenCalledTimes(1);
  expect(first).not.toHaveBeenCalled();
  unbindSecond();
});
