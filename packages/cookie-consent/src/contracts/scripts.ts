/** Declared assets are data; no HTML or script body is inspected. */
import { CATEGORIES, type Category, type ConsentState, type DeclaredScript } from '../contract.js';

/** All purposes must be effectively allowed, including receipt and privacy-signal restrictions. */
export function allows({ state, consent = [] }: { state: Pick<ConsentState, 'allowed'>; consent?: readonly Category[] | undefined }, _optional = {}): boolean {
  return consent.every(category => CATEGORIES.includes(category) && state.allowed[category as keyof typeof state.allowed] === true);
}

function validSrc(src: string): boolean {
  if (!/^(?:https?:\/\/|\/(?!\/)|\.\.?\/)/.test(src)) return false;
  try { return ['http:', 'https:'].includes(new URL(src, 'https://declared.invalid').protocol); }
  catch { return false; }
}

function validScript(value: unknown): value is DeclaredScript {
  if (!value || typeof value !== 'object') return false;
  const { src, consent } = value as DeclaredScript;
  if (typeof src !== 'string' || !src.trim() || /[\s\\]/.test(src)) return false;
  if (!validSrc(src)) return false;
  return consent === undefined || Array.isArray(consent) && consent.every(c => CATEGORIES.includes(c));
}

/** Malformed declarations never become executable assets; diagnostics identify their array position. */
export function validateScripts({ scripts }: { scripts: unknown }, _optional = {}): { scripts: DeclaredScript[]; problems: string[] } {
  if (scripts === undefined) return { scripts: [], problems: [] };
  if (!Array.isArray(scripts)) return { scripts: [], problems: ['scripts must be an array'] };
  const accepted: DeclaredScript[] = [];
  const problems: string[] = [];
  scripts.forEach((entry, index) => {
    if (validScript(entry)) accepted.push({ src: entry.src, ...(entry.consent && { consent: [...entry.consent] }) });
    else problems.push(`scripts[${index}] needs an HTTP(S) or relative src and known consent categories`);
  });
  return { scripts: accepted, problems };
}
