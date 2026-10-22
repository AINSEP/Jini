import type { DurableRunStore } from "../../../core/durable-runs/ports.js";

function unexpected(name: string): never {
  throw new Error(`unexpected store.${name} call in a recovery test: recovery only loads, advances and clocks runs`);
}

/** Store methods recovery never calls; each fails loudly so a new call surfaces in its test. */
export const unusedStoreMethods: Omit<DurableRunStore, "load" | "advance" | "recoveryClock"> = {
  find: () => unexpected("find"), accept: () => unexpected("accept"), cancel: () => unexpected("cancel"),
  cancelPending: () => unexpected("cancelPending"), captureSession: () => unexpected("captureSession"),
  clearSession: () => unexpected("clearSession"), guardTool: () => unexpected("guardTool"), completeTool: () => unexpected("completeTool"),
};
