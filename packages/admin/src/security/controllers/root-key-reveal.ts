import type { RootKeyPort } from '../ports.js';
import type { RootKeyStatus } from '../models.js';
/** The reveal fields a snapshot may carry: flags only, never the value. */
export interface RevealFields { readonly revealed: boolean; readonly revealing: boolean; readonly revealError: string | null; readonly copied: boolean }
export const REVEAL_IDLE: RevealFields = { revealed: false, revealing: false, revealError: null, copied: false };
export type RevealClipboard = Pick<Clipboard, 'writeText'>;
interface RevealStore {
  getSnapshot(): RevealFields & { readonly status: RootKeyStatus | null };
  set(required: { patch: Partial<RevealFields> }): void;
  readonly signal: AbortSignal;
}
const COPIED_MS = 1500;
/** The revealed key lives only in this closure. A snapshot, a log line or an agent reading controller
 * state therefore cannot carry it; the view reads it on demand while `revealed` is true. */
export function createRevealCell(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
  let value: string | null = null;
  return { read: () => value, write: ({ hex }: { hex: string }) => { value = hex; }, clear: () => { value = null; } };
}
/** Human-only reveal and copy. Every `clear` (hide, reload, a successful write, dispose) bumps the
 * ticket, so a reply still in flight is dropped instead of showing the key after it was put away. */
export function createRootKeyReveal(
  { api, store, allowed }: { api: RootKeyPort; store: RevealStore; allowed: () => boolean },
  { failureText, clipboard }: { failureText: (error: unknown) => string; clipboard?: RevealClipboard | undefined },
) {
  const cell = createRevealCell(); let ticket = 0; let timer: ReturnType<typeof setTimeout> | undefined;
  function clear(_required: Record<string, never> = {}, _optional = {}) { ticket += 1; cell.clear(); clearTimeout(timer); store.set({ patch: REVEAL_IDLE }); }
  /** An inactive reply, or one without a value, shows nothing and no error (status/reveal race). */
  function settle({ mine, reply }: { mine: number; reply: { active: boolean; hex?: string } }, _optional = {}) {
    if (mine !== ticket || !reply.active || !reply.hex) return false;
    cell.write({ hex: reply.hex }); store.set({ patch: { revealed: true } }); return true;
  }
  /** Only for an active key, with a reveal port, one request at a time. */
  const canReveal = () => { const s = store.getSnapshot(); return allowed() && !!s.status?.active && !s.revealing; };
  async function reveal(_required: Record<string, never> = {}, _optional = {}) {
    const port = api.reveal;
    if (!port || !canReveal()) return false;
    const mine = ++ticket; store.set({ patch: { revealing: true, revealError: null } });
    try {
      return settle({ mine, reply: await port({}, { signal: store.signal }) });
    } catch (error) { if (mine === ticket) store.set({ patch: { revealError: failureText(error) } }); return false; }
    finally { if (mine === ticket) store.set({ patch: { revealing: false } }); }
  }
  /** A denied clipboard is silent: the value stays on screen to copy by hand. */
  async function copy(_required: Record<string, never> = {}, _optional = {}) {
    const hex = cell.read(), mine = ticket;
    if (!hex || !clipboard) return false;
    try { await clipboard.writeText(hex); } catch { return false; }
    if (mine !== ticket) return false;
    clearTimeout(timer); store.set({ patch: { copied: true } }); timer = setTimeout(() => store.set({ patch: { copied: false } }), COPIED_MS);
    return true;
  }
  return { reveal, copy, clear, value: cell.read };
}
