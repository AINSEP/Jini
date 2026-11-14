/** Stable per-(id, kind) key used to track in-flight per-item actions independently, so one item's busy action never disables an unrelated item — same pattern already established by `features/source-config-list`'s `pendingActionKey`, shared by every feature that tracks per-item in-flight actions. */
export function pendingActionKey({ id, kind }: { id: string; kind: string }, _optional: Record<string, never> = {}): string {
  return `${kind}:${id}`;
}

/** Checks whether an action is in flight for the given item and kind. */
export function isActionPending({ pendingKeys, id, kind }: { pendingKeys: ReadonlySet<string>; id: string; kind: string }, _optional: Record<string, never> = {}): boolean {
  return pendingKeys.has(pendingActionKey({ id, kind }));
}

/** Returns a new set with the given item action marked in flight. */
export function withPendingAction({ pendingKeys, id, kind }: { pendingKeys: ReadonlySet<string>; id: string; kind: string }, _optional: Record<string, never> = {}): ReadonlySet<string> {
  const next = new Set(pendingKeys);
  next.add(pendingActionKey({ id, kind }));
  return next;
}

/** Removes the given action, preserving the original set when it was absent. */
export function withoutPendingAction({ pendingKeys, id, kind }: { pendingKeys: ReadonlySet<string>; id: string; kind: string }, _optional: Record<string, never> = {}): ReadonlySet<string> {
  if (!pendingKeys.has(pendingActionKey({ id, kind }))) return pendingKeys;
  const next = new Set(pendingKeys);
  next.delete(pendingActionKey({ id, kind }));
  return next;
}
