/** Keep an allowed selection or choose the allowed default/first id; an empty list keeps defaultId. */
/**
 * URL query values can come from stale bookmarks or typos; validating against allowed ids prevents
 * a blank panel. The default is supplied by the caller because some screens compute it from settings.
 * Validate that default too: a computed default can widen the type to string, letting drift from
 * the allowed list type-check successfully. For a nonempty list, the first id keeps the fallback valid.
 */
export function resolveActiveTabId<T extends string>({ tabId, validIds, defaultId }: { tabId: string | null | undefined; validIds: readonly T[]; defaultId: T }
): T {
  const ids = validIds as readonly string[];
  const safeDefault = ids.includes(defaultId) ? defaultId : (validIds[0] ?? defaultId);
  return tabId && ids.includes(tabId) ? (tabId as T) : safeDefault;
}
