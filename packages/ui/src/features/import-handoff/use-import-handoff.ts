/**
 * @file The receiving half of an "open Import in the desktop app" hand-off: another surface (a web
 * admin running inside the desktop app, say) cannot do the import itself, so it asks for this app's
 * Import tab instead. The address arrives untrusted and is typed in only when the host's own Import
 * page validator accepts it.
 */
import { useEffect, useRef } from 'react';

/** The preload bridge slice this hook drives: the hand-off push from main. */
export interface ImportHandoffBridge {
  onOpenImport(required: { listener: (request: unknown) => void }): () => void;
}

/**
 * The hand-off's address as the Import page would take it, or `null` when there is none or the
 * page would refuse it (the tab then opens empty rather than holding text it would reject).
 * @param required.accept the host Import page's own address validator (normalized text or `null`).
 * @complexity O(n) in the address length.
 */
export function handoffAddress({ request, accept }: { request: unknown; accept: (required: { text: string }) => string | null }, _optional: Record<string, never> = {}): string | null {
  const raw = typeof request === 'object' && request !== null ? (request as { address?: unknown }).address : undefined;
  return typeof raw === 'string' ? accept({ text: raw }) : null;
}

/**
 * Opens the Import tab on each hand-off, typing in its address first unless an import is running
 * (that import is still using the address on screen).
 * @param required.busy whether the Import page's own import is running.
 * @param required.prefill types the address into the Import page.
 * @param required.open opens the Import tab, or brings it to the front.
 * @param required.getBridge the host's bridge lookup (stable function); `undefined` subscribes nothing.
 * @param required.accept the host Import page's address validator.
 * @complexity O(1) per hand-off beyond address parsing.
 */
export function useImportHandoff(
  { busy, prefill, open, getBridge, accept }: {
    busy: boolean;
    prefill: (address: string) => void;
    open: () => void;
    getBridge: () => ImportHandoffBridge | undefined;
    accept: (required: { text: string }) => string | null;
  },
  _optional: Record<string, never> = {},
): void {
  // The latest callbacks, so the bridge listener is attached once rather than on every render.
  const latest = useRef({ busy, prefill, open, accept });
  useEffect(() => { latest.current = { busy, prefill, open, accept }; });
  useEffect(() => getBridge()?.onOpenImport({ listener: (request) => {
    const current = latest.current;
    const address = handoffAddress({ request, accept: current.accept });
    if (address !== null && !current.busy) current.prefill(address);
    current.open();
  } }), [getBridge]);
}
