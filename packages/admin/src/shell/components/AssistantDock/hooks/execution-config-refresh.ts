export function subscribeExecutionConfigRefresh(
  { revalidate, deps: { window, document, subscribeToSettingsRefresh, EXECUTION_NAMESPACE } }: {
    revalidate: () => void;
    deps: {
      window: Pick<Window, "addEventListener" | "removeEventListener">;
      document: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">;
      subscribeToSettingsRefresh: (listener: (scope: readonly string[] | null) => void) => () => void;
      EXECUTION_NAMESPACE: string;
    };
  },
  _options: Record<string, never> = {},
): () => void {
  // Another window/desktop can save execution config while this dock stays mounted. Settings
  // already publishes this namespace on save; focus/visible also catch changes outside the tab.
  const onVisible = () => { if (document.visibilityState === "visible") revalidate(); };
  window.addEventListener("focus", revalidate);
  document.addEventListener("visibilitychange", onVisible);
  const unsubscribe = subscribeToSettingsRefresh((scope) => {
    if (!scope || scope.includes(EXECUTION_NAMESPACE)) {
      revalidate();
    }
  });
  return () => {
    window.removeEventListener("focus", revalidate);
    document.removeEventListener("visibilitychange", onVisible);
    unsubscribe();
  };
}
