/** @file The one consent rule, shared by the browser client and the server so they can never disagree.
 * Pure functions: no DOM, no Node. */
// MOVED-FROM: @jini-ai/cms consent/policy.ts (resolveConsentRegion, resolveConsentChoices, readConsentRecord,
// createConsentRecord). TODO(P4): delete the cms copies once Tovu reads this package.
import { ACTIONS, type Choices, type ConsentAction, type ConsentState, type Flags, type RegionMode, type ReceiptStatus, type StoredChoice } from './contract.js';

export const DAY_MS = 86_400_000;
export const DEFAULT_MAX_AGE_MS = 180 * DAY_MS;
/** A receipt time comes from the server clock and is compared with the client clock; allow a minute. */
const SKEW_MS = 60_000;
/** Receipt ids keep the cms receipt-file rule, so ids can never navigate out of a receipt directory. */
export const RECEIPT_ID = /^[\w-]{16,128}$/;
export const DENIED: Choices = Object.freeze({ necessary: true, functional: false, analytics: false, marketing: false });

/** Only the literal hint 'us' loosens; anything else, including absence, is strict. @complexity O(1). */
export function regionFrom({ configured, hint }: { configured: 'auto' | RegionMode; hint: string | null | undefined }, _optional = {}): RegionMode {
  if (configured !== 'auto') return configured;
  return hint === 'us' ? 'opt-out' : 'opt-in';
}

const flags = (functional: boolean, analytics = functional, marketing = analytics): Flags => ({ functional, analytics, marketing });

/** What a button press means. Unknown picks are false. @complexity O(1). */
export function choicesFor({ action, picked = {} }: { action: ConsentAction; picked?: Partial<Flags> }, _optional = {}): Flags {
  if (action === 'accept') return flags(true);
  if (action === 'save') return flags(picked.functional === true, picked.analytics === true, picked.marketing === true);
  // Do-not-sell keeps functional unless explicitly unticked: it is a sale/share refusal, not a reject.
  if (action === 'do-not-sell') return flags(picked.functional !== false, false);
  return flags(false);                                                          // reject, withdraw
}

/** GPC wins over stored or new grants for every category that can share data; nothing can lift it. @complexity O(1). */
export function clamp({ flags, gpc }: { flags: Flags; gpc: boolean }, _optional = {}): Choices {
  return { necessary: true, functional: flags.functional, analytics: flags.analytics && !gpc, marketing: flags.marketing && !gpc };
}

/** Region default, policy-version + age expiry, GPC clamp, and (durable mode) no grant without a receipt.
 * A region default with no stored choice (the opt-out model) is never "waiting", so it runs as configured.
 * @example effective({ stored, policy: '2026-10-26', region: 'opt-in', gpc: false, nowMs: Date.now() }, { durable: true })
 * @complexity O(1). */
export function effective(
  { stored, policy, region, gpc, nowMs }: { stored: StoredChoice | null; policy: string; region: RegionMode; gpc: boolean; nowMs: number },
  { maxAgeMs = DEFAULT_MAX_AGE_MS, durable = false }: { maxAgeMs?: number; durable?: boolean } = {},
): ConsentState {
  const live = current({ stored, policy, nowMs, maxAgeMs });
  const choices = clamp({ flags: live?.c ?? flags(region === 'opt-out'), gpc });
  const base = { contract: 1, policy, region, gpc, choices } as const;
  if (!live) return { ...base, status: 'pending', allowed: choices, action: null, at: null, receipt: 'none' };
  return { ...base, status: 'set', allowed: durable && !live.r ? DENIED : choices, action: live.a, at: live.t, receipt: receiptOf(live) };
}

/** Unparseable, future (beyond skew) and expired choices are all stale. @complexity O(1). */
function current({ stored, policy, nowMs, maxAgeMs }: { stored: StoredChoice | null; policy: string; nowMs: number; maxAgeMs: number }): StoredChoice | null {
  return stored && stored.p === policy && stored.t <= nowMs + SKEW_MS && nowMs - stored.t <= maxAgeMs ? stored : null;
}

function receiptOf(stored: StoredChoice): ReceiptStatus {
  if (stored.r) return 'stored';
  return stored.q ? 'pending' : 'local';
}

/** Trust boundary for the cookie: anything malformed is "no choice". Only known fields are copied out.
 * @complexity O(raw length ≤ 1 KiB). */
export function parseStored({ raw }: { raw: string | null | undefined }, _optional = {}): StoredChoice | null {
  if (!raw || raw.length > 1024) return null;
  let s: Partial<StoredChoice> | null;
  try { s = JSON.parse(raw) as Partial<StoredChoice> | null; } catch { return null; }
  if (!isStored(s)) return null;
  const out: StoredChoice = { v: 1, p: s.p, c: flags(s.c.functional, s.c.analytics, s.c.marketing), t: s.t, a: s.a };
  if (typeof s.r === 'string' && RECEIPT_ID.test(s.r)) out.r = s.r;
  if (s.q === 1) out.q = 1;
  return out;
}

function isStored(s: Partial<StoredChoice> | null): s is StoredChoice {
  if (!s || s.v !== 1 || typeof s.p !== 'string' || !Number.isFinite(s.t)) return false;
  return ACTIONS.includes(s.a!) && isFlags(s.c);
}

/** Own booleans only: truthy strings never count as a grant. @complexity O(1). */
export function isFlags(c: unknown): c is Flags {
  const f = c as Partial<Flags> | null;
  return !!f && typeof f === 'object' && typeof f.functional === 'boolean' && typeof f.analytics === 'boolean' && typeof f.marketing === 'boolean';
}
