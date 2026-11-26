import { expect, test, vi } from "vitest";
import { subscribeStoredKeyRefresh } from "../hooks/execution-config-refresh.js";

test("stored-key refresh ignores unrelated namespaces and retains global refresh", () => {
  let notify!: (scope: readonly string[] | null) => void;
  const revalidate = vi.fn();
  const cleanup = vi.fn();
  const unsubscribe = subscribeStoredKeyRefresh({ revalidate, deps: {
    EXECUTION_NAMESPACE: "core.execution",
    subscribeToSettingsRefresh: listener => { notify = listener; return cleanup; },
  } });
  notify(["unrelated"]);
  expect(revalidate).not.toHaveBeenCalled();
  notify(["core.execution"]);
  notify(null);
  expect(revalidate).toHaveBeenCalledTimes(2);
  unsubscribe();
  expect(cleanup).toHaveBeenCalledOnce();
});
