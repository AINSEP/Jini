import { vi } from "vitest";
import { bindShellFailureLogger } from "../shell-failure-log.js";

/** Binds a spy logger for one test; `mockRestore()` unbinds it, mirroring the old console spy. */
export function spyShellFailures() {
  const error = vi.fn();
  const unbind = bindShellFailureLogger({ logger: { error } });
  return Object.assign(error, { mockRestore: unbind });
}
