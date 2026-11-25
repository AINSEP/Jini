import type { CleanupPreviewStore } from '@jini-ai/core/contracts/storage';

export function createCleanupPreviewStore(
  { randomToken, mono }: { randomToken: (required: { bytes: number }) => string; mono: () => number },
  { ttlMs = 900000 } = {},
): CleanupPreviewStore {
  const outstanding = new Map<string, { token: string; scope: string; payload: Record<string, unknown>; deadline: number }>();
  return {
    put({ principal, kind, scope, payload }, _optional = {}) {
      const at = mono();
      for (const [key, entry] of outstanding) if (entry.deadline <= at) outstanding.delete(key);
      const token = randomToken({ bytes: 16 });
      const deadline = Math.min(at + ttlMs, payload.deadline ?? Infinity);
      outstanding.set(JSON.stringify([principal, kind]), { token, scope, payload, deadline });
      return { token, deadline };
    },
    take({ token, principal, kind, scope }, _optional = {}) {
      const key = JSON.stringify([principal, kind]);
      const entry = outstanding.get(key);
      if (!entry || entry.token !== token || entry.scope !== scope) return null;
      outstanding.delete(key);
      if (mono() >= entry.deadline) return null;
      return { payload: entry.payload, deadline: entry.deadline };
    },
  };
}
