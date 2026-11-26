// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { subscribeExecutionConfigRefresh } from "../execution-config-refresh.js";

it("revalidates visible execution config and releases every refresh subscription", () => {
  const revalidate = vi.fn();
  const unsubscribe = vi.fn();
  let refresh!: (scope: readonly string[] | null) => void;
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  const dispose = subscribeExecutionConfigRefresh({ revalidate, deps: {
    window, document, EXECUTION_NAMESPACE: "execution",
    subscribeToSettingsRefresh: (listener) => { refresh = listener; return unsubscribe; },
  } });
  document.dispatchEvent(new Event("visibilitychange"));
  expect(revalidate).toHaveBeenCalledTimes(0);
  visibility.mockReturnValue("visible");
  document.dispatchEvent(new Event("visibilitychange"));
  expect(revalidate).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new Event("focus"));
  expect(revalidate).toHaveBeenCalledTimes(2);
  refresh(["unrelated"]);
  expect(revalidate).toHaveBeenCalledTimes(2);
  refresh(["execution"]);
  refresh(null);
  expect(revalidate).toHaveBeenCalledTimes(4);
  dispose();
  document.dispatchEvent(new Event("visibilitychange"));
  window.dispatchEvent(new Event("focus"));
  expect(revalidate).toHaveBeenCalledTimes(4);
  expect(unsubscribe).toHaveBeenCalledTimes(1);
  visibility.mockRestore();
});
