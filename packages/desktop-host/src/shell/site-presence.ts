


export interface PresenceSender {
  isDestroyed(): boolean;
  once(name: 'destroyed' | 'render-process-gone', listener: () => void): unknown;
  removeListener(name: 'destroyed' | 'render-process-gone', listener: () => void): unknown;
}

/** The maintenance owner can query presence without learning about renderer senders. */
export interface SitePresence<Sender extends PresenceSender = PresenceSender> {
  replace(input: { sender: Sender; siteIds: unknown }, options?: {}): void;
  has(input: { siteId: string }, options?: {}): boolean;
  dispose(): void;
}

/** Retain complete lists per shell, never per loaded guest. Invalid updates reject atomically.
 * Sender loss removes only that sender's claim, so another window can keep the same site present.
 * @returns Replace/query/dispose operations; each sender owns one pair of cleanup listeners.
 * @complexity Replacement O(t + n), where t is tracked sites and n is reported ids; lookup O(s)
 * for s shells. Stored claims are bounded by tracked sites per live sender. No per-id I/O.
 */
export function createSitePresence<Sender extends PresenceSender>(
  { allowed, trackedIds }: { allowed: (sender: Sender) => boolean; trackedIds: () => ReadonlySet<string> },
  { hasSiteWindow = () => false, onRelease = () => {} }: { hasSiteWindow?: (required: { siteId: string }, options?: {}) => boolean; onRelease?: () => void } = {},
): SitePresence<Sender> {
  const owners = new Map<Sender, { siteIds: Set<string>; release: () => void }>();
  const release = (sender: Sender) => {
    const owner = owners.get(sender);
    if (!owner) return;
    onRelease();
    owners.delete(sender);
    sender.removeListener('destroyed', owner.release);
    sender.removeListener('render-process-gone', owner.release);
  };
  const replace = ({ sender, siteIds }: { sender: Sender; siteIds: unknown }) => {
    if (sender.isDestroyed() || !allowed(sender)) throw new Error('UNTRUSTED_SITE_PRESENCE_SENDER');
    const tracked = trackedIds();
    if (!Array.isArray(siteIds) || !siteIds.every(id => typeof id === 'string' && tracked.has(id))) throw new Error('INVALID_SITE_PRESENCE');
    const ids = new Set<string>(siteIds);
    const owner = owners.get(sender);
    if (owner) { owner.siteIds = ids; return; }
    const created = { siteIds: ids, release: () => release(sender) };
    owners.set(sender, created);
    sender.once('destroyed', created.release);
    sender.once('render-process-gone', created.release);
  };
  return {
    replace,
    has: ({ siteId }) => hasSiteWindow({ siteId }) || [...owners.values()].some(owner => owner.siteIds.has(siteId)),
    dispose: () => { for (const sender of owners.keys()) release(sender); },
  };
}
